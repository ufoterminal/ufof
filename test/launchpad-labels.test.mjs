import test from 'node:test';
import assert from 'node:assert/strict';
import {mapMarket,selectMarkets} from '../src/market-service.js';
import {LAUNCHPADS,launchpadId} from '../public/sources.js';
test('a factory-backed pad survives a different price source',()=>{
 const row=mapMarket({address:'0x1',launchpad_id:'dyor',metadata:{feed_schema:2,source:'uniswap'}});
 assert.equal(row.launchpad,'dyor');assert.equal(row.source,'uniswap');
});
test('a price source alone cannot invent launchpad origin',()=>{
 assert.equal(mapMarket({address:'0x1',metadata:{feed_schema:2,source:'radardex'}}).launchpad,null);
 for(const id of ['uniswap','onchain','unknown','constructor'])assert.equal(launchpadId(id),null);
 assert.equal(Object.keys(LAUNCHPADS).length,11);
});
test('launchpad filtering works independently of DEX source',()=>{
 const rows=['dyor','long'].map((id,i)=>mapMarket({address:'0x'+i,launchpad_id:id,metadata:{feed_schema:2,source:'uniswap'}}));
 assert.equal(selectMarkets(rows,{launchpad:'dyor'}).rows.length,1);
 assert.equal(selectMarkets(rows,{launchpad:'dyor'}).rows[0].launchpad,'dyor');
});
