import test from 'node:test';
import assert from 'node:assert/strict';
import {appendLiveCandles,mergeLiveMarket,currentChartValue} from '../public/live-candles.js';
const pool='primary',last=86400+120;
const trades=[{id:'a',pool,at:last+60,price:2,usd_volume:3},{id:'b',pool,at:last+120,price:3,usd_volume:4}];
test('all six intervals end at the same verified execution; duplicate delivery adds no volume',()=>{
 for(const seconds of [60,300,900,3600,14400,86400]){
  const base=[{bucket:Math.floor(last/seconds)*seconds,open:1,high:1,low:1,close:1,volume:5}];
  const result=appendLiveCandles(base,{pool,lastTradeAt:last},[...trades,...trades],seconds,pool,last+200);
  assert.equal(result.at(-1).close,3);assert.equal(result.reduce((n,c)=>n+c.volume,0),12);assert.equal(base[0].close,1);
  assert.deepEqual(appendLiveCandles(base,{pool,lastTradeAt:last},trades,seconds,pool,last+200),result);
 }
});
test('secondary, unlabelled, future and snapshot-covered trades cannot create spikes',()=>{
 const base=[{bucket:last,open:1,high:1,low:1,close:1,volume:5}];
 const invalid=[{...trades[0],pool:'other',price:999},{...trades[0],pool:null,price:999},{...trades[0],at:last},{...trades[0],at:last+1000}];
 assert.deepEqual(appendLiveCandles(base,{pool,lastTradeAt:last},invalid,60,pool,last+200),base);
 assert.deepEqual(appendLiveCandles(base,{},trades,60,pool,last+200),base);
});
test('timeframe snapshots cannot replace the live valuation, including explicit unknown',()=>{
 const live={address:'a',price:.105,marketCap:105000,fdv:110000,pool};
 for(const marketCap of [150000,105000,120000]){
  const merged=mergeLiveMarket({address:'a',price:.15,marketCap},live);
  assert.equal(currentChartValue(merged,'mc'),105000);assert.equal(currentChartValue(merged,'price'),.105);
 }
 assert.equal(mergeLiveMarket({address:'a',price:1},{address:'a',price:null}).price,null);
 assert.equal(mergeLiveMarket({address:'b',price:1},live).price,1);
});
