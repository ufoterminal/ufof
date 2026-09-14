import {q,init,pool} from './src/db.js';
await init();
const now=Math.floor(Date.now()/1000);
const rows=[
 ['0xeb64'+'0'.repeat(32)+'5b37','usdc is cool','COOL',0.00204301,{website:'https://example.com',twitter:'https://x.com/example',telegram:'https://t.me/example'},{burned:37200000,total:1000000000,percent:3.72,deadPercent:3.72,circulating:962800000}],
 ['0xbd'+'1'.repeat(34)+'ab12','Builders with a rather long token name','BUILD',0.00002612,{website:'javascript:alert(1)'},{burned:58420000,total:1000000000,percent:5.84,deadPercent:5.84,circulating:941580000}],
];
for(const [address,name,symbol,price,social,burn] of rows){
 const metadata={feed_schema:2,source:'radardex',price,mcap:price*1e9*0.96,fdv:price*1e9,liquidity:89470,volume24h:143010,
  txns24h:500,buys24h:308,sells24h:192,traders24h:259,holders:1490,changes:{'5m':-1.34,'1h':-3.21,'6h':-16.93,'24h':8.25},
  token_created_at:now-86400*30,last_trade_at:now-60,provider_updated_at:now,pool:'0xcc33333333333333333333333333333333333333',
  ...social,burn_reading:{at:Date.now(),value:burn}};
 await q(`INSERT INTO tokens(address,name,symbol,decimals,total_supply,metadata) VALUES($1,$2,$3,18,$4,$5::jsonb)
  ON CONFLICT(address) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,metadata=excluded.metadata`,
  [address,name,symbol,'1000000000000000000000000000',JSON.stringify(metadata)]);
}
console.log('seeded',(await q('SELECT address,symbol FROM tokens')).map(r=>r.symbol+' '+r.address).join(' | '));
await pool.end();
