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
import {createPublicClient,fallback,http} from 'viem';
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
  if(topic0&&String(log.topics?.[0]).toLowerCase()!==topic0.toLowerCase())continue;
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
  const key=id+':'+factory+':'+pad.topic.slice(0,10);
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
   const results=await Promise.all(batch.map(([a,b])=>rpc().getLogs({address:factory,
    fromBlock:BigInt(a),toBlock:BigInt(b)}).catch(()=>null)));
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
