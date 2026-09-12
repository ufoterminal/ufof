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
// Windows per pass, and how many of them are in flight at once. Requests are independent, so fetching
// them together is what makes a map arrive in seconds rather than minutes; the ceiling keeps the public
// RPC from being hammered by a single turn.
const PASS=Math.max(1,Math.min(2000,Number(process.env.HOLDER_MAP_PASS||400)));
const CONCURRENCY=Math.max(1,Math.min(32,Number(process.env.HOLDER_MAP_CONCURRENCY||16)));
const HOLDERS=100;
const REFRESH=6*3600;

let client;
// The endpoints differ by more than three times in latency for the same call, and the plain fallback
// order would keep using the first one that answers rather than the one that answers fastest. Ranking
// measures them and puts the quickest in front, which is what turns a full history scan from minutes
// into seconds.
const rpc=()=>client??=createPublicClient({transport:fallback(
 RPC_HTTP.map(url=>http(url,{batch:false,timeout:20000,retryCount:1})),
 {rank:{interval:60000,sampleCount:3,timeout:2000}})});

let ready;
const init=()=>ready??=q(`
CREATE TABLE IF NOT EXISTS holder_maps(
 token TEXT PRIMARY KEY,status TEXT NOT NULL,created_block BIGINT,scanned_to BIGINT,head BIGINT,
 holders JSONB,edges JSONB,built_at BIGINT,error TEXT);`);

// The block a contract first had code, found by halving the range. Archive state makes this exact, and it
// is stored so the search happens once per token.
async function creationBlock(token,head){
 let lo=0,hi=head;
 // Several probes go out together and the range collapses to whichever gap holds the transition, so the
 // search takes a handful of rounds instead of one round per halving.
 while(hi-lo>1){
  // Strictly inside the range and never repeated, otherwise a narrow range would probe its own edge
  // forever instead of closing.
  const cuts=[...new Set(Array.from({length:CONCURRENCY},(_,i)=>lo+Math.floor((hi-lo)*(i+1)/(CONCURRENCY+1))))]
   .filter(b=>b>lo&&b<hi);
  if(!cuts.length)cuts.push(lo+Math.floor((hi-lo)/2));
  if(cuts[0]<=lo||cuts[0]>=hi)break;
  const has=await Promise.all(cuts.map(b=>rpc().getBytecode({address:token,blockNumber:BigInt(b)})
   .then(code=>!!(code&&code!=='0x')).catch(()=>null)));
  let low=lo,high=hi,moved=false;
  for(let i=0;i<cuts.length;i++){
   if(has[i]===null)continue;
   if(has[i]){high=cuts[i];moved=true;break;}
   low=cuts[i];moved=true;
  }
  if(!moved)break;
  lo=low;hi=high;
 }
 return hi;
}

// Pools, routers and burn addresses trade with everybody, so linking through them would put every holder
// in one meaningless group. Only plain wallets are linked; a holder carrying code, or a burn address, is
// still shown and still counted, but it is not a node anybody is grouped through.
export const isWallet=h=>!h.contract&&!/^0x0{39}[01]$/.test(h.address)&&h.address!=='0x000000000000000000000000000000000000dead';
const addressSet=holders=>new Set(holders.filter(isWallet).map(h=>h.address));

// One code read per holder, done once when the map is first built.
async function markContracts(holders){
 const out=[];
 for(let i=0;i<holders.length;i+=CONCURRENCY){
  const batch=holders.slice(i,i+CONCURRENCY);
  const codes=await Promise.all(batch.map(h=>h.contract!=null?Promise.resolve(null)
   :rpc().getBytecode({address:h.address}).catch(()=>null)));
  batch.forEach((h,j)=>out.push(h.contract!=null?h:{...h,contract:!!(codes[j]&&codes[j]!=='0x')}));
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
export async function advanceHolderMap(token,{concurrency,pass}={}){
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
 // The windows of this pass, fetched a batch at a time. A window that fails leaves the scan short of the
 // head rather than claiming ground it never read, so the next pass picks it up.
 const windows=pass??(paused?SYNC_PASS:PASS);
 const lanes=concurrency??(paused?SYNC_CONCURRENCY:CONCURRENCY);
 const ranges=[];
 for(let i=0;i<windows&&from<=target;i++){const to=Math.min(target,from+WINDOW-1);ranges.push([from,to]);from=to+1;}
 let reached=Number(row.scanned_to);
 for(let i=0;i<ranges.length;i+=lanes){
  const batch=ranges.slice(i,i+lanes);
  const results=await Promise.all(batch.map(([a,b])=>
   rpc().getLogs({address,event:transfer,fromBlock:BigInt(a),toBlock:BigInt(b)}).then(logs=>logs).catch(()=>null)));
  let ok=true;
  for(let j=0;j<batch.length;j++){
   if(results[j]==null){ok=false;break;}
   await scanWindow(results[j],members,edges);
   reached=batch[j][1];
  }
  if(!ok)break;
 }
 from=reached+1;
 const done=from>target;
 await q(`UPDATE holder_maps SET edges=$2::jsonb,scanned_to=$3,status=$4,built_at=$5 WHERE token=$1`,
  [address,JSON.stringify(edges),reached,done?'done':'building',done?Math.floor(Date.now()/1000):null]);
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
// Map building and the market sync draw on the same endpoints, and a queue of sixteen parallel window
// reads will starve a sync that is still fetching the token list. Maps wait for the sync to finish.
// During a market sync the two compete for the same endpoints, so map building drops to a trickle rather
// than stopping: stopping it outright meant that on a deployment whose sync rarely finishes, no map was
// ever built at all.
let paused=true;
export function setHolderMapPaused(value){paused=!!value;}
const SYNC_CONCURRENCY=Math.max(1,Math.min(CONCURRENCY,Number(process.env.HOLDER_MAP_SYNC_CONCURRENCY||3)));
const SYNC_PASS=Math.max(1,Math.min(PASS,Number(process.env.HOLDER_MAP_SYNC_PASS||40)));
export function requestHolderMap(token){
 const address=String(token||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(address))return;
 // A reader waiting on a tab comes before whatever the seed queued.
 const at=wanted.indexOf(address);
 if(at>0)wanted.splice(at,1);
 if(at!==0)wanted.unshift(address);
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

// Maps are built before anyone asks, busiest tokens first, so opening the tab on a token people actually
// trade shows a finished map rather than a progress line. A reader's own request still jumps the queue.
const SEED=Math.max(0,Math.min(500,Number(process.env.HOLDER_MAP_SEED||80)));
export async function seedHolderMaps(){
 await init();
 if(!SEED)return 0;
 const rows=await q(`SELECT t.address FROM tokens t
  LEFT JOIN holder_maps m ON m.token=t.address
  WHERE COALESCE((t.metadata->>'volume24h')::numeric,0)>0
  AND (m.token IS NULL OR (m.status='done' AND COALESCE(m.built_at,0)<$1) OR m.status='building')
  ORDER BY COALESCE((t.metadata->>'volume24h')::numeric,0) DESC LIMIT $2`,
  [Math.floor(Date.now()/1000)-REFRESH,SEED]);
 for(const r of rows)if(!wanted.includes(r.address))wanted.push(r.address);
 return rows.length;
}

export async function holderMap(token){
 await init();
 const address=String(token||'').toLowerCase();
 const row=await readRow(address);
 return shapeMap(row);
}
