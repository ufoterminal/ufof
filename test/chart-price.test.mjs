import test from 'node:test';
import assert from 'node:assert/strict';
import {chartPrice,price} from '../public/ui-utils.js';
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
