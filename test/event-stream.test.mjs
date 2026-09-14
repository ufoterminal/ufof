import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createEventStream} from '../src/event-stream.js';
const token='0x'+'1'.repeat(40);
class Response extends EventEmitter{
 chunks=[];destroyed=false;writableEnded=false;
 set(){return this;}flushHeaders(){}status(code){this.code=code;return this;}
 write(s){this.chunks.push(s);return true;}
 end(){this.writableEnded=true;this.emit('close');}
 destroy(){this.destroyed=true;this.emit('close');}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('viewers of the same token share one read; unchanged data is not resent',async()=>{
 const events=new EventEmitter();let reads=0;
 const hub=createEventStream(async()=>{reads++;return {market:{price:1},receivedAt:reads};},events,{interval:20});
 const a=new Response(),b=new Response();
 try{
  hub.handler({query:{token}},a);hub.handler({query:{token}},b);
  await pause(85);
  assert.ok(reads>=2);assert.equal(a.chunks.filter(s=>s.startsWith('event: live')).length,1);
  assert.equal(b.chunks.filter(s=>s.startsWith('event: live')).length,1);
  a.end();b.end();const stopped=reads;await pause(45);assert.equal(reads,stopped);
 }finally{hub.close();}
});
test('snapshot events reach matching token and homepage; limits and validation apply',()=>{
 const events=new EventEmitter(),hub=createEventStream(async()=>null,events,{maxClients:2});
 const a=new Response(),home=new Response(),excess=new Response(),bad=new Response();
 try{
  hub.handler({query:{token:'invalid'}},bad);assert.equal(bad.code,400);
  hub.handler({query:{token}},a);hub.handler({query:{}},home);
  hub.handler({query:{}},excess);assert.equal(excess.code,503);
  events.emit('changed',{token,tf:'5m'});
  assert.ok(a.chunks.some(s=>s.includes('event: chart')));assert.ok(home.chunks.some(s=>s.includes('event: markets')));
 }finally{hub.close();}
 assert.equal(events.listenerCount('changed'),0);
});
test('a slow read does not overlap and is discarded after disconnect',async()=>{
 const events=new EventEmitter();let release,reads=0;
 const hub=createEventStream(()=>{reads++;return new Promise(r=>release=r);},events,{interval:5});
 const a=new Response();hub.handler({query:{token}},a);
 await pause(20);assert.equal(reads,1);a.end();release({market:{price:2}});
 await pause(10);assert.equal(a.chunks.filter(s=>s.includes('event: live')).length,0);hub.close();
});
