import test from 'node:test';
import assert from 'node:assert/strict';
import {price,percent,color,esc,safeUrl,age,since,icon} from '../public/ui-utils.js';
test('sub-cent prices retain significant digits',()=>{
 assert.equal(price(.0000001234567),'$0.000000123457');
 assert.equal(price(null),'—');assert.equal(price(0),'$0');
});
test('missing numbers and timestamps stay unknown',()=>{
 assert.equal(percent(null),'—');assert.equal(color(null),'muted');
 assert.equal(age(null),'—');assert.equal(since(null),'—');assert.equal(percent(0),'0.00%');
});
test('token text is escaped and executable URLs rejected',()=>{
 assert.equal(esc('<img>'),'&lt;img&gt;');
 assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('data:text/html,test'),null);
 assert.ok(!icon({symbol:'X',logo:'javascript:alert(1)'}).includes('<img'));
});
