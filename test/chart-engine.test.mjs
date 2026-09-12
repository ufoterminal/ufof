import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_DIR='memory://';delete process.env.DATABASE_URL;
const {chartTrade,buildCandles,ownChart,continuousCandles}=await import('../src/chart-engine.js');
const {decodePoolTrade,v4PoolInfo}=await import('../src/rpc-history.js');
const {pool}=await import('../src/db.js');
test.after(()=>pool.end());

test('V3 token1 quote6/token18 price keeps the correct decimal direction',()=>{
 const d=decodePoolTrade({args:{amount0:1000000n,amount1:-1000000000000000000n,sqrtPriceX96:79228162514264337593543950336000000n},transactionHash:'0xabc',logIndex:1,blockNumber:1n},{token0:false,decimals:18,quoteDecimals:6},1700000000);
 assert.equal(d.price,1);assert.equal(d.usd_volume,1);assert.equal(d.buy,true);
});

test('V4 native USDC pool key, 18 decimal quote and swap signs are verified',()=>{
 const id='0x5e61e0abb3fa7a794b2c7c233f290a832803d4030b1c113200fa37c9472d79f8';
 const token='0x4753c45fb550fecaa143a47968659117e6ffc2ce';
 const descriptor={version:'v4',quoteToken:'0x3600000000000000000000000000000000000000',nativeQuote:true,feeTier:2500,tickSpacing:25,hooks:'0x0000000000000000000000000000000000000000'};
 const info=v4PoolInfo(id,token,descriptor,18);
 assert.equal(info.quoteDecimals,18);assert.equal(info.token0,false);
 assert.throws(()=>v4PoolInfo(id,token,{...descriptor,feeTier:3000},18),/key mismatch/);
 const d=decodePoolTrade({args:{amount0:-29700000000000000000n,amount1:50470455200855975364501n,sqrtPriceX96:3269225447152577350864217142469n},transactionHash:'0xabc',logIndex:1,blockNumber:1n},info,1700000000);
 assert.equal(d.buy,true);assert.equal(d.usd_volume,29.7);assert.equal(d.trader,null);
 assert.ok(d.price>0.00058&&d.price<0.00059);
});
test('burns cannot change candles and duplicate swaps cannot inflate volume',()=>{
 const raw={txHash:'0xaaa',timestamp:1700000000,priceE18:'2000000000000000000',usdcAmount:'3000000'};
 assert.equal(chartTrade('sharc',{...raw,isBurn:true}),null);
 const a=chartTrade('sharc',raw),b=chartTrade('sharc',{...raw,txHash:'0xbbb',timestamp:1700000010,priceE18:'4000000000000000000'});
 const d=buildCandles([b,a,a],60);
 assert.equal(d.length,1);assert.equal(d[0].open,2);assert.equal(d[0].close,4);assert.equal(d[0].high,4);assert.equal(d[0].low,2);assert.equal(d[0].volume,6);
});
test('six intervals are independently aggregated from the same executions',()=>{
 const trades=Array.from({length:1500},(_,i)=>({id:String(i),at:1699920000+i*60,price:i+1,usd_volume:1}));
 assert.deepEqual([60,300,900,3600,14400,86400].map(s=>buildCandles(trades,s).length),[1500,300,100,25,7,2]);
});
test('provider history follows the same continuity and range rules as local trades',()=>{
 const d=continuousCandles([{bucket:60,open:1,high:2,low:1,close:2,volume:3},{bucket:120,open:4,high:5,low:4,close:5,volume:null}]);
 assert.equal(d[1].open,2);assert.equal(d[1].low,2);assert.equal(d[1].high,5);assert.equal(d[1].volume,null);
});
test('a newly registered provider uses the existing chart pipeline without provider-specific engine code',async()=>{
 const d=await ownChart('future-pad','0x'+'6'.repeat(40),'1m',{trades:[],candles:[{bucket:1700000040,open:2,high:3,low:2,close:3,volume:null}]});
 assert.equal(d.candles.length,1);assert.equal(d.history.engine,'local-trades-v1');assert.equal(d.candles[0].close,3);
});
test('same-second trades preserve the source sequence rather than hash order',()=>{
 const d=buildCandles([{id:'z',at:1700000000,order:1,price:2,usd_volume:1},{id:'a',at:1700000000,order:2,price:4,usd_volume:1}],60);
 assert.equal(d[0].open,2);assert.equal(d[0].close,4);
});
test('last recorded close is a valid opening mark without inventing trades in empty intervals',()=>{
 const d=buildCandles([{id:'a',at:1700000000,price:2,usd_volume:3},{id:'b',at:1700000600,price:4,usd_volume:5}],60);
 assert.equal(d.length,2);assert.deepEqual(d[1],{bucket:1700000580,open:2,high:4,low:2,close:4,volume:5,trades:1});
});
test('V2 pool decoder respects quote orientation and token decimals',()=>{
 const log={args:{amount0In:0n,amount0Out:2000000000000000000n,amount1In:4000000n,amount1Out:0n,to:'0xabc'},transactionHash:'0x123',logIndex:2,blockNumber:10n};
 const d=decodePoolTrade(log,{token0:true,decimals:18},1700000000);
 assert.equal(d.price,2);assert.equal(d.usd_volume,4);assert.equal(d.buy,true);
});
test('paged raw history is persisted, reused across frames, and survives fetch failures',async()=>{
 const original=globalThis.fetch;let calls=0;
 const address='0x'+'9'.repeat(40);
 globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({total:2,trades:[{id:'b',ts:1700001000000,price:3,usdc:7,txHash:'0xbb'},{id:'a',ts:1700000000000,price:2,usdc:5,txHash:'0xaa'}]})};};
 try{const a=await ownChart('circlewarp',address,'1m',{trades:[]});
  assert.equal(a.history.complete,true);assert.equal(a.history.records,2);
  globalThis.fetch=async()=>{throw Error('offline');};
  const b=await ownChart('circlewarp',address,'1d',{trades:[]});
  assert.equal(b.candles.length,1);assert.equal(b.candles[0].volume,12);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
