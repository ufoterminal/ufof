// Public, read-only endpoints verified against each pad's own frontend.
import {knownRegistry,launchMeta} from './argus.js';
import {PAD_REGISTRIES,padLaunches} from './pad-registry.js';
import {knownNames} from './onchain.js';
import {enrichQuoteRows} from './quote-values.js';
// How many unnamed launches are read from their contracts in one pass.
// How long a source's answer is reused. Shorter than the sync round, so a round never serves an answer
// fetched two rounds ago.
const FEED_TTL=Math.max(5000,Number(process.env.FEED_TTL_MS||20000));
const PAD_META_PER_PASS=Math.max(1,Math.min(200,Number(process.env.PAD_META_PER_PASS||60)));
export const feeds = {
  noxa: 'https://api.radardex.pro/tokens?launchpad=noxa&sort=volume24&dir=desc&window=24h&limit=500',
  // ArgusPad market numbers. Membership is decided by the on-chain Portal registry in argus.js;
  // rows here are only accepted for addresses that registry lists.
  argus: 'https://api.radardex.pro/tokens?launchpad=argus&sort=volume24&dir=desc&window=24h&limit=500',
  // long.supply and the o1 launchpad publish no token list either; see pad-registry.js for how their
  // factories are read. These feeds supply only the market numbers.
  long: PAD_REGISTRIES.long.feed,
  o1: PAD_REGISTRIES.o1.feed,
  radardex: 'https://api.radardex.pro/tokens?launchpad=radar&sort=volume24&dir=desc&window=24h&limit=500',
  tolly: 'https://api.tollylabs.com/tokens?scope=ours&sort=volume&dir=desc&limit=500&offset=0',
  sharc: 'https://sharc.fun/api/tokens',
  dyor: 'https://arc-api-production-ef9c.up.railway.app/api/arc/v1/tokens?limit=100',
  // CircleWarp publishes the Arc feed from its own indexer (chain 5042).
  circlewarp: 'https://warp-arc-production.up.railway.app/api/tokens',
  // Archemist's web app exposes the same first-party indexer it uses for its
  // screener. The chain query is mandatory so Robinhood/testnet data cannot
  // accidentally bleed into the Arc terminal.
  // This is Archemist's own launch registry (54 Arc mainnet launches today),
  // not the broader Uniswap token indexer.
  archemist: 'https://api.archemist.fun/api/tokens?chain=arc-mainnet&limit=100',
  // A first-party URL can be supplied when pools.trade exposes its Arc feed.
  // Until then this is a tightly filtered discovery mirror: only rows whose
  // upstream launchpad marker is exactly `poolstrade` are accepted.
  'pools-trade': process.env.POOLS_TRADE_ARC_API||'https://api.radardex.pro/tokens?launchpad=poolstrade&sort=volume24&dir=desc&window=24h&limit=500'
};
export const poolsTradeKnown=[{address:'0x4753c45fb550fecaa143a47968659117e6ffc2ce',name:'Barc',symbol:'BARC',decimals:18,totalSupply:'1000000000000000000000000000',created_at:1788982846,chain:'Arc',launchpad:'poolstrade'}];
const poolsTradeApi='https://pools.trade/api/trpc';
const poolsTradeCall=(procedure,input)=>poolsTradeApi+'/'+procedure+'?batch=1&input='+encodeURIComponent(JSON.stringify({'0':input}));
const cache=new Map(),pending=new Map();
export async function cachedJson(url,ttl=30000){
  const hit=cache.get(url);if(hit&&hit.until>Date.now())return hit.value;
  if(pending.has(url))return pending.get(url);
  const work=(async()=>{const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('Provider HTTP '+r.status);
    let value=await r.json();
    const endpoint=new URL(url);
    if(endpoint.origin==='https://api.radardex.pro'&&endpoint.pathname==='/tokens')
      value=await enrichQuoteRows(value,address=>cachedJson('https://api.radardex.pro/token/'+address,ttl));
    if(cache.size>=300)cache.delete(cache.keys().next().value);
    cache.set(url,{value,until:Date.now()+ttl});return value;
  })().finally(()=>pending.delete(url));pending.set(url,work);return work;
}
export const number=x=>x==null||x===''||!Number.isFinite(Number(x))?null:Number(x);
const unix=x=>{if(x==null||x==='')return null;const n=typeof x==='string'&&!/^\d+(?:\.\d+)?$/.test(x)?Date.parse(x):Number(x);return Number.isFinite(n)?Math.floor(n>1e12?n/1000:n):null};
// Reads names for launches nothing has described yet, newest first, a bounded number per turn. This runs
// in the background so the market round never waits on the chain.
export async function namePadLaunches(limit=PAD_META_PER_PASS){
 const pending=[];
 for(const id of Object.keys(PAD_REGISTRIES)){
  const rows=await padLaunches(id).catch(()=>[]);
  for(const r of rows)pending.push({address:r.token,at:r.at==null?null:Number(r.at)});
 }
 if(!pending.length)return 0;
 const known=await knownNames(pending.map(r=>r.address)).catch(()=>new Map());
 const unnamed=pending.filter(r=>!known.get(r.address)?.symbol).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,limit);
 // Named in small groups. One at a time was safe but slow enough that a pad's older launches stayed
 // nameless for hours, and an unnamed token cannot be found by name and sorts to the bottom of every list.
 let named=0;
 for(let i=0;i<unnamed.length;i+=4){
  const batch=unnamed.slice(i,i+4);
  const metas=await Promise.all(batch.map(r=>launchMeta(r.address).catch(()=>null)));
  named+=metas.filter(m=>m?.symbol).length;
 }
 return named;
}

// Each pad's own reader, exactly as it was: its API, its shape, its pagination.
// A pad backed by a launch factory: the registry says what it launched, the pad's own feed fills in the
// market numbers where it publishes them.
export async function ownList(id){
 if(PAD_REGISTRIES[id]){
  // The registry is filled by a background task; a sync only reads it. A pad's market feed is optional:
  // when it is missing or unusable the pad still lists its launches, and their prices and volumes come
  // from our own reading of the chain like any other token's.
  const feed=feeds[id]?await cachedJson(feeds[id],FEED_TTL).catch(()=>null):null;
  // A pad that publishes its own feed answers in its own shape: an array, an items page, a tokens list.
  // The raw answer is carried through untouched for its own reader; forcing it into one shape here left
  // those pads with nothing.
  const payload=Array.isArray(feed?.tokens)?{...feed}:{tokens:[]};
  // A pad with its own reader is asked through it, so its pagination and field names are respected.
  if(PAD_REGISTRIES[id].shape==='own')payload.raw=await feedList(id).catch(()=>null);
  const registry=await padLaunches(id);
  const listed=new Set(payload.tokens.map(t=>String(t.address||'').toLowerCase()));
  const rows=registry.map(entry=>({address:entry.token,factory:entry.factory,at:entry.at==null?null:Number(entry.at)}));
  // A launch the feed has not picked up is named from its own contract. Reading those one after another
  // took a sync from seconds to many minutes on a fresh database, so a bounded batch is read in parallel
  // each pass and the rest are named on later passes.
  // Names come from what has already been read, never from the chain in the middle of a round: a market
  // round must be a database read. Anything still unnamed is picked up by namePadLaunches in the worker.
  const meta=await knownNames(rows.map(r=>r.address)).catch(()=>new Map());
  return {...payload,registry:rows.map(r=>({...(meta.get(r.address)||{}),...r})),mirror:true};
 }
 return feedList(id);
}

async function feedList(id){
 if(id==='argus'){
  const [registry,payload]=[knownRegistry(),await cachedJson(feeds.argus,FEED_TTL)];
  if(!Array.isArray(payload.tokens))throw Error('ArgusPad unexpected token list');
  // A launch the market feed has not picked up yet still belongs on the list: name it from the token contract.
  const listed=new Set(payload.tokens.map(t=>String(t.address||'').toLowerCase()));
  // Same bound as the other pads: a handful of unnamed launches are read from their contracts per pass,
  // in parallel, so this never turns one source into a several minute wait.
  const unnamed=registry.filter(entry=>!listed.has(entry.address)).slice(0,PAD_META_PER_PASS);
  const named=await Promise.all(unnamed.map(entry=>launchMeta(entry.address).catch(()=>({}))));
  const meta=new Map(unnamed.map((entry,i)=>[entry.address,named[i]]));
  return {...payload,registry:registry.map(entry=>({...entry,...(meta.get(entry.address)||{})})),mirror:true};
 }
 if(id==='noxa'){
  const payload=await cachedJson(feeds.noxa,FEED_TTL);
  if(!Array.isArray(payload.tokens))throw Error('Noxa unexpected token list');
  return {...payload,mirror:true};
 }
 if(id==='dyor'){
  const base='https://arc-api-production-ef9c.up.railway.app/api/arc/v1/tokens';
  const first=await cachedJson(feeds.dyor,FEED_TTL),items=[...(first.items||first.data||[])];
  let cursor=first.nextCursor??first.next_cursor??null,pages=1;
  // DYOR cursors are stable by launch block. Keep a bounded page budget and
  // cache cursor pages longer than the head so a 60s sync never hammers the API.
  while(cursor!=null&&pages<50){
   const page=await cachedJson(base+'?limit=100&cursor='+encodeURIComponent(cursor),900000);
   const nextItems=page.items||page.data||[];if(!Array.isArray(nextItems)||!nextItems.length)break;
   items.push(...nextItems);pages++;
   const next=page.nextCursor??page.next_cursor??null;if(next==null||String(next)===String(cursor))break;cursor=next;
  }
  return {...first,items:[...new Map(items.map(t=>[t.token||t.address,t])).values()],pagination_pages:pages};
 }
 if(id==='circlewarp'){
  const tokens=await cachedJson(feeds.circlewarp,FEED_TTL),result=new Array(tokens.length);
  let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{
   while(cursor<tokens.length){const i=cursor++,t=tokens[i];
    let metrics={volume24h:null,txns24h:null};
    try{metrics=await warpDaily(t);}catch{/* Missing history stays unknown. */}
    result[i]={...t,...metrics};
   }
  }));
  return result;
 }
 if(id==='archemist'){
  const first=await cachedJson(feeds.archemist,FEED_TTL);
  const items=first.tokens||first.items||first.data||[];
  if(!Array.isArray(items))throw Error('archemist unexpected token list');
  return {...first,tokens:[...new Map(items.map(t=>[String(t.token_address||t.address||'').toLowerCase(),t])).values()]};
 }
 if(id==='pools-trade'){
  const payload=await cachedJson(feeds['pools-trade'],60000);
  const items=payload.tokens||payload.items||payload.data||[];
  return {...payload,tokens:Array.isArray(items)&&items.length?items:poolsTradeKnown,source:'pools-trade',mirror:!process.env.POOLS_TRADE_ARC_API};
 }
 if(id!=='tolly')return cachedJson(feeds[id],FEED_TTL);
 const first=await cachedJson(feeds.tolly,60000);
 const tokens=[...(first.tokens||[])],pageSize=tokens.length;
 if(!pageSize)return first;
 // Bound the number of requests even if an upstream count is corrupt.
 for(let offset=pageSize;offset<Math.min(Number(first.total)||0,1000);offset+=pageSize){
  const page=await cachedJson('https://api.tollylabs.com/tokens?scope=ours&sort=volume&dir=desc&limit=200&offset='+offset,300000);
  if(!page.tokens?.length)break;tokens.push(...page.tokens);
 }
 return {...first,tokens:[...new Map(tokens.map(t=>[t.address,t])).values()]};
}
const scaled=(x,d)=>number(x)==null?null:Number(x)/10**d;
export async function warpDaily(token,now=Math.floor(Date.now()/1000)){
 const cutoff=now-86400,last=unix(token.lastTradeAt);
 if(last!=null&&last<cutoff)return {volume24h:0,txns24h:0};
 const seen=new Set();let volume=0,count=0;
 for(let page=0;page<10;page++){
  const data=await cachedJson(feeds.circlewarp+'/'+token.address.toLowerCase()+'/trades?limit=100&offset='+page*100,300000);
  if(!Array.isArray(data.trades))throw Error('Warp trade history unavailable');
  let crossed=false;
  for(const t of data.trades){
   const at=unix(t.ts);if(at==null)throw Error('Warp trade timestamp missing');
   if(at<cutoff){crossed=true;continue;}if(at>now)continue;
   if(!t.id||seen.has(t.id))continue;seen.add(t.id);
   const usd=number(t.usdc);if(usd==null||usd<0)throw Error('Warp trade volume missing');
   volume+=usd;count+=number(t.tradeCount)??1;
  }
  if(crossed||data.trades.length<100||Number(data.total)<=(page+1)*100)return {volume24h:volume,txns24h:count};
 }
 // Never publish a truncated trade window as a full daily total.
 return {volume24h:null,txns24h:null};
}
// DYOR exposes the canonical trade tape but not an OHLC endpoint. Build candles
// from those recorded swaps only; no prices are interpolated or fetched from a
// third-party chart provider. This keeps the chart faithful to the source feed
// while preserving the existing read-only trade data.
export function candlesFromTrades(trades,seconds){
  const span=Number(seconds)||300, buckets=new Map();
  const ordered=[...(trades||[])].sort((a,b)=>Number(a.at)-Number(b.at));
  for(const trade of ordered){
    const at=Number(trade.at),p=Number(trade.price);
    if(!Number.isFinite(at)||at<=0||!Number.isFinite(p)||p<=0)continue;
    const bucket=Math.floor(at/span)*span;
    const current=buckets.get(bucket);
    if(!current){buckets.set(bucket,{bucket,open:p,high:p,low:p,close:p,volume:Number(trade.usd_volume)||0,trades:1});continue;}
    current.high=Math.max(current.high,p);current.low=Math.min(current.low,p);current.close=p;
    if(Number.isFinite(Number(trade.usd_volume)))current.volume+=Number(trade.usd_volume);
    current.trades++;
  }
  return [...buckets.values()].sort((a,b)=>a.bucket-b.bucket).slice(-500);
}
// Only a web link is kept; anything else a feed puts in these fields is dropped rather than rendered.
const safeLink=v=>{const x=String(v||'').trim();return /^https?:\/\//i.test(x)?x:null;};

export function normalizeDirect(id,json,now=Math.floor(Date.now()/1000)){
  // The registry path only takes over when the payload actually carries a registry. A pad's own field
  // mapping stays reachable under the same id, which is what kept this change from rewriting every pad.
  if(PAD_REGISTRIES[id]&&Array.isArray(json.registry)){
   const pad=PAD_REGISTRIES[id];
   if(!Array.isArray(json.tokens))throw Error(pad.label+' unexpected token list');
   if(!Array.isArray(json.registry))throw Error(pad.label+' registry missing');
   const registry=new Map(json.registry.filter(r=>/^0x[0-9a-f]{40}$/i.test(r?.address)).map(r=>[r.address.toLowerCase(),r]));
   // Both checks: the feed tags the token as this pad's, and the pad's factory actually launched it.
   // A pad's own feed is trusted for its own tag. The registry stays the authority and marks each row as
   // confirmed or not, but a row is no longer held back until the backwards scan has reached it: a pad
   // with thousands of older launches simply vanished from the site while that scan caught up.
   // A pad that publishes its own feed is read with its own reader; the shared shape only fits the ones
   // mirrored from a screener. Running every pad through the shared one left those pads empty.
   const feedRows=pad.shape==='own'
    ? (json.raw?normalizeDirect(id,json.raw,now):[])
    : (()=>{const t=json.tokens.filter(x=>x.launchpad===pad.tag);
       return t.length?normalizeDirect('pools-trade',{tokens:t.map(x=>({...x,launchpad:'poolstrade'}))},now):[];})();
   const rows=feedRows
    .map(t=>{const r=registry.get(t.address);return {...t,launchpad_id:id,factory:r?.factory??null,
     creation_at:t.creation_at??r?.at??null,
     metadata:{...t.metadata,source:id,data_provider:'feed',pad_factory:r?.factory??null,
      registry_confirmed:!!r,token_created_at:t.metadata?.token_created_at??r?.at??null}};});
   const seen=new Set(rows.map(r=>r.address));
   for(const [address,r] of registry){
    if(seen.has(address))continue;
    // A launch whose name has not been read from its contract yet is held back rather than listed as a
    // blank row; the naming pass is bounded, and a pad with thousands of launches would otherwise fill
    // the list with rows that say nothing.
    if(!String(r.symbol||'').trim())continue;
    // Launched on chain, no market numbers yet. Unknown, never zero.
    // Only what this row actually knows. Writing the market fields as nulls erased the price, volume and
    // freshness our own indexing had already measured for the same token, which is how a page ended up
    // showing an hour old snapshot beside a trade from three minutes ago.
    rows.push({address,name:String(r.name||''),symbol:String(r.symbol||''),decimals:number(r.decimals),total_supply:null,
     creation_at:r.at??null,launchpad_id:id,factory:r.factory,
     metadata:{feed_schema:2,source:id,data_provider:'pad-factory',pad_factory:r.factory,
      ...(r.at?{token_created_at:r.at}:{})}});
   }
   return rows;
  }
  if(id==='argus'){
   if(!Array.isArray(json.tokens))throw Error('ArgusPad unexpected token list');
   if(!Array.isArray(json.registry))throw Error('ArgusPad registry missing');
   const registry=new Map(json.registry.filter(r=>/^0x[0-9a-f]{40}$/i.test(r?.address)).map(r=>[r.address.toLowerCase(),r]));
   // Both checks must pass: the feed tags the token as ArgusPad and an ArgusPad Portal lists it.
   const rows=normalizeDirect('pools-trade',{tokens:json.tokens.filter(t=>t.launchpad==='argus'&&registry.has(String(t.address||'').toLowerCase())).map(t=>({...t,launchpad:'poolstrade'}))},now)
    .map(t=>{const r=registry.get(t.address);return {...t,launchpad_id:'argus',factory:r.portal,metadata:{...t.metadata,source:'argus',data_provider:'radardex',argus_portal:r.portal,argus_line:r.line}};});
   const seen=new Set(rows.map(r=>r.address));
   for(const [address,r] of registry){
    if(seen.has(address))continue;
    // Listed on chain, no market numbers yet. Shown as unknown, never as zero.
    rows.push({address,name:String(r.name||''),symbol:String(r.symbol||''),decimals:number(r.decimals),total_supply:null,creation_at:null,launchpad_id:'argus',factory:r.portal,
     metadata:{feed_schema:2,source:'argus',data_provider:'argus-portal',argus_portal:r.portal,argus_line:r.line,versions:r.line==='legacy-v3'?['v3']:['v4'],logo:null,
      price:null,mcap:null,liquidity:null,volume24h:null,txns24h:null,traders24h:null,holders:null,buys24h:null,sells24h:null,token_created_at:null,last_trade_at:null,
      provider_updated_at:now,spark:[],changes:{'5m':null,'1h':null,'6h':null,'24h':null}}});
   }
   return rows;
  }
  if(id==='dyor'){
   // DYOR's own list. Its figures are in the pair token's units, USDC at six decimals, and it publishes no
   // price: market cap over supply is not something to guess, so price is left to our own chain reading.
   const items=Array.isArray(json.items)?json.items:Array.isArray(json.data)?json.data:[];
   return items.map(t=>{
    const address=String(t.token||'').toLowerCase();
    if(!/^0x[0-9a-f]{40}$/.test(address))return null;
    const unit=10**(number(t.pairDecimals)??6);
    const scale=v=>{const n=number(v);return n==null?null:n/unit;};
    const created=number(t.created_at);
    const seconds=created==null?null:(created>1e12?Math.floor(created/1000):created);
    const traded=number(t.lastTradeAt);
    return {address,name:String(t.name||''),symbol:String(t.symbol||''),decimals:18,total_supply:null,
     creation_at:seconds,launchpad_id:'dyor',factory:String(t.factory||'').toLowerCase()||null,
     metadata:{feed_schema:2,source:'dyor',data_provider:'dyor',versions:[],
      mcap:scale(t.marketCapEth),liquidity:scale(t.liquidityEth),volume24h:scale(t.volume24hWei),
      token_created_at:seconds,last_trade_at:traded==null?null:(traded>1e12?Math.floor(traded/1000):traded),
      provider_updated_at:now,logo:safeLink(t.image),website:safeLink(t.website),twitter:safeLink(t.x),
      telegram:safeLink(t.telegram),description:typeof t.description==='string'&&t.description.trim()?t.description.trim().slice(0,500):null,
      graduated:t.graduated===true}};
   }).filter(Boolean);
  }
  if(id==='noxa'){
   if(!Array.isArray(json.tokens))throw Error('Noxa unexpected token list');
   // Reuse the same market schema, but require Noxa attribution before mapping.
   return normalizeDirect('pools-trade',{tokens:json.tokens.filter(t=>t.launchpad==='noxa').map(t=>({...t,launchpad:'poolstrade'}))},now)
    .map(t=>({...t,launchpad_id:'noxa',metadata:{...t.metadata,source:'noxa',data_provider:'radardex'}}));
  }
  const items=id==='sharc'?json:(id==='circlewarp'?(Array.isArray(json)?json:(json.tokens||json.items||json.data)):(json.tokens||json.items||json.data));
  if(!Array.isArray(items))throw Error(id+' unexpected token list');
  if(id==='pools-trade')return items.filter(t=>/^0x[0-9a-f]{40}$/i.test(t.address||t.token_address)&&String(t.launchpad||'poolstrade').toLowerCase()==='poolstrade').map(t=>({
    address:(t.address||t.token_address).toLowerCase(),name:String(t.name||''),symbol:String(t.symbol||t.ticker||''),decimals:number(t.decimals),total_supply:t.totalSupply||t.total_supply||null,
    creation_at:unix(t.deployTs||t.firstSeen),launchpad_id:'pools-trade',factory:null,
    metadata:{feed_schema:2,source:'pools-trade',versions:Array.isArray(t.versions)?t.versions:[],logo:t.icon||t.logo||null,
      price:number(t.price??t.priceUsd),mcap:number(t.mcap??t.marketCap),liquidity:number(t.liquidityUsdc??t.liquidity),volume24h:number(t.volume24??t.volume24h),
      txns24h:number(t.txns24??t.transactions24h),traders24h:number(t.traders24),holders:number(t.holderCount??t.holders),buys24h:number(t.buys24),sells24h:number(t.sells24),
      token_created_at:unix(t.deployTs||t.firstSeen),last_trade_at:unix(t.lastSwap),provider_updated_at:now,spark:t.spark,
      fdv:number(t.fdv),quote_token:t.quoteToken||null,quote_assets:t.quotes||[],quote_pending:!!t.quotePending,usd_detail:!!t.usdDetail,
      changes:{'5m':number(t.change5m),'1h':number(t.change1h),'6h':number(t.change6h),'24h':number(t.change24??t.change24h)},
      website:t.website||null,twitter:t.twitter||null,telegram:t.telegram||null,description:t.description||undefined}
  }));
  return items.filter(t=>/^0x[0-9a-f]{40}$/i.test(t.address||t.token_address)&&(id!=='tolly'||t.tolly===true)&&(id!=='sharc'||t.chainKey==='arc')&&(id!=='circlewarp'||String(t.chain||'Arc').toLowerCase()==='arc')&&(id!=='archemist'||String(t.network||'mainnet').toLowerCase()==='mainnet')&&(id!=='pools-trade'||String(t.chain||'Arc').toLowerCase()==='arc')).map(t=>{
    const sh=id==='sharc',cw=id==='circlewarp',ac=id==='archemist';
    const live=ac?{...(t.token_snapshots||{}),...(t.live||{})}:(t.live||t.token_snapshots||{});
    const price=sh?scaled(t.priceE18,18):ac?number(live.currentPrice??live.price):number(t.price);
    const liquidity=sh?null:ac?number(live.liquidity):number(t.liquidity);
    const volume=sh?scaled(t.volume24h,6):ac?number(live.volume_24h??live.volume24h):cw?number(t.volume24h):number(t.volume??t.volume24h);
    const versions=ac?(String(t.protocol_version||'').includes('v3')?['v3']:['v2']):cw?(String(t.poolKind||'').toLowerCase()==='v4'?['v4']:[]):sh&&/^uniswap-v[234]$/.test(t.venue)?[t.venue.slice(-2)]:[];
    const address=(t.address||t.token_address||'').toLowerCase();
    return {address,name:String(t.name||''),symbol:String(t.symbol||t.ticker||''),decimals:number(t.decimals),total_supply:null,creation_at:unix(ac?t.created_at:(cw?t.createdAt:(sh?t.createdAt:t.created_ts))),launchpad_id:id,factory:ac?t.launch_factory_address:null,
      metadata:{feed_schema:2,source:id,versions,logo:ac?t.image_url:(cw?t.image:(sh?t.metadata?.image:t.image_uri)),price,mcap:ac?number(t.live?.marketCap??t.live?.market_cap??t.token_snapshots?.market_cap):cw?number(t.mcap):(sh?scaled(t.marketCap,6):number(t.marketCap)),liquidity,
        volume24h:volume,...(cw?{volumeAllTime:number(t.volume)}:{}),txns24h:ac?number(live.txns_24h??live.txns24h):cw?number(t.txns24h):(sh?null:number(t.txns24h)),
        traders24h:ac?null:cw?number(t.traders):(sh?null:number(t.traders24h)),holders:ac?number(live.holder_count??live.holders):cw?number(t.holders):sh?number(t.holdersCount):null,
        token_created_at:unix(ac?t.created_at:(cw?t.createdAt:(sh?t.createdAt:t.created_ts))),pool:ac?(t.pool_address||t.lp_address):cw?(t.pairAddress||t.pair):sh?t.pair:t.pool,
        last_trade_at:unix(ac?t.last_activity_at:(cw?t.lastTradeAt:(sh?t.lastActivity:t.lastTradeTs))),provider_updated_at:now,
        spark:cw?t.spark:(sh?t.spark:t.sparkline),changes:{'5m':ac?null:(sh?null:number(t.change5m)),'1h':ac?null:(sh?scaled(t.change1hBps,2):number(t.change1h)),'6h':ac?null:(sh?scaled(t.change6hBps,2):number(t.change6h)),'24h':ac?number(live.priceChange24h):(sh?scaled(t.change24hBps,2):number(t.change24h))},
        website:ac?t.website:cw?t.website:(sh?t.metadata?.links?.website:t.website),twitter:ac?t.twitter:cw?t.twitter:(sh?t.metadata?.links?.x:t.twitter),telegram:ac?t.telegram:cw?t.telegram:(sh?t.metadata?.links?.telegram:t.telegram),description:ac||cw?String(t.description||'').slice(0,2000):undefined}};
  });
}
// All chart providers share UTC buckets and OHLC aggregation. Duplicate source
// timestamps are snapshots, not extra trading volume. Never fill empty buckets.
export function aggregateVolumeBins(rows,seconds){
 const samples=[...new Map(rows.filter(v=>number(v.time)>0&&number(v.volumeUsd)!=null&&number(v.volumeUsd)>=0).map(v=>[Number(v.time),v])).values()].sort((a,b)=>a.time-b.time);
 const gaps=samples.slice(1).map((v,i)=>v.time-samples[i].time).filter(n=>n>0);
 const step=gaps.length?Math.min(...gaps):null,result=new Map();
 // Without a known/coherently aligned bin width, leave volume unknown.
 if(!step||step>seconds||seconds%step!==0)return result;
 for(const v of samples){const bucket=Math.floor(v.time/seconds)*seconds;if(v.time+step>bucket+seconds)continue;result.set(bucket,(result.get(bucket)||0)+Number(v.volumeUsd));}
 return result;
}
export function normalizeChart(rows,seconds){
 const samples=[...new Map(rows.map(c=>({bucket:unix(c.bucket??c.time),open:number(c.open),high:number(c.high),low:number(c.low),close:number(c.close),volume:number(c.volume??c.vol)}))
  .filter(c=>Number.isSafeInteger(c.bucket)&&c.bucket>0).map(c=>[c.bucket,c])).values()].sort((a,b)=>a.bucket-b.bucket);
 const candles=new Map(),closes=new Map();let invalid=false;
 for(const c of samples){
  const bucket=Math.floor(c.bucket/seconds)*seconds;
  if(c.close>0)closes.set(bucket,{bucket,value:c.close,volume:c.volume});
  if(![c.open,c.high,c.low,c.close].every(n=>n!=null&&n>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.high<c.low){invalid=true;continue;}
  const previous=candles.get(bucket);
  if(previous){previous.high=Math.max(previous.high,c.high);previous.low=Math.min(previous.low,c.low);previous.close=c.close;previous.volume=previous.volume==null||c.volume==null?null:previous.volume+c.volume;}
  else candles.set(bucket,{...c,bucket,volume:c.volume>=0?c.volume:null});
 }
 return {candles:[...candles.values()].slice(-500),closes:[...closes.values()].slice(-500),chartMode:invalid?'close':'candles'};
}
export async function directDetail(source,address,tf='1h'){
 const seconds={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[tf];
 if(!seconds)throw Error('Unsupported timeframe');
 const errors={};let detail=null,chart=[],swaps=[];
 const read=async(key,url)=>{try{return await cachedJson(url)}catch(e){errors[key]=e.message;return null;}};
 if(['radardex','noxa','argus','long','o1','indexed-market','uniswap','dyorswap-v2'].includes(source)){
  const base='https://api.radardex.pro/token/'+address;
  const results=await Promise.all([read('detail',base),read('chart',base+'/chart?tf='+seconds+'&limit=500'),read('trades',base+'/swaps?limit=60')]);
  detail=results[0];chart=results[1]?.candles||[];
  if(detail&&source==='noxa'&&detail.launchpad!=='noxa')throw Error('Source ownership check failed');
  if(detail&&source==='argus'&&detail.launchpad!=='argus')throw Error('Source ownership check failed');
  if(detail&&PAD_REGISTRIES[source]&&detail.launchpad!==PAD_REGISTRIES[source].tag)throw Error('Source ownership check failed');
  if(detail&&source==='radardex'&&(detail.launched!==true||(detail.launchpad&&!['radar','radardex'].includes(detail.launchpad))))throw Error('Source ownership check failed');
  if(detail?.address&&detail.address.toLowerCase()!==address.toLowerCase())throw Error('Token address mismatch');
  swaps=(results[2]?.swaps||[]).map(s=>({at:Number(s.time),buy:s.side==='buy',usd_volume:number(s.usdc),price:number(s.price),trader:s.trader,tx:s.txHash}));
 }else if(source==='tolly'){
  const base='https://api.tollylabs.com';
  const results=await Promise.all([read('detail',base+'/token/'+address),read('chart',base+'/candles?token='+address+'&tf='+tf+'&limit=500'),read('trades',base+'/swaps?token='+address+'&limit=60')]);
  detail=results[0];chart=results[1]?.candles||[];
  swaps=(results[2]?.swaps||[]).map(s=>({at:Number(s.ts),buy:s.side==='buy',usd_volume:number(s.usd),price:number(s.price),trader:s.trader,tx:s.tx}));
 }else if(source==='dyor'){
  const base='https://arc-api-production-ef9c.up.railway.app/api/arc/v1/tokens/'+address;
  const results=await Promise.all([read('detail',base),read('trades',base+'/trades?limit=100')]);
 detail=results[0];
 swaps=(results[1]?.items||[]).map(s=>{const usdc=scaled(s.amount_eth,6),tokens=scaled(s.amount_token,18);return {at:Number(s.created_at)>1e12?Math.floor(Number(s.created_at)/1000):Number(s.created_at),buy:String(s.side).toUpperCase()==='BUY',usd_volume:usdc,price:usdc!=null&&tokens>0?usdc/tokens:null,trader:s.trader,tx:s.tx_hash};});
  chart=candlesFromTrades(swaps,seconds);
 }else if(source==='sharc'){
  const base='https://sharc.fun/api/tokens/'+address;
  const results=await Promise.all([Promise.resolve([]),read('trades',base+'/trades?limit=60')]);
  chart=Array.isArray(results[0])?results[0]:[];
  swaps=(results[1]?.trades||[]).filter(s=>!s.isBurn).map(s=>({at:Number(s.timestamp),buy:s.isBuy,usd_volume:scaled(s.usdcAmount,6),price:scaled(s.priceE18,18),trader:s.trader,tx:s.txHash}));
 }else if(source==='circlewarp'){
  const base='https://warp-arc-production.up.railway.app/api/tokens/'+address;
  const results=await Promise.all([read('detail',base),Promise.resolve([]),read('trades',base+'/trades?limit=100&offset=0')]);
  detail=results[0];chart=Array.isArray(results[1])?results[1]:results[1]?.candles||[];
  swaps=(results[2]?.trades||[]).map(s=>({at:unix(s.ts),buy:String(s.side).toLowerCase()==='buy',usd_volume:number(s.usdc),price:number(s.price),trader:s.wallet,tx:s.txHash}));
 }else if(source==='archemist'){
  const base='https://api.archemist.fun/api/tokens/'+address;
  const results=await Promise.all([read('detail',base+'?chain=arc-mainnet'),read('chart',base+'/chart?chain=arc-mainnet&tf='+seconds+'&limit=500'),read('trades',base+'/trades?chain=arc-mainnet&limit=100')]);
  detail=results[0];
  chart=(results[1]?.data||[]).map(c=>({time:unix(c.recorded_at),open:number(c.price),high:number(c.price),low:number(c.price),close:number(c.price),volume:null}));
  swaps=(results[2]?.trades||results[2]||[]).map(s=>({at:unix(s.blockTime||s.created_at||s.timestamp),buy:String(s.side).toLowerCase()==='buy',usd_volume:number(s.volumeUsd??s.quoteAmount??s.amount_usdc),price:number(s.priceUsd??s.price),trader:s.trader||s.wallet,tx:s.txHash||s.tx_hash}));
 }else if(source==='pools-trade'){
  // pools.trade's public tRPC API already serves Arc (5042) pricing even
  // though its public launcher list is still Robinhood-only. Use the
  // first-party price and OHLC procedures for the detail view.
  const resolution={'1m':'ONE_MINUTE','5m':'FIVE_MINUTE','15m':'FIVE_MINUTE','1h':'ONE_HOUR','4h':'FOUR_HOUR','1d':'ONE_DAY'}[tf];
  const endTimeMs=Math.floor(Date.now()/30000)*30000;
  const startTimeMs=endTimeMs-({ '1m':6*3600e3,'5m':2*86400e3,'15m':7*86400e3,'1h':30*86400e3,'4h':120*86400e3,'1d':365*86400e3 }[tf]);
  const results=await Promise.all([
    read('detail',poolsTradeCall('prices.getTokens',{tokens:[{chainId:5042,address}]})),
    read('chart',poolsTradeCall('prices.getOhlc',{chainId:5042,address,resolution,startTimeMs,endTimeMs})),
    read('volume',poolsTradeCall('prices.getVolume',{chainId:5042,address,startTimeMs,endTimeMs})),
    read('poolDiscovery','https://api.radardex.pro/token/'+address)
  ]);
  const tokenData=results[0]?.[0]?.result?.data?.[0]||results[0]?.data?.[0]||null;
  const discovery=results[3]?.address?.toLowerCase()===address.toLowerCase()?results[3]:null;
  detail=tokenData?{...tokenData,price:tokenData.spotPriceUsd,priceUsd:tokenData.spotPriceUsd,change24h:tokenData.percentChange1d,bestPool:discovery?.bestPool,pools:discovery?.pools||[]}:null;
  const ohlc=results[1]?.[0]?.result?.data||results[1]?.data||[];
  const volumeRows=results[2]?.[0]?.result?.data||results[2]?.data||[];
  const volumes=aggregateVolumeBins(volumeRows,seconds);
  chart=ohlc.map(c=>({...c,volume:null}));
  // Aggregate price candles before attaching volume: one coarse volume bin
  // must never be copied onto multiple finer candles.
  chart=normalizeChart(chart,seconds).candles.map(c=>({...c,volume:volumes.get(c.bucket)??null}));
  // The Arc activity procedure currently returns an empty envelope; leave
  // trades empty rather than fabricating a tape or importing another pad.
  swaps=[];
 }else return null;
 const {candles,closes,chartMode}=normalizeChart(chart,seconds);
 if(chartMode==='close')errors.chartNotice='Some source candles have invalid OHLC and were omitted. Recorded closes remain available in Line view.';
 return {source,detail,candles,closes,chartMode,trades:swaps.filter(s=>s.at>0).sort((a,b)=>b.at-a.at),errors};
}
