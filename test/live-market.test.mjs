import test from 'node:test';
import assert from 'node:assert/strict';
import {windowStats} from '../src/live-market.js';
const now=200000;
const rows=[{id:'1',at:now-10,usd_volume:25,buy:true,trader:'a'},{id:'2',at:now-5,usd_volume:10,buy:false,trader:'b'}];
test('a recent page is not falsely advertised as a full day',()=>assert.equal(windowStats(rows,now),null));
test('a page extending beyond 24h yields accurate buy/sell totals',()=>{
 const d=windowStats([...rows,rows[0],{id:'old',at:now-86401,usd_volume:999,buy:true}],now);
 assert.equal(d.buyVolume,25);assert.equal(d.sellVolume,10);assert.equal(d.volume,35);assert.equal(d.transactions,2);
 assert.equal(d.buyers,1);assert.equal(d.sellers,1);
});
test('recent statistics can be computed explicitly without pretending coverage',()=>{
 assert.equal(windowStats(rows,now,true).volume,35);
});
