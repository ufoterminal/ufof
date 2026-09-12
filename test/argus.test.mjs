// ArgusPad membership comes from its Portal contracts. These run against a fake chain reader so they are
// deterministic; the live check is in the README.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ARGUS_PORTALS,refreshRegistry,resetRegistry,registryState} from '../src/argus.js';
import {normalizeDirect} from '../src/direct.js';
import {SOURCES} from '../public/sources.js';
import {icon} from '../public/ui-utils.js';

const A=n=>'0x'+n.toString(16).padStart(40,'0');
const [current,,,,legacy]=ARGUS_PORTALS.map(p=>p.address);

function fakeChain(counts,{fail=new Set()}={}){
 const calls={count:0,token:0};
 return {calls,counts,
  count:async portal=>{calls.count++;if(fail.has(portal))throw Error('rpc down');return counts[portal]||0;},
  token:async(portal,i)=>{calls.token++;return A(ARGUS_PORTALS.findIndex(p=>p.address===portal)*1000+i+1);},
  meta:async()=>({name:'Fresh',symbol:'FRSH',decimals:18})};
}

test('registry reads every Portal and only new indices on refresh', async()=>{
 resetRegistry();
 const chain=fakeChain({[current]:2,[legacy]:1});
 let entries=await refreshRegistry(chain);
 assert.equal(entries.length,3);
 assert.equal(chain.calls.token,3);
 assert.ok(entries.every(e=>/^0x[0-9a-f]{40}$/.test(e.address)));
 assert.equal(entries.find(e=>e.portal===legacy).line,'legacy-v3');
 chain.counts[current]=3;
 entries=await refreshRegistry(chain);
 assert.equal(entries.length,4);
 assert.equal(chain.calls.token,4,'only the one new launch is read');
});

test('one Portal failing keeps the others, all failing is an error', async()=>{
 resetRegistry();
 const entries=await refreshRegistry(fakeChain({[current]:2,[legacy]:1},{fail:new Set([legacy])}));
 assert.equal(entries.length,2);
 assert.ok(registryState.errors[legacy]);
 resetRegistry();
 await assert.rejects(()=>refreshRegistry(fakeChain({},{fail:new Set(ARGUS_PORTALS.map(p=>p.address))})),/registry unreadable/);
});

const inRegistry=A(1),notInRegistry=A(2),pending=A(3);
const registry=[{address:inRegistry,portal:current,index:0,line:'hooked-v4'},{address:pending,portal:current,index:1,line:'hooked-v4',name:'Fresh',symbol:'FRSH',decimals:18}];

test('a feed row needs both the ArgusPad tag and a Portal listing', ()=>{
 const rows=normalizeDirect('argus',{registry,tokens:[
  {address:inRegistry,launchpad:'argus',symbol:'ARG',price:.002,mcap:2e6,volume24:500,icon:'https://example.com/a.png',deployTs:1788373928},
  {address:notInRegistry,launchpad:'argus',symbol:'FAKE',price:1},
  {address:pending,launchpad:'noxa',symbol:'OTHER',price:1}
 ]});
 const byAddress=new Map(rows.map(r=>[r.address,r]));
 assert.ok(!byAddress.has(notInRegistry),'tagged argus but no Portal lists it');
 const arg=byAddress.get(inRegistry);
 assert.equal(arg.launchpad_id,'argus');
 assert.equal(arg.metadata.source,'argus');
 assert.equal(arg.factory,current);
 assert.equal(arg.metadata.price,.002);
 assert.equal(arg.metadata.logo,'https://example.com/a.png');
 const fresh=byAddress.get(pending);
 assert.equal(fresh.symbol,'FRSH','listed on chain, other pad tag ignored, named from the token contract');
 assert.equal(fresh.metadata.price,null,'no market numbers means unknown, not zero');
 assert.equal(fresh.metadata.volume24h,null);
});

test('no registry means no ArgusPad rows', ()=>{
 assert.throws(()=>normalizeDirect('argus',{tokens:[{address:inRegistry,launchpad:'argus'}]}),/registry missing/);
});

test('ArgusPad is a known source with a label of its own', ()=>{
 assert.equal(SOURCES.argus.label,'ArgusPad');
});

test('search rows carry the logo, with a letter mark fallback', ()=>{
 assert.ok(icon({symbol:'ARG',logo:'https://example.com/a.png'}).includes('<img'));
 const bare=icon({symbol:'ARG',logo:null});
 assert.ok(!bare.includes('<img')&&bare.includes('AR'));
});
