// Our own market data, read from Arc rather than from another screener.
//
// Discovery listens to the pool factories: Uniswap v3 emits PoolCreated, the v4 PoolManager emits
// Initialize. A token appears here the moment a USDC pool exists for it, whichever pad launched it and
// whether or not any other site lists it. Prices, volume, transactions and price changes are then
// computed from the pool's own Swap logs, which is the same tape a block explorer would read.
//
// Everything is bounded: Arc caps eth_getLogs at 10,000 blocks per request, refuses JSON-RPC batching,
// and mines about 170,000 blocks a day, so one day of trading is 17 windows. Each pass takes a few
// windows forward from the last checkpoint and one window backwards into history, and the cursors are
// stored, so an interrupted backfill continues instead of restarting.
import {createPublicClient,fallback,http,parseAbi,parseAbiItem} from 'viem';
import {q} from './db.js';
import {RPC_HTTP,USDC} from './config.js';
import {sqrtPriceToUsd} from './rpc-history.js';
import {chainMetadata} from './token-metadata.js';

export const V3_FACTORIES=['0xf0db7b58379503491d857db50ac9ece64c653918','0x874dc9d64cd0af61146a68036e9afca7dadd736a'];
export const V4_POOL_MANAGER='0x8366a39cc670b4001a1121b8f6a443a643e40951';
// The v2 style factories in use on Arc, each found by asking a live pair which factory built it rather
// than by trusting a list. They are quiet compared with v3 and v4, but their pairs still trade.
export const V2_FACTORIES=['0x942bd5bfdc5317c5507e326f8eb4bb6058ab5c10','0x32330c2400a6e0830d56661169ebb6c147e3577a','0x8e79e9e78511544160576f10dbd6ce2c983eb664'];
const WINDOW=10000;
// How many history windows one pass reaches back. Higher fills the archive sooner and asks more of the
// public RPC; the chain is about 20 million blocks, so three windows a minute covers it in roughly a day.
const BACKFILL=Math.max(0,Math.min(20,Number(process.env.ONCHAIN_BACKFILL||3)));

const poolCreated=parseAbiItem('event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)');
const initialize=parseAbiItem('event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)');
// Two shapes are in use on Arc: the standard four argument PairCreated, and a five argument variant
// emitted by one of the factories. Both name the pair in the first data word, so both are accepted.
const pairCreated=[parseAbiItem('event PairCreated(address indexed token0,address indexed token1,address pair,uint256 length)'),
 parseAbiItem('event PairCreated(address indexed token0,address indexed token1,address pair,address deployer,uint256 length)')];
const v2Swap=parseAbiItem('event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)');
const v3Swap=parseAbiItem('event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)');
const v4Swap=parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const erc20=parseAbi(['function name() view returns (string)','function symbol() view returns (string)','function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)']);

let client;
// Ranked so the quickest endpoint leads; they differ enough in latency for it to matter over a backfill.
const rpc=()=>client??=createPublicClient({transport:fallback(
 RPC_HTTP.map(url=>http(url,{batch:false,timeout:20000,retryCount:1})),
 {rank:{interval:60000,sampleCount:3,timeout:2000}})});

let ready;
const init=()=>ready??=q(`
CREATE TABLE IF NOT EXISTS onchain_pools(
 pool TEXT PRIMARY KEY,token TEXT NOT NULL,version TEXT NOT NULL,fee INTEGER,tick_spacing INTEGER,hooks TEXT,
 token_is_token0 BOOLEAN NOT NULL,created_block BIGINT,created_at BIGINT);
CREATE INDEX IF NOT EXISTS onchain_pools_token ON onchain_pools(token);
CREATE TABLE IF NOT EXISTS onchain_tokens(
 address TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',symbol TEXT NOT NULL DEFAULT '',decimals INTEGER,total_supply NUMERIC,read_at BIGINT);
CREATE TABLE IF NOT EXISTS onchain_trades(
 pool TEXT NOT NULL,block BIGINT NOT NULL,log_index INTEGER NOT NULL,token TEXT NOT NULL,at BIGINT NOT NULL,
 price NUMERIC,usd_volume NUMERIC,buy BOOLEAN,trader TEXT,tx TEXT,PRIMARY KEY(pool,block,log_index));
CREATE INDEX IF NOT EXISTS onchain_trades_token_at ON onchain_trades(token,at);
CREATE TABLE IF NOT EXISTS onchain_cursor(k TEXT PRIMARY KEY,head BIGINT,oldest BIGINT,updated BIGINT);
ALTER TABLE onchain_cursor ADD COLUMN IF NOT EXISTS oldest_at BIGINT;`);

const tapeKeys=3;
const readCursor=async k=>(await q('SELECT head,oldest,oldest_at FROM onchain_cursor WHERE k=$1',[k]))[0]||null;
const writeCursor=(k,head,oldest,oldestAt=null)=>q(`INSERT INTO onchain_cursor(k,head,oldest,oldest_at,updated) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(k) DO UPDATE SET head=excluded.head,oldest=excluded.oldest,
  oldest_at=COALESCE(excluded.oldest_at,onchain_cursor.oldest_at),updated=excluded.updated`,[k,head,oldest,oldestAt,Math.floor(Date.now()/1000)]);
// How far back the tape actually reaches. Everything that claims to cover a period is checked against it.
export async function tapeCoverage(){
 await init();
 const rows=await q("SELECT oldest_at FROM onchain_cursor WHERE k LIKE 'tape:%' AND oldest_at IS NOT NULL");
 return rows.length<tapeKeys?null:Math.max(...rows.map(r=>Number(r.oldest_at)));
}

const logTime=log=>{const t=log.blockTimestamp;return t==null?null:Number(typeof t==='string'?BigInt(t):t);};
const isUsdc=a=>String(a||'').toLowerCase()===USDC;

// One pass over a window, in both directions. Forward keeps the list current; backward reaches into
// history a window at a time so old pools and old trades arrive without ever asking for too much at once.
function plan(cursor,head,{back=true,windows=BACKFILL}={}){
 const ranges=[];
 if(!cursor)ranges.push({from:Math.max(0,head-WINDOW+1),to:head});
 else{
  if(head>cursor.head)ranges.push({from:cursor.head+1,to:Math.min(head,cursor.head+WINDOW)});
  let edge=Number(cursor.oldest);
  for(let i=0;back&&i<windows&&edge>0;i++){
   const to=edge-1,from=Math.max(0,to-WINDOW+1);
   ranges.push({from,to});edge=from;
  }
 }
 return ranges;
}

export async function discoverPools({head,back=true}={}){
 await init();
 head=head??Number(await rpc().getBlockNumber());
 const found=[];
 for(const [key,address,spec] of [
  ...V3_FACTORIES.map(f=>['v3:'+f,f,{event:poolCreated}]),
  ...V2_FACTORIES.map(f=>['v2:'+f,f,{events:pairCreated}]),
  ['v4:'+V4_POOL_MANAGER,V4_POOL_MANAGER,{event:initialize}]
 ]){
  const cursor=await readCursor(key);
  const ranges=plan(cursor,head,{back});
  if(!ranges.length)continue;
  let oldest=cursor?.oldest??ranges[0].from,newest=cursor?.head??head;
  for(const range of ranges){
   const logs=await rpc().getLogs({address,...spec,fromBlock:BigInt(range.from),toBlock:BigInt(range.to)});
   for(const log of logs){
    if(log.removed)continue;
    const a=log.args,v4=a.id!=null,v2=a.pair!=null;
    const c0=v4?a.currency0:a.token0,c1=v4?a.currency1:a.token1;
    // Only USDC markets: without a quote side in USDC there is no price we could state in dollars.
    if(!isUsdc(c0)&&!isUsdc(c1))continue;
    const token=String(isUsdc(c0)?c1:c0).toLowerCase();
    found.push({pool:String(v4?a.id:(v2?a.pair:a.pool)).toLowerCase(),token,version:v4?'v4':v2?'v2':'v3',
     fee:v2?null:Number(a.fee),tick_spacing:v2?null:Number(a.tickSpacing),hooks:v4?String(a.hooks).toLowerCase():null,
     token_is_token0:!isUsdc(c0),created_block:Number(log.blockNumber),created_at:logTime(log)});
   }
   oldest=Math.min(oldest,range.from);newest=Math.max(newest,range.to);
  }
  await writeCursor(key,newest,oldest);
 }
 if(found.length)await savePools(found);
 return found;
}

async function savePools(rows){
 for(let i=0;i<rows.length;i+=250){
  await q(`INSERT INTO onchain_pools(pool,token,version,fee,tick_spacing,hooks,token_is_token0,created_block,created_at)
   SELECT pool,token,version,fee,tick_spacing,hooks,token_is_token0,created_block,created_at
   FROM jsonb_to_recordset($1::jsonb) AS x(pool text,token text,version text,fee int,tick_spacing int,hooks text,token_is_token0 boolean,created_block bigint,created_at bigint)
   ON CONFLICT(pool) DO UPDATE SET created_at=COALESCE(onchain_pools.created_at,excluded.created_at),
    created_block=LEAST(COALESCE(onchain_pools.created_block,excluded.created_block),excluded.created_block)`,[JSON.stringify(rows.slice(i,i+250))]);
 }
}

// Decoded from the pool's own Swap log. The v4 sign convention is the swapper's, the opposite of v3, so
// the side is read per version rather than assumed.
export function decodeSwap(log,pool,decimals){
 const a=log.args,v4=a.id!=null,v2=a.amount0In!=null,token0=pool.token_is_token0;
 // A v2 pair reports four unsigned amounts instead of two signed ones, and carries no price of its own,
 // so the price is what the trade itself paid.
 const quoteRaw=v2?(token0?a.amount1In-a.amount1Out:a.amount0In-a.amount0Out):(token0?a.amount1:a.amount0);
 const tokenRaw=v2?(token0?a.amount0In-a.amount0Out:a.amount1In-a.amount1Out):(token0?a.amount0:a.amount1);
 if(quoteRaw==null||tokenRaw==null||quoteRaw===0n||tokenRaw===0n)return null;
 const quote=Math.abs(Number(quoteRaw))/1e6, amount=Math.abs(Number(tokenRaw))/10**decimals;
 const price=v2?quote/amount:sqrtPriceToUsd(a.sqrtPriceX96,{token0,decimals,quoteDecimals:6});
 if(!(quote>0&&amount>0&&price>0&&Number.isFinite(price)))return null;
 return {pool:pool.pool,token:pool.token,block:Number(log.blockNumber),log_index:Number(log.logIndex),
  at:logTime(log),price,usd_volume:quote,buy:v4?quoteRaw<0n:quoteRaw>0n,
  trader:v4?null:String(a.recipient||a.to||'').toLowerCase()||null,tx:log.transactionHash};
}

export async function collectTrades({head,back=true}={}){
 await init();
 head=head??Number(await rpc().getBlockNumber());
 const pools=new Map((await q('SELECT p.*,t.decimals FROM onchain_pools p LEFT JOIN onchain_tokens t ON t.address=p.token')).map(p=>[p.pool,p]));
 if(!pools.size)return [];
 const rows=[];
 for(const [key,version] of [['tape:v3','v3'],['tape:v4','v4'],['tape:v2','v2']]){
  const cursor=await readCursor(key);
  const ranges=plan(cursor,head,{back});
  if(!ranges.length)continue;
  let oldest=cursor?.oldest??ranges[0].from,newest=cursor?.head??head;
  for(const range of ranges){
   // v4 swaps all come from the one PoolManager. v3 swaps are matched by pool address after the fetch,
   // because one unfiltered query costs less than a filter listing every pool we know.
   const logs=await rpc().getLogs({...(version==='v4'?{address:V4_POOL_MANAGER,event:v4Swap}:{event:version==='v2'?v2Swap:v3Swap}),
    fromBlock:BigInt(range.from),toBlock:BigInt(range.to)});
   for(const log of logs){
    if(log.removed)continue;
    const id=String(version==='v4'?log.args.id:log.address).toLowerCase();
    const pool=pools.get(id);
    if(!pool||pool.version!==version)continue;
    if(pool.decimals==null)continue;   // metadata not read yet; the next pass picks it up
    const row=decodeSwap(log,pool,Number(pool.decimals));
    if(row&&row.at!=null)rows.push(row);
   }
   oldest=Math.min(oldest,range.from);newest=Math.max(newest,range.to);
  }
  const oldestAt=Number((await rpc().getBlock({blockNumber:BigInt(oldest)})).timestamp);
  await writeCursor(key,newest,oldest,oldestAt);
 }
 if(rows.length)await saveTrades(rows);
 return rows;
}

async function saveTrades(rows){
 for(let i=0;i<rows.length;i+=250){
  await q(`INSERT INTO onchain_trades(pool,block,log_index,token,at,price,usd_volume,buy,trader,tx)
   SELECT pool,block,log_index,token,at,price,usd_volume,buy,trader,tx
   FROM jsonb_to_recordset($1::jsonb) AS x(pool text,block bigint,log_index int,token text,at bigint,price numeric,usd_volume numeric,buy boolean,trader text,tx text)
   ON CONFLICT(pool,block,log_index) DO NOTHING`,[JSON.stringify(rows.slice(i,i+250))]);
 }
}

// Name, symbol, decimals and supply, read from the token itself. Read once; these do not change.
export async function readTokenMeta(limit=25){
 await init();
 // Tokens that have actually traded are described first, then the most recently created. Reading them in
 // address order meant a market somebody is trading could wait behind thousands of pools that never did.
 const pending=await q(`SELECT p.token,
   (SELECT COUNT(*) FROM onchain_trades s WHERE s.token=p.token)::int AS trades,
   MAX(p.created_block) AS newest
  FROM onchain_pools p LEFT JOIN onchain_tokens t ON t.address=p.token
  WHERE t.address IS NULL OR t.decimals IS NULL
  GROUP BY p.token ORDER BY trades DESC, newest DESC LIMIT $1`,[limit]);
 const out=[];
 for(const {token} of pending){
  const one=fn=>rpc().readContract({address:token,abi:erc20,functionName:fn}).catch(()=>null);
  const [name,symbol,decimals,supply]=await Promise.all([one('name'),one('symbol'),one('decimals'),one('totalSupply')]);
  if(decimals==null)continue;
  out.push({address:token,name:name==null?'':String(name),symbol:symbol==null?'':String(symbol),
   decimals:Number(decimals),total_supply:supply==null?null:String(supply)});
 }
 if(out.length)await q(`INSERT INTO onchain_tokens(address,name,symbol,decimals,total_supply,read_at)
  SELECT address,name,symbol,decimals,total_supply,$2 FROM jsonb_to_recordset($1::jsonb)
  AS x(address text,name text,symbol text,decimals int,total_supply numeric)
  ON CONFLICT(address) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,decimals=excluded.decimals,
   total_supply=excluded.total_supply,read_at=excluded.read_at`,[JSON.stringify(out),Math.floor(Date.now()/1000)]);
 return out;
}

// Pool reserves for v3, which is two balance reads. A v4 pool's funds sit inside the shared PoolManager,
// so a per-pool balance cannot be read this way; those stay unknown rather than being guessed.
export async function readLiquidity(limit=20){
 await init();
 const rows=await q(`SELECT p.pool,p.token,t.decimals FROM onchain_pools p JOIN onchain_tokens t ON t.address=p.token
  WHERE p.version IN ('v2','v3') AND t.decimals IS NOT NULL
  AND EXISTS(SELECT 1 FROM onchain_trades s WHERE s.pool=p.pool AND s.at>$1) LIMIT $2`,[Math.floor(Date.now()/1000)-86400,limit]);
 const out=new Map();
 for(const r of rows){
  const usdc=await rpc().readContract({address:USDC,abi:erc20,functionName:'balanceOf',args:[r.pool]}).catch(()=>null);
  if(usdc==null)continue;
  // The USDC actually sitting in the pool. Reported as it is, not doubled to stand for both sides.
  out.set(r.token,(out.get(r.token)||0)+Number(usdc)/1e6);
 }
 return out;
}

const changeFrom=(trades,now,seconds,last)=>{
 const before=trades.filter(t=>t.at<=now-seconds);
 if(!before.length||!(last>0))return null;
 const then=Number(before[before.length-1].price);
 return then>0?(last/then-1)*100:null;
};

// Rows in the shape the rest of the app already uses, built only from what we read ourselves.
export async function onchainMarkets(now=Math.floor(Date.now()/1000)){
 await init();
 const coverage=await tapeCoverage();
 const links=await chainMetadata().catch(()=>new Map());
 const [pools,tokens,trades,liquidity]=await Promise.all([
  q('SELECT token,version,MIN(created_at) AS created_at,COUNT(*)::int AS pools FROM onchain_pools GROUP BY token,version'),
  q('SELECT * FROM onchain_tokens'),
  q('SELECT token,at,price,usd_volume,buy,trader FROM onchain_trades WHERE at>$1 ORDER BY token,at',[now-86400]),
  readLiquidity().catch(()=>new Map())
 ]);
 const meta=new Map(tokens.map(t=>[t.address,t]));
 const byToken=new Map();
 for(const t of trades){if(!byToken.has(t.token))byToken.set(t.token,[]);byToken.get(t.token).push(t);}
 const shape=new Map();
 for(const p of pools){
  const entry=shape.get(p.token)||{versions:new Set(),created:null};
  entry.versions.add(p.version);
  const at=p.created_at==null?null:Number(p.created_at);
  if(at!=null&&(entry.created==null||at<entry.created))entry.created=at;
  shape.set(p.token,entry);
 }
 const rows=[];
 for(const [token,entry] of shape){
  const info=meta.get(token);
  if(!info||info.decimals==null)continue;   // unread token: listed only once we can state its numbers
  const tape=byToken.get(token)||[];
  const last=tape.length?Number(tape[tape.length-1].price):null;
  const supply=info.total_supply==null?null:Number(info.total_supply)/10**Number(info.decimals);
  const volume=tape.reduce((a,t)=>a+Number(t.usd_volume||0),0);
  const traders=new Set(tape.map(t=>t.trader).filter(Boolean)).size;
  const versions=[...entry.versions];
  // A venue is only named for the two we can name with certainty. A v2 pair is recorded as v2 without
  // claiming which exchange's front end it belongs to.
  // Discovered from Uniswap's own factories, so that is what it is called. There is no separate on-chain
  // source any more: the same markets used to arrive twice, once from our reading and once from a feed.
  const m={feed_schema:2,source:'uniswap',data_provider:'self',versions,
   venues:versions.filter(v=>v!=='v2').map(v=>'uniswap-'+v),provider_updated_at:now};
  // Only what we actually measured. A field we cannot compute is left unset so another source's value
  // is not overwritten with a blank.
  if(last!=null){m.price=last;if(supply>0)m.mcap=last*supply;}
  if(entry.created!=null){m.token_created_at=entry.created;}
  // A window is only called a day when the tape covers a day, or when the token is younger than the
  // tape and we therefore hold every trade it ever had. Otherwise the totals stay unset, so a partial
  // backfill never understates a market that another source already measured properly.
  const whole=coverage!=null&&(coverage<=now-86400||(entry.created!=null&&entry.created>=coverage));
  if(coverage!=null)m.onchain_from=coverage;
  if(!whole)m.onchain_partial=true;
  if(tape.length&&whole){
   m.volume24h=volume;m.txns24h=tape.length;m.buys24h=tape.filter(t=>t.buy).length;
   m.sells24h=tape.length-m.buys24h;m.last_trade_at=Number(tape[tape.length-1].at);
   if(traders)m.traders24h=traders;
   m.changes={'5m':changeFrom(tape,now,300,last),'1h':changeFrom(tape,now,3600,last),
    '6h':changeFrom(tape,now,21600,last),'24h':changeFrom(tape,now,86400,last)};
   m.spark=tape.filter((_,i)=>i%Math.max(1,Math.ceil(tape.length/15))===0).map(t=>Number(t.price)).slice(-15);
  }else if(tape.length){
   // Price and the time of the last trade are true whatever the tape covers; only totals need a window.
   m.last_trade_at=Number(tape[tape.length-1].at);
  }
  if(liquidity.has(token))m.liquidity=liquidity.get(token);
  // The token's own picture and links, published by whoever launched it, preferred over anything a third
  // party says about it. Absent on chain, these stay unset and a pad's own API can still fill them.
  const published=links.get(token);
  if(published){
   if(published.logo)m.logo=published.logo;
   if(published.website)m.website=published.website;
   if(published.twitter)m.twitter=published.twitter;
   if(published.telegram)m.telegram=published.telegram;
   if(published.description)m.description=published.description;
  }
  rows.push({address:token,name:info.name||'',symbol:info.symbol||'',decimals:Number(info.decimals),
   total_supply:info.total_supply==null?null:String(info.total_supply),
   creation_at:entry.created,launchpad_id:'uniswap',factory:null,metadata:m});
 }
 return rows;
}

// Supply taken out of circulation, read from the chain rather than trusted from a feed. Tokens are burned
// by sending them where nobody holds the key: the dead address, and sometimes the zero address. Both are
// counted, and the total supply is read at the same time so the share is consistent with it.
const BURN_ADDRESSES=['0x000000000000000000000000000000000000dead','0x0000000000000000000000000000000000000000'];
export async function readBurned(token,decimals,supplyRaw){
 const address=String(token||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(address))return null;
 const read=fn=>rpc().readContract({address,abi:erc20,functionName:fn,...(fn==='balanceOf'?{}:{})});
 const [supply,...balances]=await Promise.all([
  supplyRaw!=null?Promise.resolve(BigInt(supplyRaw)):read('totalSupply').catch(()=>null),
  ...BURN_ADDRESSES.map(dead=>rpc().readContract({address,abi:erc20,functionName:'balanceOf',args:[dead]}).catch(()=>null))
 ]);
 if(balances.every(b=>b==null))return null;
 const burnedRaw=balances.reduce((a,b)=>a+(b??0n),0n);
 const scale=10**Number(decimals??18);
 const burned=Number(burnedRaw)/scale;
 const total=supply==null?null:Number(supply)/scale;
 return {burned,total,percent:total>0?burned/total*100:null,
  circulating:total==null?null:Math.max(0,total-burned)};
}

// The addresses that are a market rather than a person, so a holder list can say so.
// The market we would read a token's history from, taken from our own discovery rather than from a feed.
// The busiest pool wins; a v4 pool comes with the key material its reader needs, so v4 tokens are covered
// as well as v2 and v3.
// Names we already read from token contracts while indexing. A pad's launch list can use these straight
// away instead of asking the chain again one token at a time.
// Asking the factories for a token's pool instead of waiting to meet it in history.
//
// A launch we already know about does not need to be rediscovered by walking backwards through millions
// of blocks: the factory can be asked directly whether a USDC pool exists for it. That is one call per fee
// tier, and it puts a pad's older tokens on the site straight away rather than whenever the backfill
// happens to reach them.
const v3Factory=parseAbi(['function getPool(address,address,uint24) view returns (address)']);
const v2Factory=parseAbi(['function getPair(address,address) view returns (address)']);
const FEES=[100,500,3000,10000];
const ZERO='0x0000000000000000000000000000000000000000';

const POOL_LOOKUP=Math.max(1,Math.min(400,Number(process.env.POOL_LOOKUP_PER_PASS||60)));

export async function findPoolsFor(tokens,{limit=POOL_LOOKUP}={}){
 await init();
 const found=[];
 for(const token of tokens.slice(0,limit)){
  // One token's questions go out together: which fee tiers exist on each v3 factory, and whether a v2 pair
  // exists. A pad's back catalogue is thousands of tokens, and asking these one at a time was the
  // difference between a list filling in minutes and filling in hours.
  const asks=[
   ...V3_FACTORIES.flatMap(factory=>FEES.map(fee=>
    rpc().readContract({address:factory,abi:v3Factory,functionName:'getPool',args:[token,USDC,fee]})
     .then(pool=>({pool,version:'v3',fee})).catch(()=>null))),
   ...V2_FACTORIES.map(factory=>
    rpc().readContract({address:factory,abi:v2Factory,functionName:'getPair',args:[token,USDC]})
     .then(pool=>({pool,version:'v2',fee:null})).catch(()=>null))
  ];
  for(const hit of await Promise.all(asks)){
   if(!hit?.pool||String(hit.pool).toLowerCase()===ZERO)continue;
   found.push({pool:String(hit.pool).toLowerCase(),token,version:hit.version,fee:hit.fee,
    tick_spacing:null,hooks:null,token_is_token0:token<USDC,created_block:null,created_at:null});
  }
 }
 if(found.length)await savePools(found);
 return found;
}

// Launches and tokens we hold that have no pool recorded yet, newest first.
export async function tokensMissingPools(limit=POOL_LOOKUP){
 await init();
 const rows=await q(`SELECT l.token,MAX(l.block) AS block FROM pad_launches l
  LEFT JOIN onchain_pools p ON p.token=l.token
  WHERE p.token IS NULL GROUP BY l.token ORDER BY MAX(l.block) DESC LIMIT $1`,[limit]);
 return rows.map(r=>r.token);
}

// The newest trades we hold for a token, straight from the tape the indexer keeps at the chain head.
export async function recentTrades(token,limit=100){
 await init();
 const address=String(token||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(address))return [];
 const rows=await q(`SELECT at,price,usd_volume,buy,trader,tx FROM onchain_trades
  WHERE token=$1 ORDER BY at DESC,block DESC,log_index DESC LIMIT $2`,[address,Math.max(1,Math.min(500,limit))]);
 return rows.map(r=>({at:Number(r.at),price:Number(r.price),usd_volume:Number(r.usd_volume),
  buy:r.buy===true,trader:r.trader||null,tx:r.tx||null}));
}

export async function knownNames(addresses){
 await init();
 const list=[...new Set((addresses||[]).map(a=>String(a||'').toLowerCase()))].filter(a=>/^0x[0-9a-f]{40}$/.test(a));
 if(!list.length)return new Map();
 const rows=await q('SELECT address,name,symbol,decimals FROM onchain_tokens WHERE address=ANY($1::text[]) AND decimals IS NOT NULL',[list]);
 return new Map(rows.map(r=>[r.address,{name:r.name||'',symbol:r.symbol||'',decimals:Number(r.decimals)}]));
}

export async function bestPool(token){
 await init();
 const address=String(token||'').toLowerCase();
 const rows=await q(`SELECT p.pool,p.version,p.fee,p.tick_spacing,p.hooks,
   (SELECT COUNT(*) FROM onchain_trades t WHERE t.pool=p.pool)::int AS trades
  FROM onchain_pools p WHERE p.token=$1 ORDER BY trades DESC, p.created_block ASC LIMIT 1`,[address]);
 const pool=rows[0];
 if(!pool)return null;
 return {
  pool:pool.pool,
  descriptor:pool.version==='v4'?{version:'v4',quoteToken:USDC,nativeQuote:false,
   feeTier:Number(pool.fee),tickSpacing:Number(pool.tick_spacing),hooks:pool.hooks}:null
 };
}

export async function poolAddresses(token){
 await init();
 const rows=await q("SELECT pool,version FROM onchain_pools WHERE token=$1 AND version<>'v4'",[String(token||'').toLowerCase()]);
 return rows.map(r=>({address:r.pool,label:'Pool'}));
}

export async function onchainStatus(){
 await init();
 const coverage=await tapeCoverage();
 const [counts]=await q(`SELECT (SELECT COUNT(*)::int FROM onchain_pools) AS pools,
  (SELECT COUNT(DISTINCT token)::int FROM onchain_pools) AS tokens,
  (SELECT COUNT(*)::int FROM onchain_tokens WHERE decimals IS NOT NULL) AS described,
  (SELECT COUNT(*)::int FROM onchain_trades) AS trades`);
 return {...counts,coverage_from:coverage,coverage_hours:coverage?Number(((Date.now()/1000-coverage)/3600).toFixed(1)):null,cursors:await q('SELECT k,head,oldest,updated FROM onchain_cursor ORDER BY k')};
}

// One cycle: follow the chain forward, reach one window further back, describe new tokens, decode trades.
export async function onchainSync({back=true}={}){
 await init();
 const head=Number(await rpc().getBlockNumber());
 const pools=await discoverPools({head,back});
 const described=await readTokenMeta();
 const trades=await collectTrades({head,back});
 return {head,pools:pools.length,described:described.length,trades:trades.length};
}
