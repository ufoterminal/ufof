import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRadar,normalizeDyor} from '../src/providers.js';
import {pool} from '../src/db.js';
test.after(async()=>{await pool.end()});
const a='0x'+'a'.repeat(40);
test('provider timestamps normalize milliseconds and ISO to Unix seconds',()=>{
 const r=normalizeRadar({launches:[{token:a,createdAt:'2026-01-01T00:00:00Z'}]},{tokens:[{address:a,launched:true}]},100);
 assert.equal(r[0].creation_at,1767225600);
});
test('Radar market data cannot invent a token outside the launch registry',()=>{
 const r=normalizeRadar({launches:[{token:a}]},{tokens:[{address:'0x'+'b'.repeat(40),price:99}]},100);
 assert.equal(r.length,0);
});
test('DYOR requires Arc chain 5042',()=>{
 assert.throws(()=>normalizeDyor({chainId:4663,items:[]}));
 const [row]=normalizeDyor({chainId:5042,chain:'arc',items:[{token:a,name:'Live',symbol:'LIVE',created_at:1700000000000,marketCapEth:'9100000000',liquidityEth:'1000000',volume24hWei:'2500000',lastTradeAt:1700000001000}]});
 assert.equal(row.metadata.source,'dyor');assert.equal(row.metadata.mcap,9100);assert.equal(row.metadata.liquidity,1);assert.equal(row.metadata.volume24h,2.5);assert.equal(row.metadata.price,.0000091);assert.equal(row.metadata.token_created_at,1700000000);
});
