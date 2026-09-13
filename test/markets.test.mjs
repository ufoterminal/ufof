import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATA_DIR='memory://';
delete process.env.DATABASE_URL;
import {selectMarkets,mapMarket} from '../src/market-service.js';
const now=1800000000;
const token=(id,extra={})=>({address:'0x'+id.toString(16).padStart(40,'0'),symbol:'TOKEN'+id,name:'Token '+id,source:'tolly',marketData:true,volume:100,price:.001,marketCap:1000,createdAt:now-86400,updatedAt:now,liquidity:200,versions:['v3'],changes:{'24h':2},...extra});
test('a token that has gone quiet stays in the list and in search',()=>{
 const all=[token(1),token(2,{volume:0,lastTradeAt:now-100000,symbol:'OLD'})];
 assert.equal(selectMarkets(all,{},now).total,2,'no archive to fall out of: the default list holds everything');
 assert.equal(selectMarkets(all,{q:'old'},now).rows[0].symbol,'OLD');
 const stats=selectMarkets(all,{},now).stats;
 assert.equal(stats.active,1,'the header totals still count only what traded');
 assert.equal(stats.archived,2,'against everything held');
 assert.equal(selectMarkets(all,{},now).trending.every(r=>r.symbol!=='OLD'),true,'the most active tape stays active');
});
test('exact address and symbol rank before partial matches',()=>{
 const all=[token(1,{symbol:'ABCD',volume:1000}),token(2,{symbol:'ABC',volume:1})];
 assert.equal(selectMarkets(all,{q:'abc'},now).rows[0].symbol,'ABC');
 assert.equal(selectMarkets(all,{q:all[0].address.toUpperCase()},now).total,1);
});
test('filters run before pagination and unknown numbers sort last',()=>{
 const all=Array.from({length:40},(_,i)=>token(i,{source:i%2?'sharc':'tolly',volume:i,price:i===0?null:i}));
 const d=selectMarkets(all,{mode:'all',source:'tolly',limit:10,page:2,sort:'price',dir:'asc'},now);
 assert.equal(d.total,20);assert.equal(d.pages,2);assert.equal(d.rows.length,10);
 assert.equal(d.rows.at(-1).price,null);assert.ok(d.rows.every(t=>t.source==='tolly'));
});
test('watchlist includes inactive tokens but respects source filters',()=>{
 const all=[token(1,{volume:0}),token(2,{source:'sharc'})];
 const d=selectMarkets(all,{mode:'watch',source:'tolly',addresses:all.map(t=>t.address).join(',')},now);
 assert.equal(d.total,1);assert.equal(d.rows[0].address,all[0].address);
});
test('missing liquidity is not zero or eligible for a positive minimum',()=>{
 assert.equal(selectMarkets([token(1,{liquidity:null})],{minLiquidity:1},now).total,0);
 assert.equal(selectMarkets([token(1,{liquidity:null})],{},now).stats.liquidity,null);
});
test('old imported prices and timestamps are not verified feed data',()=>{
 const t=mapMarket({address:token(1).address,creation_at:Math.floor(Date.now()/1000),metadata:{source:'radardex',price:50,volume24h:500}});
 assert.equal(t.marketData,false);assert.equal(t.price,null);assert.equal(t.createdAt,null);
});
test('creation time comes from source, never discovery time',()=>{
 const created=1700000000;
 const t=mapMarket({address:token(1).address,creation_at:Math.floor(Date.now()/1000),metadata:{feed_schema:2,source:'tolly',token_created_at:created,price:0.00001}});
 assert.equal(t.createdAt,created);assert.equal(t.price,0.00001);assert.equal(t.marketData,true);
});

// The OG mark: the oldest contract under a ticker, and only when there is an outright oldest.
test('only an outright earliest contract under a ticker is the original',async()=>{
 const {isOriginalTicker}=await import('../src/market-service.js');
 const {init,q}=await import('../src/db.js');
 await init();
 const at=1_780_000_000;
 const rows=[['0x'+'1'.repeat(40),'OGT',at],['0x'+'2'.repeat(40),'OGT',at+500],['0x'+'3'.repeat(40),'TIE',at],['0x'+'4'.repeat(40),'TIE',at]];
 for(const [address,symbol,created] of rows){
  await q(`INSERT INTO tokens(address,name,symbol,decimals,metadata) VALUES($1,$2,$2,18,$3::jsonb)
   ON CONFLICT(address) DO UPDATE SET symbol=excluded.symbol,metadata=excluded.metadata`,
   [address,symbol,JSON.stringify({feed_schema:2,token_created_at:created})]);
 }
 assert.equal(await isOriginalTicker('0x'+'1'.repeat(40),'OGT'),true,'the earliest contract carries the mark');
 assert.equal(await isOriginalTicker('0x'+'2'.repeat(40),'OGT'),false,'a later one does not');
 assert.equal(await isOriginalTicker('0x'+'1'.repeat(40),'ogt'),true,'the ticker match ignores case');
 assert.equal(await isOriginalTicker('0x'+'3'.repeat(40),'TIE'),false,'a shared earliest second is nobody\u2019s first');
 assert.equal(await isOriginalTicker('0x'+'9'.repeat(40),''),false,'no symbol, no mark');
});

test('a stored snapshot shows the current price, not the one its timeframe was built with',async()=>{
 const {withLiveFigures}=await import('../src/market-service.js');
 const stored={address:'0x'+'7'.repeat(40),symbol:'TF',price:0.0025566,marketCap:2400000,name:'Old',source:'tolly'};
 const row={address:'0x'+'7'.repeat(40),symbol:'TF',name:'Old',launchpad_id:'tolly',
  metadata:{feed_schema:2,source:'tolly',price:0.00257668,mcap:2480000,liquidity:1000,volume24h:5,holders:9}};
 const merged=withLiveFigures(stored,row);
 assert.equal(merged.price,0.00257668,'every timeframe reports the same, current price');
 assert.equal(merged.marketCap,2480000,'so the market cap scale agrees with it');
 assert.equal(merged.name,'Old','what the snapshot holds of itself is left alone');
 assert.equal(withLiveFigures(null,row),null);
});

test('a source that never answers cannot hold up the whole sync',async()=>{
 const started=Date.now();
 const stuck=new Promise(()=>{});   // never settles, like a request that is accepted and then ignored
 const {withDeadline}=await import('../src/providers.js');
 await assert.rejects(()=>withDeadline(stuck,'slowpad',150),/slowpad took longer than/);
 assert.ok(Date.now()-started<2000,'it gives up quickly rather than waiting on the source');
 assert.equal(await withDeadline(Promise.resolve('done'),'fastpad',150),'done','a source that answers is untouched');
});

test('a search puts the biggest market first, but an exact match still leads',()=>{
 const mk=(id,symbol,mcap,volume)=>token(id,{symbol,marketCap:mcap,volume});
 const all=[mk(1,'ARC',500,900),mk(2,'ARC',9000,10),mk(3,'ARCADE',50000,5000)];
 const rows=selectMarkets(all,{q:'arc'},now).rows;
 assert.deepEqual(rows.map(r=>r.marketCap),[9000,500,50000],'exact ticker matches lead, ordered by market cap');
 const exact=selectMarkets(all,{q:all[0].address},now).rows;
 assert.equal(exact[0].address,all[0].address,'an address match still comes first whatever it is worth');
});
