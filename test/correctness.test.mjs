import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRadar} from '../src/providers.js';
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
});
