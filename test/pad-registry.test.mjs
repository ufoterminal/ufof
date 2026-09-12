// Two pads publish no token list, so their membership is read from the factory event. The rules that
// decide what counts as a launch are what these pin down.
import test from 'node:test';
import assert from 'node:assert/strict';
import {launchesFromLogs,PAD_REGISTRIES} from '../src/pad-registry.js';

const FACTORY='0x'+'f'.repeat(40);
const TOPIC=PAD_REGISTRIES.o1.topic;
const OTHER='0x'+'9'.repeat(64);
const token='0x'+'a'.repeat(40);
const pad=(topic0,first)=>({topics:[topic0,'0x'+'0'.repeat(24)+first.slice(2)],blockNumber:10n,blockTimestamp:'0x64000000',removed:false});

test('only the launch event counts, not every event the factory emits',()=>{
 const rows=launchesFromLogs([pad(TOPIC,token),pad(OTHER,'0x'+'b'.repeat(40))],'o1',FACTORY,TOPIC);
 assert.equal(rows.length,1,'a second kind of event in the same block is ignored');
 assert.equal(rows[0].token,token);
 assert.equal(rows[0].factory,FACTORY);
 assert.equal(rows[0].at,Number(BigInt('0x64000000')));
});

test('an event without a usable address in that position is dropped',()=>{
 const zero=pad(TOPIC,'0x'+'0'.repeat(40));
 const noTopic={topics:[TOPIC],blockNumber:1n,removed:false};
 const removed={...pad(TOPIC,token),removed:true};
 assert.deepEqual(launchesFromLogs([zero,noTopic,removed],'o1',FACTORY,TOPIC),[]);
});

test('both pads are configured with a factory, an event and a feed',()=>{
 for(const [id,cfg] of Object.entries(PAD_REGISTRIES)){
  assert.ok(cfg.factories.length&&cfg.factories.every(f=>/^0x[0-9a-f]{40}$/.test(f)),id+' names its factory');
  assert.ok(/^0x[0-9a-f]{64}$/.test(cfg.topic),id+' names the launch event');
  assert.ok(cfg.feed.startsWith('https://'),id+' has a market feed');
  assert.ok(cfg.tag&&cfg.label,id+' has a tag and a label');
 }
});
