import {q} from './db.js';
import {directDetail,number} from './direct.js';
import {mapMarket,burnFields} from './market-service.js';
import {recentTrades} from './onchain.js';
import {crossQuote,nonUsdQuote} from './quote-values.js';
const cache=new Map(),flights=new Set();
export function windowStats(trades,now,complete=false){
 if(!complete&&!trades.some(t=>t.at<=now-86400))return null;
 const seen=new Set(),rows=trades.filter(t=>{
  const key=t.id??JSON.stringify([t.tx,t.logIndex,t.at,t.price,t.usd_volume,t.buy]);
  if(seen.has(key)||t.at<=now-86400||t.at>now||number(t.usd_volume)==null||t.usd_volume<0||typeof t.buy!=='boolean')return false;
  seen.add(key);return true;
 });
 const buys=rows.filter(t=>t.buy),sells=rows.filter(t=>!t.buy);
 const sum=a=>a.reduce((n,t)=>n+Number(t.usd_volume),0),unique=a=>new Set(a.map(t=>t.trader).filter(Boolean)).size;
 return {buyVolume:sum(buys),sellVolume:sum(sells),volume:sum(rows),buys:buys.length,sells:sells.length,transactions:rows.length,traders:unique(rows),buyers:unique(buys),sellers:unique(sells)};
}
export async function liveMarket(address){
 address=address.toLowerCase();
 const row=(await q('SELECT t.*,l.launchpad_id FROM tokens t LEFT JOIN launches l ON l.token=t.address WHERE t.address=$1',[address]))[0];
 if(!row)return null;
 const market={...mapMarket(row),...burnFields(row)},old=cache.get(address);
 if((!old||old.until<Date.now())&&!flights.has(address)&&flights.size<8){
  flights.add(address);
  directDetail(market.chartProvider||market.source,address,'1m',true).then(remote=>{
   if(!remote)return;
   if(cache.size>=500)cache.delete(cache.keys().next().value);
   if(remote.errors?.trades&&old?.remote?.trades?.length)remote.trades=old.remote.trades;
   cache.set(address,{remote,until:Date.now()+3000,receivedAt:Date.now()});
  }).catch(()=>{if(old)old.until=Date.now()+10000;}).finally(()=>flights.delete(address));
 }
 const remote=old?.remote,d=remote?.detail;
 if(number(d?.price)>0){market.price=number(d.price);market.priceAt=d.priceAt||null;
  // Keep valuation packets coherent; never calculate a missing supply.
  market.marketCap=number(d.mcap)??market.marketCap;market.fdv=number(d.fdv)??market.fdv;
 }
 const protectedQuote=crossQuote(row.metadata)||nonUsdQuote(d?.quoteToken||d?.pairToken||d?.pair_token);
 const local=protectedQuote||!market.pool?[]:await recentTrades(address,100,market.pool).catch(()=>[]);
 const provider=remote?.trades||[];
 const useLocal=local.length&&(!provider.length||local[0].at>=provider[0].at);
 const trades=useLocal?local:provider;
 if(!market.price&&trades[0]?.price>0&&!protectedQuote){market.price=trades[0].price;market.priceAt=trades[0].at;}
 // Only a complete window is allowed to populate the 24h breakdown.
 // A page reaching back beyond the window proves coverage; a short page alone does not.
 const now=Math.floor(Date.now()/1000);
 const covered=!useLocal||(row.metadata?.onchain_from!=null&&Number(row.metadata.onchain_from)<=now-86400);
 const stats=!protectedQuote&&covered?windowStats(trades,now):null;
 if(stats)Object.assign(market,stats);
 if(!stats&&!protectedQuote&&trades.length&&!remote?.errors?.trades){
  const recent=windowStats(trades,Math.floor(Date.now()/1000),true);
  market.recentBuyVolume=recent.buyVolume;market.recentSellVolume=recent.sellVolume;
  market.recentBuyers=recent.buyers;market.recentSellers=recent.sellers;market.recentTradeCount=recent.transactions;
 }
 if(market.transactions==null&&market.buys!=null&&market.sells!=null)market.transactions=market.buys+market.sells;
 return {market,trades,pending:!old&&!local.length,lastTradeAt:trades[0]?.at||null,
  receivedAt:old?.receivedAt||null,stale:!old||!!remote?.errors?.trades||Date.now()-old.receivedAt>20000,
  errors:remote?.errors||{},volumeBreakdown:market.buyVolume!=null&&market.sellVolume!=null?'24h':'unavailable'};
}
