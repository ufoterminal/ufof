import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {burnPercent} from '../public/live-ui.js';
import {burnFields} from '../src/market-service.js';
test('persisted dead-address readings are available without waiting for a chart or RPC',()=>{
 for(const value of [0,4.2]){
  const r=burnFields({address:'0x'+'a'.repeat(40),metadata:{burn_reading:{at:Date.now(),value:{deadPercent:value}}}});
  assert.equal(r.deadBurnedPercent,value);assert.equal(r.burnLoading,false);
 }
});
test('burn percentages include real zero, preserve unknown and format compactly',()=>{
 assert.equal(burnPercent(4),'%4');assert.equal(burnPercent(0),'%0');
 assert.equal(burnPercent(4.126),'%4,13');assert.equal(burnPercent(null),'—');
 assert.equal(burnPercent(0.001),'%<0,01');assert.equal(burnPercent(Infinity),'—');
});
test('recent volume and trader splits are no longer rendered',()=>{
 const text=readFileSync(new URL('../public/terminal.js',import.meta.url),'utf8');
 assert.equal(/Recent buy vol|Recent sell vol|Recent buyers|Recent sellers|Recent breakdown/.test(text),false);
 assert.ok(text.includes('Volume · 24h'));assert.ok(text.includes('Traders · 24h'));
});
