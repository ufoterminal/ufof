import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedLive} from '../src/shared-live.js';
test('HTTP and SSE callers share one in-flight read and cached result',async()=>{
 let calls=0,clock=1;
 const read=sharedLive(async()=>{calls++;return {price:calls};},{now:()=>clock});
 const values=await Promise.all(Array.from({length:100},()=>read('token')));
 assert.equal(calls,1);assert.ok(values.every(v=>v.price===1));
 await read('token');assert.equal(calls,1);
 clock=1002;assert.equal((await read('token')).price,2);
});
test('failed reads release their slot and retries do not cache failure',async()=>{
 let calls=0;const read=sharedLive(async()=>{if(!calls++)throw Error('offline');return 7;});
 await assert.rejects(read('a'),/offline/);assert.equal(await read('a'),7);
});
