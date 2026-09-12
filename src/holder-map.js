// Holder Maps: which of a token's largest holders have moved tokens to each other.
//
// The graph is read from the token's own Transfer log, from the block the contract appeared in to the
// chain head, in the same bounded 10,000 block windows everything else here uses. An edge means one
// mapped holder sent this token to another, and nothing more than that. Wallets that move tokens between
// themselves are grouped, but a group is a pattern worth looking at, not proof of a single owner: an
// exchange, a router or a friend all produce the same edge.
//
// A full scan takes a few minutes for an old token, so it runs in the background across several passes
// with its progress stored. The map is served while it is still filling, marked as incomplete.
import {createPublicClient,fallback,http,parseAbiItem} from 'viem';
import {q} from './db.js';
import {RPC_HTTP} from './config.js';
import {tokenHolders} from './holders.js';

const transfer=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
const WINDOW=10000;
// Windows per pass. A pass is one background turn, so this trades how fast a map fills against how much
// a single turn asks of the public RPC.
const PASS=Math.max(1,Math.min(120,Number(process.env.HOLDER_MAP_PASS||40)));
const HOLDERS=100;
const REFRESH=6*3600;

let client;
const rpc=()=>client??=createPublicClient({transport:fallback(RPC_HTTP.map(url=>http(url,{batch:false,timeout:20000,retryCount:1})))});

let ready;
const init=()=>ready??=q(`
CREATE TABLE IF NOT EXISTS holder_maps(
 token TEXT PRIMARY KEY,status TEXT NOT NULL,created_block BIGINT,scanned_to BIGINT,head BIGINT,
 holders JSONB,edges JSONB,built_at BIGINT,error TEXT);`);

// The block a contract first had code, found by halving the range. Archive state makes this exact, and it
// is stored so the search happens once per token.
async function creationBlock(token,head){
 let lo=0,hi=head;
 while(lo<hi){
  const mid=Math.floor((lo+hi)/2);
  const code=await rpc().getBytecode({address:token,blockNumber:BigInt(mid)}).catch(()=>null);
  if(code&&code!=='0x')hi=mid;else lo=mid+1;
 }
 return lo;
}

// Pools, routers and burn addresses trade with everybody, so linking through them would put every holder
// in one meaningless group. Only plain wallets are linked; a holder carrying code, or a burn address, is
// still shown and still counted, but it is not a node anybody is grouped through.
export const isWallet=h=>!h.contract&&!/^0x0{39}[01]$/.test(h.address)&&h.address!=='0x000000000000000000000000000000000000dead';
const addressSet=holders=>new Set(holders.filter(isWallet).map(h=>h.address));

// One code read per holder, done once when the map is first built.
async function markContracts(holders){
 const out=[];
 for(const h of holders){
  if(h.contract!=null){out.push(h);continue;}
  const code=await rpc().getBytecode({address:h.address}).catch(()=>null);
  out.push({...h,contract:!!(code&&code!=='0x')});
 }
 return out;
}

// Edges are kept as a plain object keyed by the pair, so a pass can merge into what earlier passes found.
const pairKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;

export async function scanWindow(logs,members,edges){
 for(const log of logs){
  if(log.removed)continue;
  const from=String(log.args.from||'').toLowerCase(),to=String(log.args.to||'').toLowerCase();
  if(from===to||!members.has(from)||!members.has(to))continue;
  const key=pairKey(from,to);
  const edge=edges[key]||(edges[key]={from:from<to?from:to,to:from<to?to:from,count:0});
  edge.count++;
 }
 return edges;
}

// Groups of wallets joined by transfers, largest first. A wallet with no edge is not in a group.
export function clustersFrom(holders,edges){
 const wallets=holders.filter(isWallet);
 const parent=new Map(wallets.map(h=>[h.address,h.address]));
 const find=a=>{while(parent.get(a)!==a)a=parent.get(a);return a;};
 for(const e of edges){
  if(!parent.has(e.from)||!parent.has(e.to))continue;
  const ra=find(e.from),rb=find(e.to);
  if(ra!==rb)parent.set(ra,rb);
 }
 const groups=new Map();
 for(const h of wallets){
  const root=find(h.address);
  if(!groups.has(root))groups.set(root,[]);
  groups.get(root).push(h);
 }
 return [...groups.values()].filter(g=>g.length>1)
  .map(members=>({members:members.map(m=>m.address),share:members.reduce((a,m)=>a+(Number(m.share)||0),0)}))
  .sort((a,b)=>b.share-a.share);
}

async function readRow(token){return (await q('SELECT * FROM holder_maps WHERE token=$1',[token]))[0]||null;}

// One background turn. Returns the row as it now stands so the caller can report progress.
export async function advanceHolderMap(token){
 await init();
 const address=String(token||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(address))throw Error('Invalid token address');
 const head=Number(await rpc().getBlockNumber());
 let row=await readRow(address);

 if(!row||row.status==='done'&&Number(row.built_at||0)<Math.floor(Date.now()/1000)-REFRESH){
  // A fresh map, or a stale one being caught up: the holder list is re-read, the scan continues from
  // where it left off rather than starting over.
  const list=await tokenHolders(address,'',[],HOLDERS).catch(()=>({holders:[]}));
  const holders=await markContracts(list.holders.slice(0,HOLDERS));
  if(!holders.length){
   await q(`INSERT INTO holder_maps(token,status,error) VALUES($1,'empty',$2)
    ON CONFLICT(token) DO UPDATE SET status='empty',error=excluded.error`,[address,'No holder list available for this token']);
   return readRow(address);
  }
  const created=row?.created_block!=null?Number(row.created_block):await creationBlock(address,head);
  await q(`INSERT INTO holder_maps(token,status,created_block,scanned_to,head,holders,edges,built_at,error)
   VALUES($1,'building',$2,$3,$4,$5::jsonb,COALESCE($6::jsonb,'{}'::jsonb),NULL,NULL)
   ON CONFLICT(token) DO UPDATE SET status='building',created_block=excluded.created_block,
    scanned_to=COALESCE(holder_maps.scanned_to,excluded.scanned_to),head=excluded.head,
    holders=excluded.holders,error=NULL`,
   [address,created,created-1,head,JSON.stringify(holders),row?.edges?JSON.stringify(row.edges):null]);
  row=await readRow(address);
 }
 if(row.status==='empty')return row;

 const holders=row.holders||[];
 const members=addressSet(holders);
 const edges={...(row.edges||{})};
 let from=Number(row.scanned_to)+1;
 const target=Number(row.head)||head;
 for(let i=0;i<PASS&&from<=target;i++){
  const to=Math.min(target,from+WINDOW-1);
  const logs=await rpc().getLogs({address,event:transfer,fromBlock:BigInt(from),toBlock:BigInt(to)});
  await scanWindow(logs,members,edges);
  from=to+1;
 }
 const done=from>target;
 await q(`UPDATE holder_maps SET edges=$2::jsonb,scanned_to=$3,status=$4,built_at=$5 WHERE token=$1`,
  [address,JSON.stringify(edges),from-1,done?'done':'building',done?Math.floor(Date.now()/1000):null]);
 return readRow(address);
}

export function shapeMap(row){
 if(!row)return {status:'unknown',holders:[],edges:[],clusters:[]};
 if(row.status==='empty')return {status:'empty',error:row.error,holders:[],edges:[],clusters:[]};
 const holders=row.holders||[];
 const edges=Object.values(row.edges||{});
 const scanned=Number(row.scanned_to)-Number(row.created_block)+1;
 const span=Number(row.head)-Number(row.created_block)+1;
 return {
  status:row.status,
  progress:span>0?Math.max(0,Math.min(1,scanned/span)):0,
  fromBlock:Number(row.created_block),scannedTo:Number(row.scanned_to),head:Number(row.head),
  builtAt:row.built_at==null?null:Number(row.built_at),
  holders,edges,clusters:clustersFrom(holders,edges)
 };
}

// Tokens whose map a reader has asked for. One is built at a time, oldest request first, so a page view
// never blocks on a scan and the RPC is not asked for several histories at once.
const wanted=[];
export function requestHolderMap(token){
 const address=String(token||'').toLowerCase();
 if(/^0x[0-9a-f]{40}$/.test(address)&&!wanted.includes(address))wanted.push(address);
}
export async function drainHolderMaps(){
 const address=wanted[0];
 if(!address)return null;
 try{
  const row=await advanceHolderMap(address);
  if(row?.status!=='building')wanted.shift();
  return row;
 }catch(e){wanted.shift();throw e;}
}

export async function holderMap(token){
 await init();
 const address=String(token||'').toLowerCase();
 const row=await readRow(address);
 return shapeMap(row);
}
