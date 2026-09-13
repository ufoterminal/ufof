import test from 'node:test';
import assert from 'node:assert/strict';
import {directDetail,cachedJson,candlesFromTrades,ownList,warpDaily,normalizeChart} from '../src/direct.js';
test('shared candles aggregate OHLCV without double-counting snapshots or filling gaps',()=>{
 const a={time:1800000000000,open:2,high:4,low:1,close:3,volume:5};
 const d=normalizeChart([a,{time:1800000300,open:3,high:6,low:2,close:5,volume:7},a,{time:1800001800,open:5,high:5,low:4,close:4,volume:1}],900);
 assert.deepEqual(d.candles,[{bucket:1800000000,open:2,high:6,low:1,close:5,volume:12},{bucket:1800001800,open:5,high:5,low:4,close:4,volume:1}]);
});
test('Warp no longer fetches provider OHLC for any timeframe',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>String(url).includes('/candles?')?[]:{}};};
 try{
  for(const tf of ['1m','5m','15m','1h','4h','1d'])await directDetail('circlewarp','0x'+'7'.repeat(40),tf);
  assert.deepEqual(calls.filter(u=>u.includes('/candles?')),[]);
 }finally{globalThis.fetch=original;}
});
test('Warp daily volume pages past the first 100 trades and excludes old or duplicate entries',async()=>{
 const original=globalThis.fetch,now=1789060000;let calls=0;
 const first=Array.from({length:100},(_,i)=>({id:String(i),ts:(now-i)*1000,usdc:2}));
 globalThis.fetch=async()=>({ok:true,json:async()=>({trades:++calls===1?first:[first[0],{id:'new',ts:now*1000,usdc:3},{id:'old',ts:(now-86401)*1000,usdc:900}],total:103})});
 try{assert.deepEqual(await warpDaily({address:'0x'+'f'.repeat(40)},now),{volume24h:203,txns24h:101});assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
// DYOR is no longer read through its own paginated API: its launches come from its factory on chain,
// so there is no cursor walk left to test. What replaces it is covered in pad-registry.test.mjs.
test('DYOR trades become source-faithful OHLCV candles',()=>{
 const rows=candlesFromTrades([
  {at:1202,buy:true,price:2.25,usd_volume:2},{at:1201,buy:true,price:2.5,usd_volume:1},
  {at:659,buy:false,price:3,usd_volume:5},{at:601,buy:true,price:2,usd_volume:4},
 ],60);
 assert.deepEqual(rows,[
  {bucket:600,open:2,high:3,low:2,close:3,volume:9,trades:2},
  {bucket:1200,open:2.5,high:2.5,low:2.25,close:2.25,volume:3,trades:2}
 ]);
});
test('a failed chart does not suppress valid trade data',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>({ok:!url.includes('/chart?'),status:url.includes('/chart?')?503:200,json:async()=>url.includes('/swaps?')?{swaps:[{time:1700000000,side:'buy',usdc:12,price:.001}]}:{launched:true,launchpad:'radar',price:.001}});
 try{const d=await directDetail('radardex','0x'+'b'.repeat(40));assert.equal(d.trades.length,1);assert.ok(d.errors.chart);assert.equal(d.candles.length,0);}finally{globalThis.fetch=original;}
});
test('invalid candles are omitted, not fabricated',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>({ok:true,json:async()=>url.includes('/candles?')?{candles:[{time:100,open:1,high:3,low:.5,close:2},{time:200,open:1,high:3,low:2,close:2}]}:{swaps:[]}});
 try{const d=await directDetail('tolly','0x'+'c'.repeat(40));assert.equal(d.candles.length,1);assert.ok(d.errors.chartNotice);assert.equal(d.chartMode,'close');assert.equal(d.closes.length,1);assert.equal(d.closes[0].value,2);}finally{globalThis.fetch=original;}
});
test('simultaneous upstream reads are coalesced and cached',async()=>{
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async()=>{count++;await new Promise(r=>setTimeout(r,10));return {ok:true,json:async()=>({n:1})};};
 try{await Promise.all([cachedJson('https://example.test/cache'),cachedJson('https://example.test/cache')]);await cachedJson('https://example.test/cache');assert.equal(count,1);}finally{globalThis.fetch=original;}
});
test('DYOR detail keeps trades while its API has no chart endpoint',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/trades?limit=100')?{items:[{created_at:1700000000000,side:'BUY',amount_eth:'50000000',amount_token:'10000000000000000000000',trader:'0x'+'1'.repeat(40),tx_hash:'0x'+'2'.repeat(64)}]}:{chain:'arc',chainId:5042,marketCapEth:'1000000000'}});
 try{const d=await directDetail('dyor','0x'+'e'.repeat(40));assert.equal(d.trades.length,1);assert.equal(d.trades[0].usd_volume,50);assert.equal(d.trades[0].price,.005);assert.equal(d.candles.length,1);assert.equal(d.candles[0].close,.005);}finally{globalThis.fetch=original;}
});
