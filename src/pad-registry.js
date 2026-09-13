// Pads whose launches are only on chain.
//
// Neither long.supply nor the o1 launchpad publishes a token list, so membership is read from their
// factories the way ArgusPad's is read from its Portals: each factory emits one event per launch with the
// new token as its first indexed argument, and that event is the whole registry. Market numbers come from
// a feed, but a row is only accepted for an address a factory actually launched.
//
// The factories and the event were found on chain rather than taken from a site: for several tokens the
// creation block was located by binary search over archive state, the transaction that created the token
// named the factory, and the log in that block whose first topic held the new token's address named the
// event.
import {createPublicClient,fallback,http,numberToHex} from 'viem';
import {q} from './db.js';
import {RPC_HTTP} from './config.js';

const WINDOW=10000;
const CONCURRENCY=Math.max(1,Math.min(32,Number(process.env.PAD_SCAN_CONCURRENCY||12)));
// Windows per pass. A registry is small and only grows at the head once it has caught up.
const PASS=Math.max(1,Math.min(2000,Number(process.env.PAD_SCAN_PASS||300)));

export const PAD_REGISTRIES={
 long:{
  label:'Long',
  factories:['0x3324d45dbda511e3333f5177c90f7c5dd30d24b5'],
  topic:'0x50aaba7c43c192b365f4e51b346ba943928ad9db7553773166b08863e1e1e542',
  feed:'https://api.radardex.pro/tokens?launchpad=long&sort=volume24&dir=desc&window=24h&limit=500',
  tag:'long'
 },
 tolly:{label:'Tolly',factories:['0xcad7ee36ac193bf2eddb7b3e2736c5bdb8269c8b'],
  topic:['0xdefd84618a4d1aceaf28aa60244fec2d00fa75f65b7243abd1c965cc80881b9a',
   '0x875522b092d9e19a1de359e4bd218090d582fa521c9733889acf1a5ff1941255'],feed:'https://api.tollylabs.com/tokens?scope=ours&sort=volume&dir=desc&limit=500&offset=0',tag:'tolly',shape:'own'},
 sharc:{label:'Sharc',
  factories:['0x38650a04f6d9db1f068c697c903d9fe494b3e4b1','0xacda46258bc2d3450a4e1dc1485eafa0e53784f9','0x2b2b76d365c76a9226d436746746bcf62cdf5634'],
  topic:['0x8ebdda277a9bcf4e56c7e14d1d611f4c04a44b91037c5de3161a6875bc58f45f',
   '0x91891eee2488475580e3ecb4c5bf5c89e7d3a3e4933f9ec22456f0cc7ffa16f9'],feed:'https://sharc.fun/api/tokens',tag:'sharc',shape:'own'},
 circlewarp:{label:'CircleWarp',factories:['0x0dcad158e98bc24455f9e94f46709d8a5f6d1255'],
  topic:'0x0b4cfda446fdf9ec5a85855f088c154869eb62e3e723d7d80319b680f90e0cfd',feed:'https://warp-arc-production.up.railway.app/api/tokens',tag:'warp',shape:'own'},
 archemist:{label:'Archemist',factories:['0x44b1091009c6f459fe4bf85586204134e2f29774'],
  topic:'0x7a88d8b25b54a99f23965e27a915cccb70666d4598f3d6338c434617b74b9b5f',feed:'https://api.archemist.fun/api/tokens?chain=arc-mainnet&limit=100',tag:'archi',shape:'own'},
 'pools-trade':{label:'pools.trade',factories:['0x0000ffffbe8efe702c8703ae3477ff5de3d319c0'],
  topic:'0x2e2b3f61b70d2d131b2a807371103cc98d51adcaa5e9a8f9c32658ad8426e74e',feed:'https://api.radardex.pro/tokens?launchpad=poolstrade&sort=volume24&dir=desc&window=24h&limit=500',tag:'poolstrade'},
 noxa:{label:'Noxa',factories:['0xe7d4e64079fe467a21801b36ccc6d9b3f66bd372'],
  topic:'0x1461370115e1c2be79cb529f8cfcbd11316e789d9c6099fc83417b0b4c48c62a',feed:'https://api.radardex.pro/tokens?launchpad=noxa&sort=volume24&dir=desc&window=24h&limit=500',tag:'noxa'},
 radardex:{label:'RadarDEX',factories:['0x4b638c1502a07a8e1a26112ee98f51a3f34bc93a','0xdc6f9efa59c314a2c5ec8f2b28666415d228f5ee'],
  topic:'0x851d681a32f0efba577c4a1bd412f74b575764a6b91e499a05a48a23f3821d66',feed:'https://api.radardex.pro/tokens?launchpad=radar&sort=volume24&dir=desc&window=24h&limit=500',tag:'radar'},
 dyor:{
  label:'DYOR',
  // Two factories, each announcing a launch with its own event. The current one is first.
  factories:['0x80b42aed46d73f47119dc444bea28a9e68f32bf4','0xdfef2f90f7e52609cc89b80b68ff6a1c86c4ddc4'],
  topic:['0x8f8815afd174b9556e4ef54fbb59bb79d5c567fa89760ac9409682fb9459bfad',
   '0xb03c53b28e78a88e31607a27e1fa48234dce28d5d9d9ec7b295aeb02e674a1e1'],
  // DYOR's own API, used for coverage; the factory registry still decides what is confirmed.
  feed:'https://arc-api-production-ef9c.up.railway.app/api/arc/v1/tokens?limit=100',
  tag:'dyor',shape:'own'
 },
 o1:{
  label:'o1',
  factories:['0xee3e862efde6dcd6df5648af0e2731b9d1df4605'],
  topic:'0x207384e895174175cc774fe7f7457b37c382f27ebf53d37d5257b862f80eaf9c',
  feed:'https://api.radardex.pro/tokens?launchpad=o1&sort=volume24&dir=desc&window=24h&limit=500',
  tag:'o1'
 }
};

let client;
const rpc=()=>client??=createPublicClient({transport:fallback(
 RPC_HTTP.map(url=>http(url,{batch:false,timeout:20000,retryCount:1})),
 {rank:{interval:60000,sampleCount:3,timeout:2000}})});

let ready;
const init=()=>ready??=q(`
CREATE TABLE IF NOT EXISTS pad_launches(
 pad TEXT NOT NULL,token TEXT NOT NULL,factory TEXT NOT NULL,block BIGINT,at BIGINT,PRIMARY KEY(pad,token));
CREATE TABLE IF NOT EXISTS pad_cursor(k TEXT PRIMARY KEY,head BIGINT,oldest BIGINT,updated BIGINT);`);

const logTime=log=>{const t=log.blockTimestamp;return t==null?null:Number(typeof t==='string'?BigInt(t):t);};
const readCursor=async k=>(await q('SELECT head,oldest FROM pad_cursor WHERE k=$1',[k]))[0]||null;
const writeCursor=(k,head,oldest)=>q(`INSERT INTO pad_cursor(k,head,oldest,updated) VALUES($1,$2,$3,$4)
 ON CONFLICT(k) DO UPDATE SET head=excluded.head,oldest=excluded.oldest,updated=excluded.updated`,
 [k,head,oldest,Math.floor(Date.now()/1000)]);

// The token is the event's first indexed argument, which is why this needs no ABI: the topic identifies
// the event and the next topic is the address.
export function launchesFromLogs(logs,pad,factory,topic0){
 const out=[];
 for(const log of logs){
  if(log.removed)continue;
  // The event is matched here rather than in the request: the node returned every log of the factory
  // whatever topic filter was asked for, and a factory emits several kinds of event per launch. Reading
  // the wrong one put pool addresses and even USDC into the registry.
  // A pad may announce launches with more than one event, so the match accepts a list.
  const wanted=topic0==null?null:(Array.isArray(topic0)?topic0:[topic0]).map(t=>String(t).toLowerCase());
  if(wanted&&!wanted.includes(String(log.topics?.[0]).toLowerCase()))continue;
  const topic=log.topics?.[1];
  if(!topic)continue;
  const token='0x'+String(topic).slice(26).toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(token)||token==='0x'+'0'.repeat(40))continue;
  out.push({pad,token,factory,block:Number(log.blockNumber),at:logTime(log)});
 }
 return out;
}

export async function scanPad(id,{head}={}){
 await init();
 const pad=PAD_REGISTRIES[id];
 if(!pad)throw Error('Unknown pad '+id);
 head=head??Number(await rpc().getBlockNumber());
 const found=[];
 for(const factory of pad.factories){
  // The event is part of the key, so correcting which event is read rescans instead of trusting old rows.
  const key=id+':'+factory+':'+String(Array.isArray(pad.topic)?pad.topic[0]:pad.topic).slice(0,10);
  const cursor=await readCursor(key);
  // Forward from the last checkpoint, and backwards through history until the factory's own start.
  const ranges=[];
  let oldest=cursor?Number(cursor.oldest):head,newest=cursor?Number(cursor.head):head;
  if(!cursor)ranges.push([Math.max(0,head-WINDOW+1),head]);
  else{
   if(head>newest)for(let b=newest+1;b<=head&&ranges.length<PASS;b+=WINDOW)ranges.push([b,Math.min(head,b+WINDOW-1)]);
   let edge=oldest;
   for(let i=ranges.length;i<PASS&&edge>0;i++){const to=edge-1,from=Math.max(0,to-WINDOW+1);ranges.push([from,to]);edge=from;}
  }
  if(!ranges.length)continue;
  let reached=newest,lowest=oldest;
  for(let i=0;i<ranges.length;i+=CONCURRENCY){
   const batch=ranges.slice(i,i+CONCURRENCY);
   // The filter is sent as a raw eth_getLogs call. Through the client helper the topic never reached the
   // node, so every log of the factory came back: correct once filtered here, but heavy enough that a
   // full history scan crawled. Filtered at the node it is a few records per window.
   const results=await Promise.all(batch.map(([a,b])=>rpc().request({method:'eth_getLogs',
    params:[{address:factory,topics:[Array.isArray(pad.topic)?pad.topic:[pad.topic]],
     fromBlock:numberToHex(a),toBlock:numberToHex(b)}]}).catch(()=>null)));
   for(let j=0;j<batch.length;j++){
    if(results[j]==null)continue;   // a window that failed is simply not marked as read
    found.push(...launchesFromLogs(results[j],id,factory,pad.topic));
    reached=Math.max(reached,batch[j][1]);
    lowest=Math.min(lowest,batch[j][0]);
   }
  }
  await writeCursor(key,reached,lowest);
 }
 if(found.length)await saveLaunches(found);
 return found;
}

async function saveLaunches(all){
 // The same launch can be seen twice in one pass, and Postgres refuses an upsert that touches a row
 // twice in a single statement, so the batch is reduced to one entry per token first.
 const byToken=new Map();
 for(const row of all){
  const seen=byToken.get(row.pad+':'+row.token);
  if(!seen||row.block<seen.block)byToken.set(row.pad+':'+row.token,row);
 }
 const rows=[...byToken.values()];
 for(let i=0;i<rows.length;i+=250){
  await q(`INSERT INTO pad_launches(pad,token,factory,block,at)
   SELECT pad,token,factory,block,at FROM jsonb_to_recordset($1::jsonb)
   AS x(pad text,token text,factory text,block bigint,at bigint)
   ON CONFLICT(pad,token) DO UPDATE SET block=LEAST(pad_launches.block,excluded.block),
    at=COALESCE(pad_launches.at,excluded.at)`,[JSON.stringify(rows.slice(i,i+250))]);
 }
}

// Registry scanning is chain work and does not belong in a market sync: on a deployment further from the
// RPC endpoints it took longer than the sync's own deadline, so all three chain-backed pads were dropped
// every round. The scan now runs as a background task and a sync only reads what has been found so far.
let scanning=false;
export async function scanPadsInBackground(){
 if(scanning)return null;
 scanning=true;
 try{
  const head=Number(await rpc().getBlockNumber());
  for(const id of Object.keys(PAD_REGISTRIES))await scanPad(id,{head}).catch(()=>null);
  return true;
 }finally{scanning=false;}
}

export async function padLaunches(id){
 await init();
 return q('SELECT token,factory,block,at FROM pad_launches WHERE pad=$1 ORDER BY block',[id]);
}

export async function padStatus(){
 await init();
 return {
  launches:await q('SELECT pad,COUNT(*)::int AS launches,MIN(block)::bigint AS first_block FROM pad_launches GROUP BY pad'),
  cursors:await q('SELECT k,head,oldest,updated FROM pad_cursor ORDER BY k')
 };
}

// Factories found on chain for the pads that still come through their own API. Wiring them in means
// separating the shared field mapper from the pad id, which is a change worth making carefully rather
// than in passing, so they are recorded here rather than half-applied.
export const KNOWN_PAD_FACTORIES={
 tolly:{factories:['0xcad7ee36ac193bf2eddb7b3e2736c5bdb8269c8b'],
  topic:['0xdefd84618a4d1aceaf28aa60244fec2d00fa75f65b7243abd1c965cc80881b9a',
   '0x875522b092d9e19a1de359e4bd218090d582fa521c9733889acf1a5ff1941255']},
 sharc:{factories:['0x38650a04f6d9db1f068c697c903d9fe494b3e4b1','0xacda46258bc2d3450a4e1dc1485eafa0e53784f9','0x2b2b76d365c76a9226d436746746bcf62cdf5634'],
  topic:['0x8ebdda277a9bcf4e56c7e14d1d611f4c04a44b91037c5de3161a6875bc58f45f',
   '0x91891eee2488475580e3ecb4c5bf5c89e7d3a3e4933f9ec22456f0cc7ffa16f9']},
 circlewarp:{factories:['0x0dcad158e98bc24455f9e94f46709d8a5f6d1255'],
  topic:'0x0b4cfda446fdf9ec5a85855f088c154869eb62e3e723d7d80319b680f90e0cfd'},
 archemist:{factories:['0x44b1091009c6f459fe4bf85586204134e2f29774'],
  topic:'0x7a88d8b25b54a99f23965e27a915cccb70666d4598f3d6338c434617b74b9b5f'},
 'pools-trade':{factories:['0x0000ffffbe8efe702c8703ae3477ff5de3d319c0'],
  topic:'0x2e2b3f61b70d2d131b2a807371103cc98d51adcaa5e9a8f9c32658ad8426e74e'},
 noxa:{factories:['0xe7d4e64079fe467a21801b36ccc6d9b3f66bd372'],
  topic:'0x1461370115e1c2be79cb529f8cfcbd11316e789d9c6099fc83417b0b4c48c62a'},
 radardex:{factories:['0x4b638c1502a07a8e1a26112ee98f51a3f34bc93a','0xdc6f9efa59c314a2c5ec8f2b28666415d228f5ee'],
  topic:'0x851d681a32f0efba577c4a1bd412f74b575764a6b91e499a05a48a23f3821d66'}
};
