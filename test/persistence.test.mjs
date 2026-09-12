import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_DIR='memory://';
delete process.env.DATABASE_URL;
const {init,q,pool}=await import('../src/db.js');
const {persistRecords}=await import('../src/providers.js');
test('bulk writes merge duplicate catalog records and retain historical market metadata',async()=>{
 try{
  await init();const address='0x'+'d'.repeat(40);
  const base={address,name:'Old token',symbol:'OLD',decimals:null,total_supply:null,launchpad_id:'radardex',factory:null,creation_at:1700000000};
  await persistRecords([{...base,metadata:{feed_schema:2,source:'radardex',price:.0001}},{...base,metadata:{catalog_schema:2}}]);
  let row=(await q('SELECT * FROM tokens WHERE address=$1',[address]))[0];
  assert.equal(row.metadata.price,.0001);assert.equal(row.metadata.catalog_schema,2);
  await persistRecords([{...base,metadata:{catalog_schema:2}}]);
  row=(await q('SELECT * FROM tokens WHERE address=$1',[address]))[0];assert.equal(row.metadata.price,.0001);
  assert.equal((await q('SELECT * FROM launches')).length,1);
  await persistRecords([{...base,launchpad_id:'uniswap',metadata:{feed_schema:2,source:'uniswap',dex_fallback:true,price:999,venues:['uniswap-v4'],versions:['v4'],chart_provider:'indexed-market'}}]);
  row=(await q('SELECT * FROM tokens WHERE address=$1',[address]))[0];
  assert.equal(row.metadata.source,'radardex');assert.equal(row.metadata.price,.0001);assert.ok(row.metadata.venues.includes('uniswap-v4'));
  assert.equal((await q('SELECT launchpad_id FROM launches WHERE token=$1',[address]))[0].launchpad_id,'radardex');
 }finally{await pool.end();}
});
