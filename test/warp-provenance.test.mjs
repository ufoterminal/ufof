import test from 'node:test';
import assert from 'node:assert/strict';
import {directDetail} from '../src/direct.js';
test('Warp declares the migrated pair and only WarpDex trades carry that pool',async()=>{
 const address='0x'+'9'.repeat(40),pair='0x'+'8'.repeat(40),original=globalThis.fetch;
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('/trades?')?{trades:[{id:'a',venue:'WarpDex',ts:Date.now(),price:2,usdc:3},{id:'b',venue:'OtherDex',ts:Date.now(),price:999,usdc:1}]}:{address,migrated:true,pairAddress:pair,price:2}),{status:200});
 try{
  const d=await directDetail('circlewarp',address,'1m',true);
  assert.equal(d.detail.bestPool,pair);
  assert.equal(d.trades.find(t=>t.id==='a').pool,pair);
  assert.equal(d.trades.find(t=>t.id==='b').pool,null);
 }finally{globalThis.fetch=original;}
});
