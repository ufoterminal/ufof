import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_DIR='memory://';delete process.env.DATABASE_URL;
const {init,q,pool}=await import('../src/db.js');
const {requestLive,readLivePacket,claimLive,finishLive}=await import('../src/live-store.js');
const {liveMarket}=await import('../src/live-market.js');
const {getMarket}=await import('../src/market-service.js');
test.after(()=>pool.end());
test('web readers enqueue once without upstream IO; worker leases and last good packets persist',async()=>{
 await init();const token='0x'+'b'.repeat(40);
 await q('INSERT INTO tokens(address,name,symbol) VALUES($1,$2,$3)',[token,'','']);
 const original=globalThis.fetch;let fetches=0;
 globalThis.fetch=()=>{fetches++;throw Error('No upstream from a web reader');};
 try{
  const values=await Promise.all(Array.from({length:30},()=>liveMarket(token)));
  assert.ok(values.every(v=>v.pending));
  await getMarket(token,'1m');await getMarket(token,'1d');assert.equal(fetches,0);
  const jobs=await Promise.all([claimLive(),claimLive()]);assert.equal(jobs.filter(Boolean).length,1);
  const payload={market:{address:token,price:2,marketCap:2000,pool:'main'},trades:[{id:'a',price:2,at:100}],stale:false};
  await finishLive(token,payload,null);
  assert.equal((await readLivePacket(token)).market.price,2);
  assert.equal((await getMarket(token,'5m')).market.price,2);
  assert.equal((await getMarket(token,'1h')).market.marketCap,2000);
  await finishLive(token,null,'RPC unavailable');
  assert.equal((await readLivePacket(token)).market.price,2);
  assert.equal((await readLivePacket(token)).stale,true);
  await requestLive(token);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM live_packets WHERE token=$1',[token]))[0].n,1);
  assert.equal(fetches,0);
 }finally{globalThis.fetch=original;}
});
