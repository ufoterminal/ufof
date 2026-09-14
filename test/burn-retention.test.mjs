import test from 'node:test';
import assert from 'node:assert/strict';
import {retainBurnReading} from '../public/live-ui.js';
test('empty detail snapshot retains verified burn without retaining stale price',()=>{
 const old={address:'0xABC',burned:24648336,burnedPercent:2.46,deadBurnedPercent:2.46,price:1};
 const next={address:'0xabc',deadBurnedPercent:null,price:2,burnLoading:true};
 const merged=retainBurnReading(next,old);
 assert.equal(merged.burned,24648336);assert.equal(merged.burnedPercent,2.46);
 assert.equal(merged.price,2);assert.equal(merged.burnLoading,false);
 assert.equal(next.deadBurnedPercent,null);
});
test('new verified zero replaces old reading and different tokens never share burns',()=>{
 const old={address:'a',burned:42,burnedPercent:4};
 assert.equal(retainBurnReading({address:'a',burned:0,burnedPercent:0},old).burnedPercent,0);
 assert.equal(retainBurnReading({address:'b'},old).burned,undefined);
 assert.equal(retainBurnReading({address:'a'},undefined).burned,undefined);
});
