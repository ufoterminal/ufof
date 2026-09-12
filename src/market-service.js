import {q} from './db.js';
import {number,directDetail} from './direct.js';
import {ownChart} from './chart-engine.js';
import {SOURCES} from '../public/sources.js';
import {dexMarkets} from './dex-markets.js';
import {persistRecords} from './providers.js';
import {requestSnapshot,readSnapshot,initSnapshots} from './snapshots.js';
import {readBurned} from './onchain.js';
let snapshot=null,until=0,inflight=null;
const searches=new Map();
const sources=new Set(Object.keys(SOURCES));
const validTime=v=>{const n=number(v);return n>0&&n<=Date.now()/1000+60?n:null;};
const finiteArray=a=>Array.isArray(a)?a.map(number).filter(n=>n!=null&&n>=0):[];
export function mapMarket(t){
 const raw=t.metadata||{},verified=raw.feed_schema===2,m=verified?raw:{token_created_at:raw.token_created_at,logo:raw.logo,website:raw.website,twitter:raw.twitter,telegram:raw.telegram};
 const source=(verified?m.source:null)||t.launchpad_id||raw.archive_source||null;
 return {address:t.address,name:t.name,symbol:t.symbol,source,
  price:number(m.price),marketCap:number(m.mcap),liquidity:number(m.liquidity),volume:number(m.volume24h),
  transactions:number(m.txns24h),traders:number(m.traders24h),holders:number(m.holders),
  buys:number(m.buys24h),sells:number(m.sells24h),changes:m.changes||{},spark:finiteArray(m.spark),
  createdAt:validTime(m.token_created_at),lastTradeAt:validTime(m.last_trade_at),
  updatedAt:validTime(m.provider_updated_at),logo:m.logo||null,website:m.website||null,
  twitter:m.twitter||null,telegram:m.telegram||null,versions:Array.isArray(m.versions)?m.versions:[],
  venues:[...new Set([...(m.venues||[]),...(m.versions||[]).filter(v=>v==='v3'||v==='v4').map(v=>'uniswap-'+v)])],chartProvider:m.chart_provider||null,pool:m.pool||null,marketData:sources.has(m.source),stale:!(Number(m.provider_updated_at)>Date.now()/1000-180)};
}
export function invalidateMarkets(){until=0;}
async function allMarkets(){
 await initSnapshots();
 if(snapshot&&until>Date.now())return snapshot;
 if(inflight)return inflight;
 inflight=q(`SELECT t.*,l.launchpad_id,s.payload AS prepared,s.updated AS prepared_at FROM tokens t LEFT JOIN launches l ON l.token=t.address
 LEFT JOIN LATERAL (SELECT payload,updated FROM market_snapshots_v3 WHERE token=t.address ORDER BY updated DESC LIMIT 1) s ON true
 WHERE (t.metadata->>'feed_schema'='2' OR t.metadata->>'catalog_schema'='2')`).then(rows=>{
  snapshot=rows.map(r=>{const m=mapMarket(r);if(r.prepared?.market?.price!=null){m.price=r.prepared.market.price;m.priceSource='stored-chart';m.stale=Date.now()-Number(r.prepared_at)>60000;}return m;});until=Date.now()+10000;return snapshot;
 }).finally(()=>{inflight=null;});return inflight;
}
const sum=(rows,key)=>{const vs=rows.map(r=>r[key]).filter(v=>v!=null);return vs.length?vs.reduce((a,b)=>a+b,0):null;};
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
 if(options.version)rows=rows.filter(r=>r.versions.includes(options.version));
 if(options.venue)rows=rows.filter(r=>(r.venues||[]).includes(options.venue));
 if(options.mode==='new')rows=rows.filter(r=>r.createdAt>now-7*86400);
 if(options.mode==='gainers')rows=rows.filter(r=>number(r.changes['24h'])>0);
 if(options.mode==='losers')rows=rows.filter(r=>number(r.changes['24h'])<0);
 if(options.mode==='watch'){const watch=new Set(String(options.addresses||'').toLowerCase().split(',').slice(0,100));rows=rows.filter(r=>watch.has(r.address));}
 for(const [option,key] of [['minLiquidity','liquidity'],['minVolume','volume']])if(number(options[option])>0)rows=rows.filter(r=>r[key]!=null&&r[key]>=Number(options[option]));
 const keys=new Set(['price','marketCap','liquidity','volume','transactions','holders','createdAt','change']);
 const sort=keys.has(options.sort)?options.sort:options.mode==='new'?'createdAt':['gainers','losers'].includes(options.mode)?'change':'volume';
 const direction=options.dir==='asc'||(!options.dir&&options.mode==='losers')?1:-1;
 const value=r=>sort==='change'?number(r.changes['24h']):r[sort];
 rows.sort((a,b)=>{
  if(query){const rank=r=>r.address===query?0:String(r.symbol).toLowerCase()===query?1:2;const d=rank(a)-rank(b);if(d)return d;}
  const av=value(a),bv=value(b);if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
  return (av!=null&&bv!=null?(av-bv)*direction:0)||a.address.localeCompare(b.address);
 });
 const limit=Math.min(100,Math.max(10,Math.floor(Number(options.limit)||50))),pages=Math.max(1,Math.ceil(rows.length/limit));
 const page=Math.min(pages,Math.max(1,Math.floor(Number(options.page)||1)));
 return {rows:rows.slice((page-1)*limit,page*limit),total:rows.length,page,pages,limit,
  stats:{active:activeRows.length,archived:all.length,volume:sum(activeRows,'volume'),liquidity:sum(activeRows,'liquidity'),transactions:sum(activeRows,'transactions'),partial:true},
  trending:activeRows.filter(r=>r.price!=null).sort((a,b)=>(b.volume||0)-(a.volume||0)).slice(0,8),
  sources:[...new Set(all.map(r=>r.source).filter(Boolean))].map(id=>({id,markets:activeRows.filter(r=>r.source===id).length})),
  updatedAt:Math.max(0,...all.map(r=>r.updatedAt||0)),generatedAt:now};
}
export async function listMarkets(options={}){
 const query=String(options.q||'').trim().slice(0,100);
 // Search returns our local archive immediately. Remote discovery is bounded
 // and happens outside the response path; subsequent searches see its result.
 if(query.length>=2&&!searches.has(query)&&searches.size<4){
  const task=dexMarkets(query).then(async rows=>{if(rows.length){await persistRecords(rows);invalidateMarkets();}}).catch(()=>{}).finally(()=>{setTimeout(()=>searches.delete(query),30000).unref();});
  searches.set(query,task);
 }
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
  const burn=await readBurned(market.address,row.decimals,row.total_supply);
  // Dust left at a burn address is not a burn. Below a whole token it reads as "0 · 0.00%", which says
  // less than showing nothing at all.
  if(burn&&burn.burned>=1){market.burned=burn.burned;market.burnedPercent=burn.percent;market.circulating=burn.circulating;}
 }catch{/* the panel simply omits it */}
 try{market.originalTicker=await isOriginalTicker(market.address,market.symbol);}catch{/* the mark is simply absent */}
 const trades=remote?.trades||[];
 if(trades[0]?.at)market.lastTradeAt=validTime(trades[0].at)||market.lastTradeAt;
 // The visible price and chart close must refer to the same recorded stream.
 if(remote?.candles?.length)market.price=remote.candles.at(-1).close;
 return {market,timeframe:tf,candles:remote?.candles||[],closes:remote?.closes||[],chartMode:remote?.chartMode||'candles',history:remote?.history,trades,errors:remote?.errors||{detail:error},
  supported:!!remote,receivedAt:Math.floor(Date.now()/1000)};
}

export async function getMarket(address,tf='1h'){
 if(!/^0x[0-9a-f]{40}$/i.test(address)||!['1m','5m','15m','1h','4h','1d'].includes(tf))throw Error('Invalid market request');
 address=address.toLowerCase();
 const row=(await q('SELECT t.*,l.launchpad_id FROM tokens t LEFT JOIN launches l ON l.token=t.address WHERE t.address=$1',[address]))[0];
 if(!row)return null;
 await requestSnapshot(address,tf,10);
 const saved=await readSnapshot(address,tf);
 if(saved)return {...saved.payload,cache:{updatedAt:saved.updated,stale:Date.now()-saved.updated>60000}};
 return {market:{...mapMarket(row),price:null},timeframe:tf,candles:[],closes:[],trades:[],chartMode:'candles',supported:true,
 history:{loading:true,complete:false},errors:{chartNotice:'Historical data is being prepared in the background.'},cache:{pending:true}};
}
