import {q} from './db.js';
import {number,directDetail} from './direct.js';
import {ownChart} from './chart-engine.js';
import {SOURCES,launchpadId} from '../public/sources.js';
import {persistRecords} from './providers.js';
import {requestSnapshot,readSnapshot,publishSnapshot,initSnapshots} from './snapshots.js';
import {readBurned,recentTrades} from './onchain.js';
import {launchMeta} from './argus.js';
import {crossQuote,nonUsdQuote} from './quote-values.js';
import {marketEvents} from './market-events.js';
marketEvents.on('changed',()=>invalidateMarkets());
let snapshot=null,until=0,inflight=null;
// Slow supply RPCs must not hold up a fresh transaction/chart snapshot.
const burnValues=new Map(),burnFlights=new Set();
const warmed=new Map();
// A reading counts once the burned amount is known. Tying it to the dead-address share alone threw away
// readings whose total supply the RPC refused, which is the same refusal that leaves the panel empty.
const usableBurn=v=>Number.isFinite(v?.burned)||Number.isFinite(v?.deadPercent);
function cachedBurn(row){
 const key=row.address,stored=row.metadata?.burn_reading;
 const hit=burnValues.get(key)||(stored?.value?{value:stored.value,until:Number(stored.at)+60000}:null);
 if((!hit||hit.until<Date.now())&&!burnFlights.has(key)&&burnFlights.size<4){
  burnFlights.add(key);
  readBurned(key,row.decimals,row.total_supply).then(async value=>{
   if(burnValues.size>=1000)burnValues.delete(burnValues.keys().next().value);
   burnValues.set(key,{value:usableBurn(value)?value:hit?.value||null,until:Date.now()+60000});
   if(usableBurn(value))await q('UPDATE tokens SET metadata=metadata||$2::jsonb WHERE address=$1',
    [key,JSON.stringify({burn_reading:{value,at:Date.now()}})]).catch(()=>null);
  }).catch(()=>burnValues.set(key,{value:hit?.value||null,until:Date.now()+30000})).finally(()=>burnFlights.delete(key));
 }
 return hit?.value||null;
}
export function burnFields(row){
 const burn=cachedBurn(row);
 return {deadBurnedPercent:burn?.deadPercent??null,burnLoading:!usableBurn(burn)&&burnFlights.has(row.address),
  totalSupply:burn?.total??null,circulating:burn?.circulating??null,
  burned:burn&&burn.burned>=1?burn.burned:null,burnedPercent:burn&&burn.burned>=1?burn.percent:null};
}
const sources=new Set(Object.keys(SOURCES));
const validTime=v=>{const n=number(v);return n>0&&n<=Date.now()/1000+60?n:null;};
const finiteArray=a=>Array.isArray(a)?a.map(number).filter(n=>n!=null&&n>=0):[];
export function mapMarket(t){
 const raw=t.metadata||{},verified=raw.feed_schema===2,m=verified?raw:{token_created_at:raw.token_created_at,logo:raw.logo,website:raw.website,twitter:raw.twitter,telegram:raw.telegram};
 const source=(verified?m.source:null)||t.launchpad_id||raw.archive_source||null;
 return {address:t.address,name:t.name,symbol:t.symbol,source,launchpad:launchpadId(t.launchpad_id),quoteToken:m.quote_token||null,quotePending:!!m.quote_pending,
  price:number(m.price),marketCap:number(m.mcap),liquidity:number(m.liquidity),volume:number(m.volume24h),
  transactions:number(m.txns24h),traders:number(m.traders24h),holders:number(m.holders),
  buys:number(m.buys24h),sells:number(m.sells24h),changes:m.changes||{},spark:finiteArray(m.spark),
  createdAt:validTime(m.token_created_at),lastTradeAt:validTime(m.last_trade_at),
  // The two sides of the day and the fully diluted figure, shown beside the totals.
  buyVolume:number(m.buy_volume24h),sellVolume:number(m.sell_volume24h),
  buyers:number(m.buyers24h),sellers:number(m.sellers24h),fdv:number(m.fdv),
  updatedAt:validTime(m.provider_updated_at),logo:m.logo||null,website:m.website||null,
  twitter:m.twitter||null,telegram:m.telegram||null,versions:Array.isArray(m.versions)?m.versions:[],
  venues:[...new Set([...(m.venues||[]),...(m.versions||[]).filter(v=>v==='v3'||v==='v4').map(v=>'uniswap-'+v)])],chartProvider:m.chart_provider||null,pool:m.pool||null,marketData:sources.has(m.source),stale:!(Number(m.provider_updated_at)>Date.now()/1000-180)};
}
export function invalidateMarkets(){until=0;}
// A list row is stamped fresh on every market round even when its feed answered from cache, so its price
// could predate the token's latest trades by a wide margin while the token page, reading those trades,
// showed the real one. The newest trade in the token's stored detail therefore wins over the row when it is
// newer than the last trade the row knows of, and the valuation moves with it at the row's own supply.
const PREPARED_MAX_AGE_MS=15*60000;
export function withPreparedPrice(market,prepared,preparedAt,metadata,now=Date.now()){
 if(!market||!prepared||!(Number(preparedAt)>now-PREPARED_MAX_AGE_MS))return market;
 if(crossQuote(metadata)||nonUsdQuote(market.quoteToken)||market.quotePending)return market;
 const trade=(prepared.trades||[]).filter(t=>number(t.price)>0&&Number(t.at)>0&&Number(t.at)<=now/1000+60).reduce((a,t)=>!a||Number(t.at)>Number(a.at)?t:a,null);
 if(!trade||!(Number(trade.at)>(market.lastTradeAt||0)))return market;
 const price=Number(trade.price);
 const supplyOf=(cap,p)=>number(cap)>0&&number(p)>0?cap/p:null;
 const supply=supplyOf(market.marketCap,market.price)??supplyOf(prepared.market?.marketCap,prepared.market?.price);
 const fdvSupply=supplyOf(market.fdv,market.price)??supplyOf(prepared.market?.fdv,prepared.market?.price);
 return {...market,price,lastTradeAt:Number(trade.at),
  marketCap:supply==null?market.marketCap:price*supply,fdv:fdvSupply==null?market.fdv:price*fdvSupply};
}
async function allMarkets(){
 await initSnapshots();
 if(snapshot&&until>Date.now())return snapshot;
 if(inflight)return inflight;
 inflight=q(`SELECT t.*,l.launchpad_id,s.payload AS prepared,s.updated AS prepared_at FROM tokens t LEFT JOIN launches l ON l.token=t.address
 LEFT JOIN LATERAL (SELECT payload,updated FROM market_snapshots_v3 WHERE token=t.address ORDER BY updated DESC LIMIT 1) s ON true
 WHERE (t.metadata->>'feed_schema'='2' OR t.metadata->>'catalog_schema'='2')`).then(rows=>{
  snapshot=rows.map(r=>withPreparedPrice(mapMarket(r),r.prepared,r.prepared_at,r.metadata));until=Date.now()+10000;return snapshot;
 }).finally(()=>{inflight=null;});return inflight;
}
const sum=(rows,key)=>{const vs=rows.map(r=>r[key]).filter(v=>v!=null);return vs.length?vs.reduce((a,b)=>a+b,0):null;};
export async function marketPricesFor(addresses){
 const wanted=new Set(addresses.map(a=>a.toLowerCase()));
 if(!wanted.size)return new Map();
 return new Map((await allMarkets()).filter(row=>wanted.has(row.address)).map(row=>[row.address,row]));
}
export function selectMarkets(all,options={},now=Math.floor(Date.now()/1000)){
 const query=String(options.q||'').trim().toLowerCase().slice(0,100);
 const active=r=>r.marketData&&(r.volume>0||r.lastTradeAt>now-86400);
 const activeRows=all.filter(active);
 // Every token we hold is in the list, whether or not it traded today. A market that has gone quiet is
 // still a market someone may be looking for, and sorting by volume already puts it where it belongs.
 // The active set is kept only for the header totals and the most active tape.
 let rows=all.slice();
 if(query)rows=rows.filter(r=>[r.address,r.symbol,r.name].some(v=>String(v).toLowerCase().includes(query)));
 if(options.source)rows=rows.filter(r=>r.source===options.source);
 if(options.launchpad)rows=rows.filter(r=>r.launchpad===options.launchpad);
 if(options.version)rows=rows.filter(r=>r.versions.includes(options.version));
 if(options.venue)rows=rows.filter(r=>(r.venues||[]).includes(options.venue));
 if(options.mode==='new')rows=rows.filter(r=>r.createdAt>now-7*86400);
 if(options.mode==='gainers')rows=rows.filter(r=>number(r.changes['24h'])>0);
 if(options.mode==='losers')rows=rows.filter(r=>number(r.changes['24h'])<0);
 if(options.mode==='watch'){const watch=new Set(String(options.addresses||'').toLowerCase().split(',').slice(0,100));rows=rows.filter(r=>watch.has(r.address));}
 for(const [option,key] of [['minLiquidity','liquidity'],['minVolume','volume']])if(number(options[option])>0)rows=rows.filter(r=>r[key]!=null&&r[key]>=Number(options[option]));
 const keys=new Set(['price','marketCap','liquidity','volume','transactions','holders','createdAt','change']);
 // A search is ranked by market cap rather than by the day's volume: dozens of contracts share a ticker,
 // and what tells the real market apart from a copy is what it is worth, not how busy it was today.
 const sort=keys.has(options.sort)?options.sort:options.mode==='new'?'createdAt':['gainers','losers'].includes(options.mode)?'change':query?'marketCap':'volume';
 const direction=options.dir==='asc'||(!options.dir&&options.mode==='losers')?1:-1;
 const value=r=>sort==='change'?number(r.changes['24h']):r[sort];
 rows.sort((a,b)=>{
  if(query){const rank=r=>r.address===query?0:String(r.symbol).toLowerCase()===query?1:2;const d=rank(a)-rank(b);if(d)return d;}
  const av=value(a),bv=value(b);if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
  return (av!=null&&bv!=null?(av-bv)*direction:0)||a.address.localeCompare(b.address);
 });
 // The browsable list stops at a few hundred rows. Everything else is still held, still searchable and
 // still indexed; it simply is not something anyone pages through. A search is never capped, because there
 // the reader has named what they are looking for.
 const cap=Math.max(50,Math.min(5000,Number(process.env.LIST_CAP||250)));
 const held=rows.length;
 if(!query&&rows.length>cap)rows=rows.slice(0,cap);
 const limit=Math.min(100,Math.max(10,Math.floor(Number(options.limit)||50))),pages=Math.max(1,Math.ceil(rows.length/limit));
 const page=Math.min(pages,Math.max(1,Math.floor(Number(options.page)||1)));
 return {rows:rows.slice((page-1)*limit,page*limit),total:rows.length,held,page,pages,limit,
  stats:{active:activeRows.length,archived:all.length,volume:sum(activeRows,'volume'),liquidity:sum(activeRows,'liquidity'),transactions:sum(activeRows,'transactions'),partial:true},
  trending:activeRows.filter(r=>r.price!=null).sort((a,b)=>(b.volume||0)-(a.volume||0)).slice(0,8),
  sources:[...new Set(all.map(r=>r.source).filter(Boolean))].map(id=>({id,markets:activeRows.filter(r=>r.source===id).length})),
  updatedAt:Math.max(0,...all.map(r=>r.updatedAt||0)),generatedAt:now};
}
export async function listMarkets(options={}){
 const query=String(options.q||'').trim().slice(0,100);
 // Search reads what we hold. There is no remote discovery step any more: everything in the list came
 // from our own reading of the chain or from a pad's own API, so there is nothing further to ask.
 return selectMarkets(await allMarkets(),options);
}
// The first contract to carry a ticker. A symbol is not unique on chain, so being the oldest one is
// worth saying, but it is only ever the oldest we know about: a token we have never indexed cannot be
// compared. Ties and unknown creation dates leave the mark off rather than handing it to a guess.
export async function isOriginalTicker(address,symbol){
 const ticker=String(symbol||'').trim();
 if(!ticker)return false;
 const rows=await q(`SELECT address,(metadata->>'token_created_at')::bigint AS at FROM tokens
  WHERE lower(symbol)=lower($1) AND (metadata->>'token_created_at') IS NOT NULL
  ORDER BY at ASC,address ASC LIMIT 2`,[ticker]);
 if(!rows.length)return false;
 const first=rows[0];
 if(first.address!==address.toLowerCase())return false;
 // Two contracts claiming the same second is not a first.
 return !(rows[1]&&Number(rows[1].at)===Number(first.at));
}

export async function buildMarket(address,tf='1h'){
 if(!/^0x[0-9a-f]{40}$/i.test(address))throw Error('Invalid token address');
 if(!['1m','5m','15m','1h','4h','1d'].includes(tf))throw Error('Invalid timeframe');
 const row=(await q('SELECT t.*,l.launchpad_id FROM tokens t LEFT JOIN launches l ON l.token=t.address WHERE t.address=$1 AND (t.metadata->>\'feed_schema\'=\'2\' OR t.metadata->>\'catalog_schema\'=\'2\')',[address.toLowerCase()]))[0];
 if(!row)return null;const market=mapMarket(row);
 let remote=null,error=null;try{remote=await directDetail(market.chartProvider||market.source,market.address,tf);}catch(e){error=e.message;}
 const savedPool=row.metadata?.index_pool,savedPools=row.metadata?.index_pools||[];
 if(!remote)remote={detail:null,candles:[],closes:[],trades:[],errors:{detail:error}};
 if(!remote.detail&&savedPool)remote.detail={bestPool:savedPool,pools:savedPools};
 if(remote?.detail){
  const d=remote.detail,dt=d.token||d;
  market.createdAt=validTime(dt.deployTs||dt.created_ts||dt.created_at)||market.createdAt;
  market.price=number(d.price??d.priceUsd??d.live?.currentPrice??d.live?.price??d.token_snapshots?.price)??market.price;
  market.marketCap=number(d.mcap??d.marketCapUsd??d.live?.market_cap??d.live?.marketCap??d.token_snapshots?.market_cap)??market.marketCap;
  market.fdv=number(d.fdv)??market.fdv;
  if(number(d.price)>0&&number(d.mcap)!=null){
   market.valuationAt=Math.floor(Date.now()/1000);
   market.fdv=number(d.fdv);
  }
  market.quoteToken=d.quoteToken||market.quoteToken;
  market.liquidity=number(dt.liquidityUsdc??dt.liquidity??d.liquidityUsd??d.live?.liquidity)??market.liquidity;
  market.buys=number(d.buys24??d.buys24h)??market.buys;market.sells=number(d.sells24??d.sells24h)??market.sells;
  market.pool=d.bestPool||dt.pool||market.pool;
  if(market.pool&&(market.pool!==savedPool||Array.isArray(d.pools))){
   await q(`UPDATE tokens SET metadata=metadata||$2::jsonb WHERE address=$1`,[address.toLowerCase(),JSON.stringify({index_pool:market.pool,index_pools:d.pools||savedPools})]);
  }
  market.telegram=dt.telegram||market.telegram;
  market.twitter=dt.twitter||market.twitter;market.website=dt.website||market.website;
 }
 if(remote){
  try{const generated=await ownChart(market.source,market.address,tf,remote,market);
   remote={...remote,...generated,errors:{...remote.errors,chart:generated.candles.length?null:remote.errors?.chart,chartNotice:generated.notice}};
  }catch(e){remote={...remote,candles:[],closes:[],errors:{...remote.errors,chart:'Local chart engine: '+e.message}};}
 }
 // Burned supply is read from the token itself rather than taken from a feed, so it is present whatever
 // source the rest of the row came from. A failed read leaves it unknown instead of implying zero.
 try{
  const burn=cachedBurn(row);
  market.deadBurnedPercent=burn?.deadPercent??null;
  // Dust left at a burn address is not a burn. Below a whole token it reads as "0 · 0.00%", which says
  // less than showing nothing at all.
  if(burn&&burn.burned>=1){market.burned=burn.burned;market.burnedPercent=burn.percent;market.circulating=burn.circulating;}
 }catch{/* the panel simply omits it */}
 try{market.originalTicker=await isOriginalTicker(market.address,market.symbol);}catch{/* the mark is simply absent */}
 // The trade list is taken from our own tape when it is ahead, because the indexer follows the chain head
 // continuously while a chart store is only refreshed when somebody is looking at that token. This is what
 // made transactions arrive a minute or more after they happened.
 const tape=nonUsdQuote(market.quoteToken)||crossQuote(row.metadata)||!market.pool?[]:await recentTrades(address,100,market.pool).catch(()=>[]);
 const fromProvider=remote?.trades||[];
 const trades=(tape.length&&(!fromProvider.length||(tape[0]?.at||0)>=(fromProvider[0]?.at||0)))?tape:fromProvider;
 if(trades[0]?.at)market.lastTradeAt=validTime(trades[0].at)||market.lastTradeAt;
 // The price is not taken from the last candle. Each timeframe's snapshot is prepared at its own moment,
 // so reading the price off the chart made the same token show a different price on 1m than on 1d, and
 // the market cap scale with it. The figure comes from the market row and is refreshed when served.
 return {market,timeframe:tf,candles:remote?.candles||[],closes:remote?.closes||[],chartMode:remote?.chartMode||'candles',history:remote?.history,trades,errors:remote?.errors||{detail:error},
  supported:!!remote,receivedAt:Math.floor(Date.now()/1000)};
}

// What a snapshot holds of its own timeframe stays; what the market is worth right now comes from the
// row, so every timeframe agrees and none of them shows a figure older than the last sync.
const LIVE_FIGURES=['price','marketCap','fdv','liquidity','volume','transactions','traders','holders','buys','sells','changes','lastTradeAt','spark'];
export function withLiveFigures(market,row){
 if(!market||!row)return market;
 const live=mapMarket(row);
 const merged={...market};
 merged.launchpad=live.launchpad;
 for(const key of LIVE_FIGURES)if(live[key]!=null)merged[key]=live[key];
 if(row.metadata?.feed_schema===2)for(const key of ['price','marketCap','fdv'])merged[key]=live[key];
 // Do not overwrite a coherent fresh USD detail packet with an older list round.
 if(market.valuationAt>(live.updatedAt||0))for(const key of ['price','marketCap','fdv'])merged[key]=market[key];
 // A failed quote conversion must not resurrect a stale, quote-denominated valuation.
 if(live.quotePending&&!(market.valuationAt>(live.updatedAt||0)))for(const key of ['price','marketCap','fdv'])merged[key]=null;
 return merged;
}

// Rebuilds in the background, one per token and timeframe at a time.
const rebuilding=new Set();
function refreshDetail(address,tf){
 const key=address+':'+tf;
 if(rebuilding.has(key)||rebuilding.size>6)return;
 rebuilding.add(key);
 // The rebuilt payload has to be stored, or the page keeps reading the same old snapshot: the work was
 // being done and thrown away, which is why a token page could sit on transactions from ten minutes ago
 // however often it polled.
 buildMarket(address,tf)
  .then(payload=>payload&&publishSnapshot(address,tf,payload))
  .catch(()=>null).finally(()=>rebuilding.delete(key));
}

export async function getMarket(address,tf='1h'){
 if(!/^0x[0-9a-f]{40}$/i.test(address)||!['1m','5m','15m','1h','4h','1d'].includes(tf))throw Error('Invalid market request');
 address=address.toLowerCase();
 let row=(await q('SELECT t.*,l.launchpad_id FROM tokens t LEFT JOIN launches l ON l.token=t.address WHERE t.address=$1',[address]))[0];
 if(!row)return null;
 // A token nothing has described yet is named here, once. Naming runs in the background newest first, so
 // an older launch could sit unnamed for a long time: it could not be found by its name and it sorted to
 // the bottom of every list, which reads as the token being missing rather than merely unlabelled.
 if(!String(row.symbol||'').trim()){
  const meta=await launchMeta(address).catch(()=>null);
  if(meta?.symbol){
   await q('UPDATE tokens SET name=$2,symbol=$3,decimals=COALESCE(decimals,$4) WHERE address=$1',
    [address,meta.name||'',meta.symbol,meta.decimals??null]).catch(()=>null);
   row={...row,name:meta.name||row.name,symbol:meta.symbol,decimals:row.decimals??meta.decimals??null};
   invalidateMarkets();
  }
 }
 const warmKey=address+':'+tf;
 if(!(warmed.get(warmKey)>Date.now())){
 if(warmed.size>=1000)warmed.delete(warmed.keys().next().value);
 warmed.set(warmKey,Date.now()+10000);
 await requestSnapshot(address,tf,10);
 // The other timeframes of a token someone is looking at are prepared behind them, at lower priority.
 // Switching is then a read rather than a build, which is what made it feel slow the first time.
 for(const frame of ['1m','5m','15m','1h','4h','1d'])if(frame!==tf)requestSnapshot(address,frame,3).catch(()=>null);
 }
 const saved=await readSnapshot(address,tf);
 // A snapshot older than a few seconds is rebuilt here rather than served as it stands. It was only ever
 // refreshed by the background worker, so a page could show trades and candles from a minute ago, and each
 // timeframe was prepared at its own moment and therefore disagreed with the others.
 const age=saved?Date.now()-saved.updated:Infinity;
 const stale=age>Math.max(1000,Number(process.env.DETAIL_MAX_AGE_MS||4000));
 // What we already hold is served straight away, and a stale one is rebuilt behind the request instead of
 // in front of it. Waiting for the rebuild made every page load after a restart sit on an empty chart,
 // even though the candles were already in the database; the page polls, so the fresh build arrives on its
 // own a moment later.
 if(saved){
  if(stale)refreshDetail(address,tf);
  return {...saved.payload,market:withLiveFigures(saved.payload.market,row),
   cache:{updatedAt:saved.updated,stale:age>60000}};
 }
 refreshDetail(address,tf);
 // The burn is read from the token, not from the snapshot being prepared, so the first paint carries it
 // rather than leaving the panel empty until the build lands.
 return {market:{...mapMarket(row),...burnFields(row)},timeframe:tf,candles:[],closes:[],trades:[],chartMode:'candles',supported:true,
 history:{loading:true,complete:false},errors:{chartNotice:'Historical data is being prepared in the background.'},cache:{pending:true}};
}
