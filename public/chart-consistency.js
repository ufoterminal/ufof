import {samePool} from './market-state.js';

// Never repair history by inserting the independent overview quote as a trade.
export function chartMatchesMarket(candles,history,market){
 const close=candles?.at(-1)?.close;
 return samePool(history?.pool,market?.pool)&&Number.isFinite(close)&&close>0&&
  Number.isFinite(market?.price)&&market.price>0&&
  Math.abs(close-market.price)<=Math.max(market.price*1e-8,Number.MIN_VALUE);
}
