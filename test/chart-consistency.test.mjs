import test from 'node:test';
import assert from 'node:assert/strict';
import {chartMatchesMarket} from '../public/chart-consistency.js';
test('only the matching primary-pool execution may be displayed',()=>{
 const market={pool:'0xABC',price:.000105};
 assert.equal(chartMatchesMarket([{close:.000105}],{pool:'0xabc'},market),true);
 assert.equal(chartMatchesMarket([{close:.000153}],{pool:'0xabc'},market),false);
 assert.equal(chartMatchesMarket([{close:.000105}],{pool:'secondary'},market),false);
 assert.equal(chartMatchesMarket([],{pool:'0xabc'},market),false);
 assert.equal(chartMatchesMarket([{close:.000105}],{},market),false);
});
