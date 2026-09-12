import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDex} from '../src/dex-markets.js';
import {aggregateVolumeBins} from '../src/direct.js';
const address='0x'+'8'.repeat(40);
test('DEX discovery preserves a known launchpad and classifies independent markets',()=>{
 const make=t=>normalizeDex({tokens:[{address,versions:['v3','v4'],...t}]})[0];
 assert.equal(make({launchpad:'poolstrade'}).metadata.source,'pools-trade');
 assert.equal(make({}).metadata.source,'uniswap');
 assert.deepEqual(make({}).metadata.venues,['uniswap-v3','uniswap-v4']);
 // A pad we have not integrated is kept as the venue it trades on, with its raw tag recorded, rather
 // than being dropped from the market list.
 const other=make({launchpad:'unknown-pad'});
 assert.equal(other.metadata.source,'uniswap');
 assert.equal(other.metadata.upstream_launchpad,'unknown-pad');
 assert.equal(other.metadata.launchpad_origin,null,'an unknown tag is never read as one of our pads');
 const dy=make({versions:['v2'],v2Dexes:['dyor'],topVersion:'v2',topDex:'dyor'});
 assert.equal(dy.metadata.source,'dyorswap-v2');assert.equal(dy.metadata.dex_primary,true);
 assert.equal(make({versions:['v2'],v2Dexes:['warp']}),undefined);
});
test('coarse volume bins aggregate once and cannot be represented as minute volumes',()=>{
 const rows=[{time:1800000000,volumeUsd:5},{time:1800000600,volumeUsd:7},{time:1800001200,volumeUsd:9}];
 assert.equal(aggregateVolumeBins(rows,60).size,0);assert.equal(aggregateVolumeBins(rows,300).size,0);
 assert.equal(aggregateVolumeBins([...rows,rows[0]],3600).get(1800000000),21);
});
