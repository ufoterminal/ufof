import {samePool} from './market-state.js';

// The live endpoint owns the current valuation. Chart snapshots only own history.
export function mergeLiveMarket(snapshot,live){
 if(!live||snapshot.address!==live.address)return snapshot;
 const merged={...snapshot,...Object.fromEntries(Object.entries(live).filter(([,v])=>v!=null))};
 for(const key of ['price','marketCap','fdv','priceAt','pool','quoteToken','quotePending'])if(key in live)merged[key]=live[key];
 return merged;
}

export function appendLiveCandles(candles,history,trades,seconds,pool,now=Date.now()/1000){
 // Old snapshots without provenance must be rebuilt before accepting live trades.
 if(!candles.length||!samePool(history?.pool,pool)||!(history?.lastTradeAt>0)||!(seconds>0))return candles;
 const unique=new Map();
 for(const t of trades||[]){
  const cursor=history.lastTradeCursor;
  const laterInSecond=t.at===history.lastTradeAt&&cursor?.at===t.at&&Number.isSafeInteger(cursor.block)&&Number.isSafeInteger(cursor.logIndex)&&Number.isSafeInteger(t.block)&&Number.isSafeInteger(t.logIndex)&&(t.block>cursor.block||t.block===cursor.block&&t.logIndex>cursor.logIndex);
  if(!samePool(t.pool,pool)||!Number.isFinite(t.at)||(t.at<=history.lastTradeAt&&!laterInSecond)||t.at>now+5||
    !Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.usd_volume)||t.usd_volume<0)continue;
  // Hash + log index is the cross-reader identity; never deduplicate different swaps in one tx.
  const key=t.tx&&t.logIndex!=null?t.tx.toLowerCase()+':'+t.logIndex:t.id;
  if(key)unique.set(key,t);
 }
 const ordered=[...unique.values()].sort((a,b)=>a.at-b.at||(a.block??0)-(b.block??0)||(a.logIndex??0)-(b.logIndex??0));
 if(!ordered.length)return candles;
 const result=candles.map(c=>({...c}));
 for(const t of ordered){
  const bucket=Math.floor(t.at/seconds)*seconds;let last=result.at(-1);
  if(bucket<last.bucket)continue;
  if(bucket>last.bucket){last={bucket,open:last.close,high:last.close,low:last.close,close:last.close,volume:0,trades:0};result.push(last);}
  last.high=Math.max(last.high,t.price);last.low=Math.min(last.low,t.price);last.close=t.price;
  last.volume=last.volume==null?null:last.volume+t.usd_volume;last.trades=(last.trades||0)+1;
 }
 return result.slice(-500);
}

export function currentChartValue(market,mode){
 const value=mode==='mc'?market.marketCap:market.price;
 return Number.isFinite(value)&&value>0?value:null;
}
