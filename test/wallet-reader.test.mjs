import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletReader} from '../src/wallet-reader.js';
const item=n=>({TokenAddress:'0x'+n.toString(16).padStart(40,'0'),TokenQuantity:'1',TokenDivisor:'0'});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('all pages continue across bounded passes and duplicate addresses do not double-count',async()=>{
 const pages=[Array.from({length:100},(_,i)=>item(i+1)),Array.from({length:100},(_,i)=>item(i+100)),[item(200)]];
 const calls=[];const read=createWalletReader({pagesPerPass:1,readPage:async(_,p)=>{calls.push(p);return pages[p-1];},readNative:async()=>0});
 await read('a');await turn();await read('a');await turn();const result=await read('a');await turn();const final=await read('a');
 assert.deepEqual(calls,[1,2,3]);assert.equal(final.complete,true);assert.equal(final.result.length,200);
});
test('fast tokens do not wait for a stalled native balance; concurrent readers share jobs',async()=>{
 let pages=0,natives=0,release;
 const read=createWalletReader({readPage:async()=>{pages++;return [item(1)];},readNative:()=>{natives++;return new Promise(r=>{release=r;});},waitMs:100});
 const [a,b]=await Promise.all([read('a'),read('a')]);
 assert.equal(a.result.length,1);assert.equal(b.result.length,1);assert.equal(a.usdc,null);assert.equal(a.pending,true);
 assert.equal(pages,1);assert.equal(natives,1);release(3);await turn();assert.equal((await read('a')).usdc,3);
});
test('page failures retain earlier balances, remain incomplete and resume the failed page',async()=>{
 let fail=true;const calls=[];
 const read=createWalletReader({retryMs:0,readPage:async(_,p)=>{calls.push(p);if(p===1)return Array.from({length:100},(_,i)=>item(i+1));if(fail)throw Error('offline');return [item(101)];},readNative:async()=>0});
 await read('a');await turn();let partial=await read('a');await turn();
 assert.equal(partial.complete,false);assert.equal(partial.result.length,100);
 fail=false;await read('a');await turn();const final=await read('a');
 assert.equal(final.complete,true);assert.equal(final.result.length,101);assert.equal(calls.filter(n=>n===1).length,1);
});
test('repeated pages are flagged instead of silently claiming complete coverage',async()=>{
 const read=createWalletReader({readPage:async()=>Array.from({length:100},(_,i)=>item(i+1)),readNative:async()=>0});
 await read('a');await turn();const d=await read('a');assert.equal(d.complete,false);assert.match(d.errors.tokens,/repeated/);assert.equal(d.result.length,100);
});
test('failed refresh retains previous scan; a successful empty refresh clears it',async()=>{
 let now=100,mode='full';
 const read=createWalletReader({now:()=>now,ttl:10,retryMs:5,readPage:async()=>{if(mode==='error')throw Error('offline');return mode==='full'?[item(1)]:[];},readNative:async()=>0});
 await read('a');await turn();now=200;mode='error';await read('a');await turn();
 const failed=await read('a');assert.equal(failed.result.length,1);assert.equal(failed.stale,true);assert.equal(failed.complete,false);
 mode='empty';now=300;await read('a');await turn();const empty=await read('a');assert.equal(empty.complete,true);assert.equal(empty.result.length,0);
});
