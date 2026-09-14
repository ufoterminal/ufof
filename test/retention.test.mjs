// Nothing is removed before it has been summarised, and nothing is removed at all unless asked.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_DIR='memory://';
delete process.env.DATABASE_URL;
const {init,q}=await import('../src/db.js');
const {pruneTrades,summariseDays,runRetention,settings}=await import('../src/retention.js');

const token='0x'+'a'.repeat(40), pool='0x'+'b'.repeat(40);
const day=86400, now=Math.floor(Date.now()/1000);
const old=now-40*day;

async function seed(){
 await init();
 await q(`CREATE TABLE IF NOT EXISTS onchain_trades(pool TEXT,block BIGINT,log_index INTEGER,token TEXT,
  at BIGINT,price NUMERIC,usd_volume NUMERIC,buy BOOLEAN,trader TEXT,tx TEXT,PRIMARY KEY(pool,block,log_index))`);
 await q('DELETE FROM onchain_trades');await q('DELETE FROM trade_daily').catch(()=>null);
 const rows=[];
 for(let i=0;i<8;i++)rows.push([pool,100+i,i,token,old+i*60,1+i,10,i%2===0,'0x'+'c'.repeat(40),'0x'+'d'.repeat(64)]);
 rows.push([pool,900,0,token,now-60,99,5,true,'0x'+'e'.repeat(40),'0x'+'f'.repeat(64)]);
 for(const r of rows)await q(`INSERT INTO onchain_trades(pool,block,log_index,token,at,price,usd_volume,buy,trader,tx)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,r);
}

test('a day of trading becomes one row with its open, high, low and close',async()=>{
 await seed();
 const days=await summariseDays(now-day);
 assert.ok(days>=1);
 const [row]=await q('SELECT * FROM trade_daily WHERE token=$1',[token]);
 assert.equal(Number(row.open),1,'the first trade of the day opens it');
 assert.equal(Number(row.close),8,'the last one closes it');
 assert.equal(Number(row.high),8);
 assert.equal(Number(row.low),1);
 assert.equal(Number(row.txns),8);
 assert.equal(Number(row.usd_volume),80);
});

test('raw trades are only dropped once summarised, and recent ones are always kept',async()=>{
 await seed();
 const result=await pruneTrades({keepPerToken:2,keepHours:24});
 assert.ok(result.summarised>=1,'the day is summarised before anything is removed');
 const left=await q('SELECT at FROM onchain_trades WHERE token=$1 ORDER BY at DESC',[token]);
 assert.equal(left.length,2,'the most recent trades stay whatever their age');
 assert.ok(Number(left[0].at)>=now-3600,'including today\u2019s');
 const [kept]=await q('SELECT txns FROM trade_daily WHERE token=$1',[token]);
 assert.equal(Number(kept.txns),8,'and the day it removed is still counted');
});

test('nothing happens unless it is switched on',async()=>{
 await seed();
 delete process.env.RETENTION_ENABLED;
 assert.equal(settings().enabled,false);
 assert.deepEqual(await runRetention(),{enabled:false});
 const left=await q('SELECT 1 FROM onchain_trades WHERE token=$1',[token]);
 assert.equal(left.length,9,'every trade is still there');
});
