const stamp=m=>Number(m?.priceAt||m?.valuationAt||m?.updatedAt||0);
// Price and valuation form one packet, independent of chart timeframe.
export function retainValuation(incoming,previous){
 if(!previous||incoming.address!==previous.address||stamp(incoming)>=stamp(previous))return incoming;
 const result={...incoming};
 for(const key of ['price','marketCap','fdv','priceAt','valuationAt','updatedAt','pool','quoteToken','quotePending']){
  if(key in previous)result[key]=previous[key];
 }
 return result;
}
export function samePool(a,b){return !!a&&!!b&&String(a).toLowerCase()===String(b).toLowerCase();}
