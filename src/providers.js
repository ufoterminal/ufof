import {cachedJson,feeds,normalizeDirect,ownList} from './direct.js';
import {q} from './db.js';
import {ADDR} from './config.js';
import {onchainMarkets} from './onchain.js';
const lower=x=>String(x||'').toLowerCase();
const addr=x=>ADDR.test(String(x||''))?lower(x):null;
const pick=(o,...keys)=>{for(const k of keys)if(o?.[k]!==undefined&&o?.[k]!==null&&o?.[k]!=='')return o[k];return null};
const finite=x=>x==null||x===''||!Number.isFinite(Number(x))?null:Number(x);
const unix=x=>{if(x==null)return null;const n=typeof x==='string'&&!/^\d+$/.test(x)?Date.parse(x):Number(x);return Number.isFinite(n)?(n>1e12?Math.floor(n/1000):Math.floor(n)):null};
const safeUrl=x=>{try{const u=new URL(String(x));return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}};
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}});if(!r.ok)throw Error(`${r.status} ${url}`);return r.json()}
export function normalizeRadar(launchJson,marketJson,now=Math.floor(Date.now()/1000)){
 const launches=Array.isArray(launchJson?.launches)?launchJson.launches:Array.isArray(launchJson?.data)?launchJson.data:[];
 const markets=Array.isArray(marketJson?.tokens)?marketJson.tokens:Array.isArray(marketJson?.data)?marketJson.data:Array.isArray(marketJson?.items)?marketJson.items:[];
 const by=new Map(markets.map(x=>[addr(pick(x,'address','token','tokenAddress','contractAddress')),x]).filter(x=>x[0]));
 return launches.map(l=>{const token=addr(pick(l,'token','address','tokenAddress','contractAddress'));if(!token)return null;const m=by.get(token);if(!m||m.launched!==true||(m.launchpad&&!['radar','radardex'].includes(m.launchpad)))return null;
  const price=pick(m,'price','priceUsd','price_usd','usdPrice','p'),mcap=pick(m,'mcap','marketCap','market_cap','mc'),liq=pick(m,'liquidityUsdc','liquidityUsd','liquidity_usd','liquidity','l'),vol=pick(m,'volume24','volume24h','volume_24h','v24h'),txns=pick(m,'txns24','txns24h','transactions24h'),holders=pick(m,'holderCount','holders','holder_count');
  return {address:token,name:String(pick(l,'name')||pick(m,'name')||''),symbol:String(pick(l,'symbol')||pick(m,'symbol','ticker')||''),decimals:finite(pick(m,'decimals')),total_supply:null,creation_at:unix(pick(m,'deployTs','createdAt')||pick(l,'createdAt')),launchpad_id:'radardex',factory:addr(pick(l,'factory')),metadata:{feed_schema:2,source:'radardex',token_created_at:unix(m.deployTs),last_trade_at:unix(m.lastSwap),traders24h:finite(m.traders24),spark:m.spark,versions:m.versions,buys24h:finite(m.buys24),sells24h:finite(m.sells24),logo:safeUrl(pick(m,'icon','logo','image')||pick(l,'icon','logo')),website:safeUrl(pick(m,'website')||pick(l,'website')),twitter:safeUrl(pick(m,'twitter','x')||pick(l,'twitter','x')),telegram:safeUrl(pick(m,'telegram')||pick(l,'telegram')),price:finite(price),mcap:finite(mcap),liquidity:finite(liq),volume24h:finite(vol),txns24h:finite(txns),holders:finite(holders),changes:{'5m':finite(pick(m,'change5m','change_5m','pc5m')),'1h':finite(pick(m,'change1h','change_1h','pc1h')),'6h':finite(pick(m,'change6h','change_6h','pc6h')),'24h':finite(pick(m,'change24','change24h','change_24h','pc24h'))},provider_updated_at:now}}}).filter(Boolean);
}
export function normalizeRadarArchive(launchJson){
 const launches=Array.isArray(launchJson?.launches)?launchJson.launches:Array.isArray(launchJson?.data)?launchJson.data:[];
 return launches.map(l=>{const address=addr(pick(l,'token','address','tokenAddress','contractAddress'));if(!address)return null;return {address,name:String(pick(l,'name')||''),symbol:String(pick(l,'symbol')||''),decimals:null,total_supply:null,creation_at:null,launchpad_id:'radardex',factory:addr(pick(l,'factory')),metadata:{catalog_schema:2,archive_source:'radardex',archived:true}}}).filter(Boolean);
}
// One unresponsive source used to hold up the entire sync, and with it the market list. Every source runs
// against a deadline: whatever has not answered in time is reported as failed for this round and the rest
// of the sync carries on.
const SOURCE_TIMEOUT=Math.max(5000,Math.min(600000,Number(process.env.SOURCE_TIMEOUT_MS||90000)));
export function withDeadline(promise,label,ms=SOURCE_TIMEOUT){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' took longer than '+Math.round(ms/1000)+'s')),ms);})])
  .finally(()=>clearTimeout(timer));
}

export async function syncExternal(){
 const now=Math.floor(Date.now()/1000);const out=[];let status=[];
 // Uniswap markets are no longer discovered through another screener's version pages. Our own reading
 // of the pool factories covers the same ground and does not go dark when somebody else's API does.
 try{const [l,m]=await Promise.all([cachedJson('https://api.radardex.pro/launches?limit=all',900000),cachedJson(feeds.radardex)]);const rows=normalizeRadar(l,m,now);out.push(...rows,...normalizeRadarArchive(l));status.push({id:'radardex',ok:true,count:rows.length,archive_count:normalizeRadarArchive(l).length,market_page:(m.tokens||m.data||m.items||[]).length,total_markets:m.count||null,updated_at:now})}catch(e){status.push({id:'radardex',ok:false,error:e.message,updated_at:now})}
 // The DYOR feed has been dropped: its markets arrive through our own discovery like any other.
 for(const id of ['tolly','sharc','circlewarp','archemist','pools-trade','noxa','argus','long','o1','dyor']){try{const payload=await withDeadline(ownList(id),id),rows=normalizeDirect(id,payload,now);out.push(...rows);status.push({id,ok:true,count:rows.length,mode:payload.mirror?'live-mirror':'live'})}catch(e){status.push({id,ok:false,error:e.message})}}
 // Our own reading of the chain. It runs last so that where we measured a number ourselves it is the
 // one shown, while logos, socials and pad attribution from the feeds above are left untouched.
 // The round reads what the indexer has already written. Indexing itself happens continuously in the
 // background: a market round that also scanned the chain took minutes, and everything on the page was as
 // old as the slowest scan in it.
 try{const rows=await onchainMarkets(now);out.push(...rows);
  status.push({id:'onchain',ok:true,count:rows.length,mode:'self-indexed'});
 }catch(e){status.push({id:'onchain',ok:false,error:e.shortMessage||e.message});}
 await persistRecords(out);
 return status;
}
export async function persistRecords(records){
 const unique=new Map();
 for(const original of records){
  const r={...original,metadata:{...(original.metadata?.feed_schema===2&&!original.metadata.dex_fallback?{dex_fallback:false,chart_provider:null}:{}),...original.metadata}};
  const previous=unique.get(r.address);
  if(previous){const primary=false;
   const metadata=primary?{...r.metadata,...previous.metadata}:{...previous.metadata,...r.metadata};
   metadata.venues=[...new Set([...(previous.metadata.venues||[]),...(r.metadata.venues||[])])];
   metadata.versions=[...new Set([...(previous.metadata.versions||[]),...(r.metadata.versions||[])])];
   unique.set(r.address,{...previous,...r,name:r.name||previous.name,symbol:r.symbol||previous.symbol,metadata});
  }else unique.set(r.address,r);
 }
 const rows=[...unique.values()];
 // Two bounded bulk statements per page, not thousands of DB round trips.
 for(let i=0;i<rows.length;i+=250){
  const page=JSON.stringify(rows.slice(i,i+250));
  await q(`INSERT INTO tokens(address,name,symbol,decimals,total_supply,metadata)
   SELECT address,name,symbol,decimals,total_supply,metadata
   FROM jsonb_to_recordset($1::jsonb) AS x(address text,name text,symbol text,decimals int,total_supply numeric,metadata jsonb)
   ON CONFLICT(address) DO UPDATE SET
   name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE tokens.name END,
   symbol=CASE WHEN excluded.symbol<>'' THEN excluded.symbol ELSE tokens.symbol END,
   decimals=COALESCE(excluded.decimals,tokens.decimals),metadata=CASE
    WHEN excluded.metadata->>'dex_fallback'='true' AND tokens.metadata->>'feed_schema'='2'
      AND tokens.metadata->>'dex_fallback' IS DISTINCT FROM 'true' AND excluded.metadata->>'dex_primary' IS DISTINCT FROM 'true'
    THEN tokens.metadata||jsonb_build_object(
     'venues',(SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements(COALESCE(tokens.metadata->'venues','[]'::jsonb)||COALESCE(excluded.metadata->'venues','[]'::jsonb)) v),
     'versions',(SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements(COALESCE(tokens.metadata->'versions','[]'::jsonb)||COALESCE(excluded.metadata->'versions','[]'::jsonb)) v))
    ELSE tokens.metadata||excluded.metadata END`,[page]);
  await q(`INSERT INTO launches(token,launchpad_id,factory,at,confidence)
   SELECT address,launchpad_id,factory,creation_at,'metadata'
   FROM jsonb_to_recordset($1::jsonb) AS x(address text,launchpad_id text,factory text,creation_at bigint)
   WHERE launchpad_id IS NOT NULL
   ON CONFLICT(token) DO UPDATE SET launchpad_id=CASE WHEN excluded.launchpad_id IN ('uniswap','dyorswap-v2','onchain') AND launches.launchpad_id NOT IN ('uniswap','dyorswap-v2','onchain') THEN launches.launchpad_id ELSE excluded.launchpad_id END,
   factory=COALESCE(excluded.factory,launches.factory),at=COALESCE(excluded.at,launches.at)`,[page]);
 }
}
