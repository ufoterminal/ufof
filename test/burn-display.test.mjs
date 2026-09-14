import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {burnPercent,burnText,syncNotice} from '../public/live-ui.js';
import {burnFields} from '../src/market-service.js';
test('the list notice only appears when the list itself has stopped refreshing',()=>{
 const now=1800000000;
 assert.equal(syncNotice({lastSync:now-60,lastError:'dyor: timed out'},now,true),'','one feed failing a round keeps its data and is not flagged');
 assert.match(syncNotice({lastSync:now-400,lastError:null},now,true),/not refreshed/,'no successful round for minutes is');
 assert.equal(syncNotice({syncing:true,lastSync:null},now,false),'Connecting to source feeds…');
 assert.equal(syncNotice({syncing:true,lastSync:null},now,true),'');
 assert.match(syncNotice({syncing:false,lastSync:null,lastError:'database unavailable'},now,false),/could not be refreshed/,'a first round that failed outright is');
 assert.equal(syncNotice(undefined,now,true),'');
});
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
test('the burn reads as the amount taken out of supply and its share',()=>{
 const count=n=>Number(n).toLocaleString('en-US',{notation:Math.abs(n)>=10000?'compact':'standard',maximumFractionDigits:1});
 assert.equal(burnText({burned:2500000,burnedPercent:25,deadBurnedPercent:25},count),'2.5M · %25');
 assert.equal(burnText({burned:2500000,burnedPercent:null,deadBurnedPercent:null},count),'2.5M');
 assert.equal(burnText({burned:null,deadBurnedPercent:4.2},count),'%4,2');
 assert.equal(burnText({burned:null,deadBurnedPercent:null,burnLoading:true},count),'Reading…');
 assert.equal(burnText({burned:null,deadBurnedPercent:null},count),'—');
});
test('recent volume and trader splits are no longer rendered',()=>{
 const text=readFileSync(new URL('../public/terminal.js',import.meta.url),'utf8');
 assert.equal(/Recent buy vol|Recent sell vol|Recent buyers|Recent sellers|Recent breakdown/.test(text),false);
 assert.ok(text.includes('Volume · 24h'));assert.ok(text.includes('Traders · 24h'));
});
