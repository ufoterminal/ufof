// A confirmed primary-pool execution is one indivisible price/valuation packet.
// Missing supply must not leave a market cap calculated using a different price.
export function executionValuation(market,trade,now=Date.now()/1000){
 if(!trade?.pool||trade.pool.toLowerCase()!==market.pool?.toLowerCase()||
    !Number.isFinite(trade.price)||trade.price<=0||!Number.isFinite(trade.at)||trade.at<=0||trade.at>now+5||trade.at<(market.priceAt||0))return market;
 const total=market.totalSupply,circulating=market.circulating;
 return {...market,price:trade.price,priceAt:trade.at,priceSource:'primary-pool-execution',
  fdv:Number.isFinite(total)&&total>0?total*trade.price:null,
  marketCap:Number.isFinite(circulating)&&circulating>=0?circulating*trade.price:null};
}
