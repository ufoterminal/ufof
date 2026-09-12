import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMarkets,mapMarket} from '../src/market-service.js';
const now=1800000000;
const token=(id,extra={})=>({address:'0x'+id.toString(16).padStart(40,'0'),symbol:'TOKEN'+id,name:'Token '+id,source:'tolly',marketData:true,volume:100,price:.001,marketCap:1000,createdAt:now-86400,updatedAt:now,liquidity:200,versions:['v3'],changes:{'24h':2},...extra});
test('historical tokens remain searchable outside the active list',()=>{
 const all=[token(1),token(2,{volume:0,lastTradeAt:now-100000,symbol:'OLD'})];
 assert.equal(selectMarkets(all,{},now).total,1);
 assert.equal(selectMarkets(all,{q:'old'},now).rows[0].symbol,'OLD');
 assert.equal(selectMarkets(all,{mode:'all'},now).total,2);
});
test('exact address and symbol rank before partial matches',()=>{
 const all=[token(1,{symbol:'ABCD',volume:1000}),token(2,{symbol:'ABC',volume:1})];
 assert.equal(selectMarkets(all,{q:'abc'},now).rows[0].symbol,'ABC');
 assert.equal(selectMarkets(all,{q:all[0].address.toUpperCase()},now).total,1);
});
test('filters run before pagination and unknown numbers sort last',()=>{
 const all=Array.from({length:40},(_,i)=>token(i,{source:i%2?'sharc':'tolly',volume:i,price:i===0?null:i}));
 const d=selectMarkets(all,{mode:'all',source:'tolly',limit:10,page:2,sort:'price',dir:'asc'},now);
 assert.equal(d.total,20);assert.equal(d.pages,2);assert.equal(d.rows.length,10);
 assert.equal(d.rows.at(-1).price,null);assert.ok(d.rows.every(t=>t.source==='tolly'));
});
test('watchlist includes inactive tokens but respects source filters',()=>{
 const all=[token(1,{volume:0}),token(2,{source:'sharc'})];
 const d=selectMarkets(all,{mode:'watch',source:'tolly',addresses:all.map(t=>t.address).join(',')},now);
 assert.equal(d.total,1);assert.equal(d.rows[0].address,all[0].address);
});
test('missing liquidity is not zero or eligible for a positive minimum',()=>{
 assert.equal(selectMarkets([token(1,{liquidity:null})],{minLiquidity:1},now).total,0);
 assert.equal(selectMarkets([token(1,{liquidity:null})],{},now).stats.liquidity,null);
});
test('old imported prices and timestamps are not verified feed data',()=>{
 const t=mapMarket({address:token(1).address,creation_at:Math.floor(Date.now()/1000),metadata:{source:'radardex',price:50,volume24h:500}});
 assert.equal(t.marketData,false);assert.equal(t.price,null);assert.equal(t.createdAt,null);
});
test('creation time comes from source, never discovery time',()=>{
 const created=1700000000;
 const t=mapMarket({address:token(1).address,creation_at:Math.floor(Date.now()/1000),metadata:{feed_schema:2,source:'tolly',token_created_at:created,price:0.00001}});
 assert.equal(t.createdAt,created);assert.equal(t.price,0.00001);assert.equal(t.marketData,true);
});
