import test from 'node:test';
import assert from 'node:assert/strict';
import {updateSeries,tradeKey} from '../public/live-ui.js';
function series(){return {sets:[],updates:[],setData(r){this.sets.push(r);},update(r){this.updates.push(r);}};}
test('unchanged history draws once; only a changed head is updated',()=>{
 const s=series(),rows=[{time:1,close:2},{time:2,close:3}];
 updateSeries(s,rows);updateSeries(s,rows);assert.equal(s.sets.length,1);assert.equal(s.updates.length,0);
 updateSeries(s,[rows[0],{time:2,close:4},{time:3,close:5}]);
 assert.equal(s.sets.length,1);assert.deepEqual(s.updates.map(r=>r.time),[2,3]);
});
test('history corrections and timeframe switches rebuild instead of corrupting the head',()=>{
 const s=series();updateSeries(s,[{time:1,close:1},{time:2,close:2}]);
 updateSeries(s,[{time:1,close:3},{time:2,close:2}]);assert.equal(s.sets.length,2);
 updateSeries(s,[{time:5,close:9}],true);assert.equal(s.sets.length,3);
});
test('multiple logs in one transaction remain distinct',()=>{
 assert.notEqual(tradeKey({tx:'tx',logIndex:1}),tradeKey({tx:'tx',logIndex:2}));
 assert.equal(tradeKey({id:'a'}),tradeKey({id:'a'}));
});
