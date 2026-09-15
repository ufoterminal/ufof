import test from 'node:test';
import assert from 'node:assert/strict';
import {executionValuation} from '../src/execution-valuation.js';
test('primary execution prices FDV and MC from the same verified supply reading',()=>{
 const result=executionValuation({pool:'main',totalSupply:1000,circulating:900,price:1,marketCap:900},{pool:'MAIN',at:100,price:2},110);
 assert.equal(result.price,2);assert.equal(result.marketCap,1800);assert.equal(result.fdv,2000);
});
test('unknown supply never preserves an inconsistent old valuation',()=>{
 const result=executionValuation({pool:'main',marketCap:900},{pool:'main',at:100,price:2},110);
 assert.equal(result.marketCap,null);assert.equal(result.fdv,null);
});
test('secondary pools, older execution packets and future trades cannot price the live market',()=>{
 const market={pool:'main',price:1,priceAt:50};
 for(const trade of [{pool:'other',at:100,price:999},{pool:'main',at:1,price:2},{pool:'main',at:999,price:2}])assert.equal(executionValuation(market,trade,300),market);
});
test('inactive primary pool keeps its last verified price beyond three minutes',()=>{
 const market={pool:'main',price:1,totalSupply:1000,circulating:900};
 assert.equal(executionValuation(market,{pool:'main',price:2,at:100},10000).price,2);
});
