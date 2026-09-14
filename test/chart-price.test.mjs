import test from 'node:test';
import assert from 'node:assert/strict';
import {chartPrice,price,compactPrice} from '../public/ui-utils.js';
test('a card price writes leading zeros as a subscript count and keeps its digits',()=>{
 assert.equal(compactPrice(.00002612),'$0.0₄2612');
 assert.equal(compactPrice(1.2e-10),'$0.0₉12');
 assert.equal(compactPrice(.00099999999),'$0.0₂1','a carry moves the zero count rather than printing 10000');
 assert.equal(compactPrice(.00204301),'$0.002043');
 assert.equal(compactPrice(1234.5),'$1,234.5');
 assert.equal(compactPrice(null),'—');assert.equal(compactPrice(Infinity),'—');
});
test('axis floating point residue is zero, not a huge negative label',()=>{
 assert.equal(chartPrice(-1.89735e-19,1e-9),'$0');assert.equal(chartPrice(-0,1e-9),'$0');
 assert.equal(chartPrice(.000493004,1e-9),'$0.000493004');
});
test('genuine tiny prices remain nonzero and compact',()=>{
 assert.equal(chartPrice(1.234e-12,1e-17),'$1.234e-12');
 assert.equal(chartPrice(1e-12,1e-17),'$1e-12');
 assert.equal(chartPrice(null),'—');assert.equal(chartPrice(Infinity),'—');
 assert.ok(chartPrice(1e20).length<15);
 assert.equal(price(.000493004),'$0.000493004');
});
