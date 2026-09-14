import {q} from './db.js';
import {cachedJson,number} from './direct.js';
import {poolHistory} from './rpc-history.js';
import {bestPool} from './onchain.js';
import {SOURCES} from '../public/sources.js';
import {nonUsdQuote} from './quote-values.js';

const frames={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400};
const flights=new Map();
const hasPagedHistory=source=>!!SOURCES[source]?.history;
let initialized;
const init=()=>initialized??=q(`CREATE TABLE IF NOT EXISTS chart_trades(
 source TEXT NOT NULL,token TEXT NOT NULL,id TEXT NOT NULL,at BIGINT NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(source,token,id));
 CREATE INDEX IF NOT EXISTS chart_trades_time ON chart_trades(source,token,at);
 CREATE TABLE IF NOT EXISTS chart_sync(source TEXT NOT NULL,token TEXT NOT NULL,state JSONB NOT NULL,
 PRIMARY KEY(source,token));`);
const timestamp=v=>{const n=number(v);return n>1e12?Math.floor(n/1000):Math.floor(n);};
export function chartTrade(source,t){
 let at,price,usd,buy,trader,tx;
 if(source==='sharc'){
  if(t.isBurn)return null;
  at=timestamp(t.timestamp);price=number(t.priceE18)/1e18;usd=number(t.usdcAmount)/1e6;
  buy=t.isBuy;trader=t.trader;tx=t.txHash;
 }else if(source==='circlewarp'){
  at=timestamp(t.ts);price=number(t.price);usd=number(t.usdc);buy=t.side==='buy';trader=t.wallet;tx=t.txHash;
 }else{at=timestamp(t.at);price=number(t.price);usd=number(t.usd_volume);buy=t.buy;trader=t.trader;tx=t.tx;}
 if(!Number.isSafeInteger(at)||at<=0||at>Date.now()/1000+60||!(price>0)||!Number.isFinite(price)||!(usd>0))return null;
 const id=String(t.id??(tx?JSON.stringify([tx,t.logIndex??t.log_index??null,at,price,usd,buy]):''));
 if(!id)return null;
 return {id,at,price,usd_volume:usd,buy,trader,tx,block:number(t.block),logIndex:number(t.logIndex??t.log_index),order:number(t.order)};
}
// The opening mark is the last known execution before the active bucket.
// Include that mark in the range, unlike providers whose open lies outside
// high/low. No empty buckets or volume are synthesized.
export function buildCandles(trades,seconds){
 const unique=new Map(trades.filter(Boolean).map(t=>[t.id,t]));
 const ordered=[...unique.values()].sort((a,b)=>a.at-b.at||(a.block??0)-(b.block??0)||(a.logIndex??0)-(b.logIndex??0)||(a.order??0)-(b.order??0)||a.id.localeCompare(b.id));
 const buckets=new Map();let previousPrice=null;
 for(const t of ordered){
  const bucket=Math.floor(t.at/seconds)*seconds;let c=buckets.get(bucket);
  if(!c){const open=previousPrice??t.price;c={bucket,open,high:Math.max(open,t.price),low:Math.min(open,t.price),close:t.price,volume:0,trades:0};buckets.set(bucket,c);}
  c.high=Math.max(c.high,t.price);c.low=Math.min(c.low,t.price);c.close=t.price;c.volume+=t.usd_volume;c.trades++;previousPrice=t.price;
 }
 return [...buckets.values()];
}
async function save(source,token,rows){
 const unique=[...new Map(rows.filter(Boolean).map(t=>[t.id,t])).values()];
 for(let i=0;i<unique.length;i+=500)await q(`INSERT INTO chart_trades(source,token,id,at,payload)
 SELECT $1,$2,x.id,x.at,x.payload FROM jsonb_to_recordset($3::jsonb) AS x(id text,at bigint,payload jsonb)
 ON CONFLICT(source,token,id) DO UPDATE SET at=excluded.at,payload=excluded.payload`,
 [source,token,JSON.stringify(unique.slice(i,i+500).map(t=>({id:t.id,at:t.at,payload:t})))]);
}
async function sync(source,token,seed,poolAddress,descriptor){
 await init();
 let state=(await q('SELECT state FROM chart_sync WHERE source=$1 AND token=$2',[source,token]))[0]?.state||{};
 if(state.rpc&&state.rpc.schema!==3){state={...state,rpc:null,updated:0,rpcRetryAt:0};}
 // How soon the pool is read again for new swaps. Half a minute was long enough that a trade could sit
 // unseen while someone watched the page.
 const refresh=hasPagedHistory(source)&&!state.complete?5000:Math.max(2000,Number(process.env.CHART_REFRESH_MS||4000));
 if(state.updated>Date.now()-refresh)return state;
 if(!hasPagedHistory(source))await save(source,token,seed.map(t=>chartTrade('normalized',t)));
 // The chain is read for any source that cannot supply the rest itself: one with no paged history at all,
 // and one whose pages have run out or finished. Without this a token older than its provider's window
 // began mid-life on the chart.
 const needsChain=!hasPagedHistory(source)||state.complete||state.stalled;
 if(needsChain){
  if(poolAddress&&(!state.rpcRetryAt||state.rpcRetryAt<Date.now())){
   try{const result=await poolHistory(token,poolAddress,state.rpc,descriptor);
    if(result){await save(source+':rpc-v3',token,result.trades);state.rpc=result.state;state.rpcError=null;}
   }catch(e){state.rpcError=e.shortMessage||e.message;state.rpcRetryAt=Date.now()+60000;}
  }
  state.updated=Date.now();
  await q(`INSERT INTO chart_sync(source,token,state) VALUES($1,$2,$3::jsonb)
   ON CONFLICT(source,token) DO UPDATE SET state=excluded.state`,[source,token,JSON.stringify(state)]);
  return state;
 }
 const base=source==='sharc'?'https://sharc.fun/api/tokens/':'https://warp-arc-production.up.railway.app/api/tokens/';
 const size=source==='sharc'?500:100;
 const page=offset=>cachedJson(base+token+'/trades?limit='+size+'&offset='+offset,30000);
 const first=await page(0);
 if(!Array.isArray(first.trades)||number(first.total)==null)throw Error('Trade history unavailable');
 // New records shift offset pagination. Rewind one page to overlap safely.
 const growth=Math.max(0,first.total-(state.total||first.total));
 if(growth>size){state.offset=0;state.complete=false;}
 else if(state.offset)state.offset=Math.max(size,state.offset+growth-size);
 await save(source,token,first.trades.map((t,i)=>chartTrade(source,{...t,order:first.total-i})));
 state.total=first.total;
 if(first.trades.length>=first.total){state.complete=true;state.offset=first.total;}
 else if(!state.complete){
  let offset=Math.max(size,state.offset||size),previous='';
  const started=Date.now();
  for(let n=0;n<8&&offset<first.total&&Date.now()-started<8000;n++){
   const d=await page(offset);if(!Array.isArray(d.trades)||!d.trades.length)break;
   const fingerprint=JSON.stringify(d.trades[0]);if(fingerprint===previous)throw Error('History pagination did not advance');previous=fingerprint;
   await save(source,token,d.trades.map((t,i)=>chartTrade(source,{...t,order:(d.total??first.total)-offset-i})));offset+=d.trades.length;
  }
  // A provider that stops handing out older pages leaves the history short for good. Noting that here is
  // what lets the chain backfill take over instead of the chart simply beginning partway through.
  state.stalled=offset<=(state.offset||size)&&!state.complete;
  state.offset=offset;state.complete=offset>=first.total;
 }
 state.updated=Date.now();
 await q(`INSERT INTO chart_sync(source,token,state) VALUES($1,$2,$3::jsonb)
 ON CONFLICT(source,token) DO UPDATE SET state=excluded.state`,[source,token,JSON.stringify(state)]);
 return state;
}
export async function ownChart(source,token,tf,remote,market={}){
 const seconds=frames[tf];if(!seconds)throw Error('Invalid chart timeframe');
 // The local tape currently covers USDC pools only. Never splice a secondary
 // USDC pool into the USD history of a different primary quote market.
 if(nonUsdQuote(remote.detail?.quoteToken||market.quoteToken)||market.quotePending)
  return {...remote,candles:remote.candles||[],history:{...remote.history,source:'provider-usd'},notice:'USD provider history; cross-quote local indexing unavailable'};
 const key=source+':'+token;let state={},failure;
 try{
  const d=remote.detail||{};
  // Our own discovery is asked first for the market to read: it covers every token we list, so a chart no
  // longer depends on a feed naming the pool.
  const own=await bestPool(token).catch(()=>null);
  const poolAddress=own?.pool||d.bestPool||d.pool_address||d.token?.pool_address||d.pool||market.pool;
  const descriptor=own?.descriptor||(Array.isArray(d.pools)?d.pools.find(p=>p.pool===poolAddress):null);
  if(!flights.has(key)&&flights.size<4)flights.set(key,sync(source,token,remote.trades||[],poolAddress,descriptor).finally(()=>flights.delete(key)));
  if(!flights.has(key))throw Error('History workers busy');
  let timer;
  try{state=await Promise.race([flights.get(key),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),7000);})]);}
  finally{clearTimeout(timer);}
  if(!state)state=(await q('SELECT state FROM chart_sync WHERE source=$1 AND token=$2',[source,token]))[0]?.state||{};
 }catch(e){failure=e.message;}
 const stored=await q('SELECT payload FROM chart_trades WHERE source=$1 AND token=$2 ORDER BY at DESC LIMIT 100000',[source,token]);
 if(state.rpc?.schema!==3)state={...state,rpc:null};
 const rpcRows=state.rpc?await q('SELECT payload FROM chart_trades WHERE source=$1 AND token=$2 ORDER BY at DESC LIMIT 100000',[source+':rpc-v3',token]):[];
 const tape=stored.map(r=>r.payload).filter(t=>!state.rpc||t.at<=state.rpc.from||t.at>state.rpc.to)
  .concat(rpcRows.map(r=>r.payload).filter(t=>t.at>state.rpc.from&&t.pool===state.rpc.pool&&(t.generation||0)===(state.rpc.generation||0)));
 const raw=buildCandles(tape,seconds);
 const native=hasPagedHistory(source)||source==='dyor'&&!remote.candles?.length;
 // Other providers retain their earlier history until the local tape covers it.
 // Never combine volume from overlapping candles and trades.
 const first=raw[0]?.bucket;
 const boundary=!native&&!state.complete&&(remote.candles||[]).some(c=>c.bucket===first);
 const bootstrap=native?[]:(remote.candles||[]).filter(c=>first==null||c.bucket<first||(boundary&&c.bucket===first));
 const candles=continuousCandles([...bootstrap,...raw.filter(c=>!boundary||c.bucket!==first)]).slice(-500);
 return {candles,closes:candles.map(c=>({bucket:c.bucket,value:c.close,volume:c.volume})),chartMode:'candles',
  trades:tape.sort((a,b)=>b.at-a.at).slice(0,100),
  history:{engine:'local-trades-v1',openPolicy:'previous-recorded-close',complete:!!state.complete,records:tape.length,rpc:state.rpc||null,rpcError:state.rpcError||null,bootstrap:bootstrap.length>0,loading:flights.has(key)||(hasPagedHistory(source)&&!state.complete),from:tape.length?tape.reduce((n,t)=>Math.min(n,t.at),Infinity):null},
  notice:failure?'History refresh unavailable; stored trades retained.':hasPagedHistory(source)&&!state.complete?'Earlier trade history is still loading.':bootstrap.length?'Earlier candles use provider history; recent candles are built from stored trades.':''};
}
export function continuousCandles(rows){
 const sorted=[...new Map(rows.map(c=>[c.bucket,c])).values()].sort((a,b)=>a.bucket-b.bucket),out=[];
 for(const c of sorted){
  if(!Number.isSafeInteger(c.bucket)||![c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0))continue;
  const open=out.at(-1)?.close??c.open;
  out.push({...c,open,high:Math.max(c.high,c.close,open),low:Math.min(c.low,c.close,open),volume:Number.isFinite(c.volume)&&c.volume>=0?c.volume:null});
 }
 return out;
}
