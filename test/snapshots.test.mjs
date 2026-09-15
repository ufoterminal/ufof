import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_DIR='memory://';delete process.env.DATABASE_URL;
const {init,pool,q}=await import('../src/db.js');
const {requestSnapshot,readSnapshot,publishSnapshot,publishFrameSet,claimJob,finishJob}=await import('../src/snapshots.js');
const {getMarket}=await import('../src/market-service.js');
test.after(()=>pool.end());
test('all six frames publish one generation from one tape without storing duplicate bundles',async()=>{
 await init();const token='0x'+'c'.repeat(40);
 const frameCandles=Object.fromEntries(['1m','5m','15m','1h','4h','1d'].map(tf=>[tf,[{bucket:86400,open:1,high:2,low:1,close:2,volume:5}]]));
 await publishFrameSet(token,'1m',{market:{address:token,price:2},frameCandles});
 const rows=await Promise.all(Object.keys(frameCandles).map(tf=>readSnapshot(token,tf)));
 assert.equal(new Set(rows.map(r=>r.updated)).size,1);
 assert.equal(new Set(rows.map(r=>r.payload.generation)).size,1);
 assert.ok(rows.every(r=>r.payload.candles.at(-1).close===2&&!r.payload.frameCandles));
 await assert.rejects(publishFrameSet(token,'1m',{frameCandles:{'1m':frameCandles['1m']}}));
 assert.equal((await readSnapshot(token,'1d')).payload.candles.at(-1).close,2);
});
test('snapshot requests never fetch upstream; queue is persistent and failed refresh retains candles',async()=>{
 await init();const token='0x'+'a'.repeat(40);
 await q('INSERT INTO tokens(address,name,symbol) VALUES($1,$2,$3)',[token,'Test','TEST']);
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('API must not fetch upstream');};
 try{
  const pending=await getMarket(token,'1m');assert.equal(pending.cache.pending,true);
  const job=await claimJob();assert.equal(job.token,token);assert.equal(job.tf,'1m','the frame being looked at is prepared first');
 // Opening a token also queues its other frames behind it, so switching timeframe is a read, not a build.
 const next=await claimJob();
 assert.equal(next?.token,token);assert.notEqual(next?.tf,'1m');
  const payload={market:{address:token,price:2},candles:[{bucket:60,open:2,high:2,low:2,close:2,volume:1}],trades:[]};
  await publishSnapshot(token,'1m',payload);await finishJob(job,null);
  assert.equal((await getMarket(token,'1m')).market.price,2);
  await assert.rejects(()=>publishSnapshot(token,'1m',{candles:[]}));
  assert.equal((await readSnapshot(token,'1m')).payload.candles.length,1);
  // Asking again for a frame that is already queued does not duplicate it: one job per token and frame.
  await requestSnapshot(token,'1m',10);
  const {q:query}=await import('../src/db.js');
  const [{count}]=await query("SELECT COUNT(*)::int AS count FROM market_jobs_v3 WHERE token=$1 AND tf='1m'",[token]);
  assert.equal(count,1);
 }finally{globalThis.fetch=original;}
});
