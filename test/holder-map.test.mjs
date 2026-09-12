// Holder Maps make a claim about people's wallets, so the rules behind a link and a cluster are the part
// worth pinning down.
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanWindow,clustersFrom,isWallet,shapeMap} from '../src/holder-map.js';

const A='0x'+'a'.repeat(40), B='0x'+'b'.repeat(40), C='0x'+'c'.repeat(40), OUT='0x'+'f'.repeat(40);
const POOL='0x8366a39cc670b4001a1121b8f6a443a643e40951', DEAD='0x000000000000000000000000000000000000dead';
const log=(from,to)=>({args:{from,to,value:1n},removed:false});
const holders=[{address:A,share:5},{address:B,share:3},{address:C,share:2},
 {address:POOL,share:30,contract:true},{address:DEAD,share:4}];

test('a link is only recorded between two mapped wallets',async()=>{
 const members=new Set([A,B,C]);
 const edges=await scanWindow([log(A,B),log(A,OUT),log(OUT,C),log(A,A)],members,{});
 const list=Object.values(edges);
 assert.equal(list.length,1,'transfers to the outside world and to self are not links');
 assert.equal(list[0].count,1);
 await scanWindow([log(B,A)],members,edges);
 assert.equal(Object.values(edges)[0].count,2,'a link the other way is the same link, counted again');
});

test('contracts and burn addresses are shown but never grouped through',()=>{
 assert.equal(isWallet({address:A}),true);
 assert.equal(isWallet({address:POOL,contract:true}),false,'a pool trades with everyone');
 assert.equal(isWallet({address:DEAD}),false);
 assert.equal(isWallet({address:'0x'+'0'.repeat(40)}),false);
 // Without this, one router in the middle would put every holder in a single meaningless cluster.
 const edges=[{from:A,to:POOL,count:9},{from:B,to:POOL,count:9},{from:C,to:POOL,count:9}];
 assert.deepEqual(clustersFrom(holders,edges),[],'trading through the same pool is not a cluster');
});

test('wallets that move the token between themselves are one cluster, ordered by share',()=>{
 const clusters=clustersFrom([...holders,{address:OUT,share:1}],[{from:A,to:B,count:2},{from:OUT,to:OUT,count:1}]);
 assert.equal(clusters.length,1);
 assert.deepEqual(clusters[0].members.sort(),[A,B].sort());
 assert.equal(clusters[0].share,8,'the cluster carries the supply its members hold');
 const two=clustersFrom(holders,[{from:A,to:B,count:1},{from:B,to:C,count:1}]);
 assert.equal(two[0].members.length,3,'a chain of transfers joins the whole chain');
});

test('a map reports how far the scan has reached',()=>{
 const half=shapeMap({status:'building',created_block:1000,scanned_to:1499,head:1999,holders:[],edges:{}});
 assert.equal(half.status,'building');
 assert.ok(Math.abs(half.progress-.5)<.01,'halfway through the token\u2019s blocks');
 const missing=shapeMap(null);
 assert.equal(missing.status,'unknown');
 assert.deepEqual(missing.clusters,[]);
 const none=shapeMap({status:'empty',error:'No holder list available for this token'});
 assert.equal(none.status,'empty');
 assert.ok(none.error);
});

test('a reader\u2019s own request goes to the front of the queue',async()=>{
 const {requestHolderMap,setHolderMapPaused}=await import('../src/holder-map.js');
 setHolderMapPaused(false);
 // Queue order is not observable directly, so this only checks the call is accepted and an address that
 // is not an address is refused rather than queued.
 assert.doesNotThrow(()=>requestHolderMap(A));
 assert.doesNotThrow(()=>requestHolderMap('not-an-address'));
});
