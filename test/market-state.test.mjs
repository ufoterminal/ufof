import test from 'node:test';
import assert from 'node:assert/strict';
import {retainValuation} from '../public/market-state.js';
test('late timeframe payload cannot roll back a newer valuation packet',()=>{
 const current={address:'a',price:2,marketCap:200,fdv:220,pool:'primary',priceAt:20};
 const incoming={address:'a',price:1,marketCap:100,fdv:110,pool:'secondary',priceAt:10,volume:8};
 const result=retainValuation(incoming,current);
 assert.equal(result.price,2);assert.equal(result.marketCap,200);assert.equal(result.pool,'primary');assert.equal(result.volume,8);
});
test('newer values, other tokens and unversioned initial data are accepted',()=>{
 const previous={address:'a',price:1,priceAt:10};
 assert.equal(retainValuation({address:'a',price:3,priceAt:30},previous).price,3);
 assert.equal(retainValuation({address:'b',price:4},previous).price,4);
 assert.equal(retainValuation({address:'a',price:5},{address:'a',price:1}).price,5);
});
