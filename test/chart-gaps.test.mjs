import test from 'node:test';
import assert from 'node:assert/strict';
import {fillChartGaps} from '../public/chart-gaps.js';
import {primaryPool} from '../src/primary-pool.js';
test('inactive buckets carry price with zero volume and explicit empty flag',()=>{
 const rows=[{bucket:60,open:1,high:2,low:1,close:2,volume:5},{bucket:240,open:2,high:3,low:2,close:3,volume:7}];
 const result=fillChartGaps(rows,60,300);
 assert.deepEqual(result.map(c=>c.close),[2,2,2,3,3]);
 assert.equal(result.reduce((n,c)=>n+c.volume,0),12);
 assert.equal(result[1].empty,true);assert.equal(result[1].trades,0);
 assert.equal(rows.length,2);
});
test('gap filling is bounded and never creates pre-launch or future candles',()=>{
 const rows=[{bucket:60,close:2,volume:1}];
 assert.equal(fillChartGaps(rows,60,60000,10).length,10);
 assert.deepEqual(fillChartGaps([],60,60000),[]);
 assert.equal(fillChartGaps(rows,60,120)[0].bucket,60);
 assert.equal(fillChartGaps(rows,60,120).at(-1).bucket,120);
});
test('liquidity chooses primary pool, minor fluctuations do not switch it',()=>{
 assert.equal(primaryPool([{pool:'v2',liquidityUsdc:34000},{pool:'v3',liquidityUsdc:5},{pool:'v4',liquidityUsdc:190}],'v3'),'v2');
 assert.equal(primaryPool([{pool:'a',liquidityUsdc:100},{pool:'b',liquidityUsdc:95}],'b'),'b');
 assert.equal(primaryPool([{pool:'a',liquidityUsdc:null}],'known'),'known');
});
