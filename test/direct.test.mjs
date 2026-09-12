import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDirect} from '../src/direct.js';
const address='0x'+'a'.repeat(40);
test('Noxa mirror rejects other pads and retains inactive historical tokens',()=>{
 const rows=normalizeDirect('noxa',{tokens:[{address,launchpad:'noxa',symbol:'OLD',volume24:0,deployTs:1700000000},{address,launchpad:'radar'},{address}]});
 assert.equal(rows.length,1);assert.equal(rows[0].metadata.source,'noxa');assert.equal(rows[0].launchpad_id,'noxa');assert.equal(rows[0].metadata.volume24h,0);assert.equal(rows[0].creation_at,1700000000);
});
test('Sharc uses its declared scales and never treats all-time counts as 24h',()=>{
 const [t]=normalizeDirect('sharc',[{address,chainKey:'arc',priceE18:'2000000000000',marketCap:'2000000000',volume24h:'12500000',change24hBps:'1250',tradesCount:1000,tradersCount:50,createdAt:'1700000000'}]);
 assert.equal(t.metadata.price,.000002);assert.equal(t.metadata.mcap,2000);
 assert.equal(t.metadata.volume24h,12.5);assert.equal(t.metadata.changes['24h'],12.5);
 assert.equal(t.metadata.txns24h,null);assert.equal(t.metadata.traders24h,null);
 assert.equal(t.metadata.liquidity,null);assert.equal(t.metadata.token_created_at,1700000000);
});
test('Tolly rejects external markets',()=>{
 assert.equal(normalizeDirect('tolly',{tokens:[{address,tolly:false}]}).length,0);
 assert.equal(normalizeDirect('tolly',{tokens:[{address,tolly:true,price:.000001}]}).length,1);
});
test('Sharc rejects a token from another chain',()=>{
 assert.equal(normalizeDirect('sharc',[{address,chainKey:'base'}]).length,0);
});
test('Archemist keeps only its first-party launch registry fields',()=>{
 const [t]=normalizeDirect('archemist',{tokens:[{token_address:address,network:'mainnet',name:'ARC',symbol:'ARC',created_at:'2026-01-01T00:00:00Z',launch_factory_address:'0x'+'b'.repeat(40),protocol_version:'archemist-v2-usdc',token_snapshots:{price:.00001,market_cap:10000,volume_24h:12,holder_count:7},live:{currentPrice:.00002,marketCap:20000,volume_24h:20}}]});
 assert.equal(t.address,address);assert.equal(t.metadata.price,.00002);assert.equal(t.metadata.mcap,20000);assert.equal(t.metadata.volume24h,20);assert.equal(t.metadata.holders,7);assert.equal(t.factory,'0x'+'b'.repeat(40));assert.deepEqual(t.metadata.versions,['v2']);
});
test('CircleWarp maps its own Arc screener metrics',()=>{
 const [t]=normalizeDirect('circlewarp',[{address,name:'WARP',ticker:'WARP',chain:'Arc',createdAt:1700000000000,lastTradeAt:1700001000000,price:.001,mcap:1000,volume:250,txCount:12,traders:9,holders:8,liquidity:500,poolKind:'v4'}]);
 assert.equal(t.metadata.mcap,1000);assert.equal(t.metadata.volume24h,null);assert.equal(t.metadata.volumeAllTime,250);assert.equal(t.metadata.txns24h,null);assert.equal(t.metadata.holders,8);assert.equal(t.creation_at,1700000000);assert.deepEqual(t.metadata.versions,['v4']);
});
test('pools.trade accepts only poolstrade-labelled Arc records',()=>{
 const [t]=normalizeDirect('pools-trade',{tokens:[{address,name:'BARC',symbol:'BARC',launchpad:'poolstrade',versions:['v3','v4'],price:.001,mcap:100000,liquidityUsdc:5000,volume24:250,txns24:12,traders24:9,holderCount:8,change24h:12,firstSeen:1700000000}]});
 assert.equal(t.source,undefined); assert.equal(t.launchpad_id,'pools-trade'); assert.equal(t.metadata.price,.001); assert.equal(t.metadata.liquidity,5000); assert.deepEqual(t.metadata.versions,['v3','v4']);
 assert.equal(normalizeDirect('pools-trade',{tokens:[{address,launchpad:'radar'}]}).length,0);
});
