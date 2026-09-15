// Read-only upstream check in an isolated in-memory database; never opens production data.
process.env.DATA_DIR='memory://';delete process.env.DATABASE_URL;
const timeout=setTimeout(()=>{console.error('Live validation exceeded 30 seconds');process.exit(1);},30000);
try{
 const {init,q}=await import('../src/db.js');
 const {buildMarket}=await import('../src/market-service.js');
 await init();
 const address='0x384c60f98ecd4c26345499345c03d677e40f115e';
 await q('INSERT INTO tokens(address,name,symbol,decimals,total_supply,metadata) VALUES($1,$2,$3,18,$4,$5::jsonb)',[address,'WARP','WARP','1000000000000000000000000000',JSON.stringify({feed_schema:2,source:'circlewarp',index_pool:'0x507a494fde26960cb36d50912cab83c71ecc7ea7'})]);
 const d=await buildMarket(address,'1m');
 const closes=Object.fromEntries(Object.entries(d.frameCandles||{}).map(([k,v])=>[k,v.at(-1)?.close]));
 console.log(JSON.stringify({pool:d.market.pool,price:d.market.price,candles:d.candles.length,history:d.history,closes},null,2));
 if(Object.keys(closes).length!==6||new Set(Object.values(closes)).size!==1)throw Error('Six-frame live-source consistency not verified');
 if(d.market.price!==closes['1m'])throw Error('Displayed price differs from the last execution');
 clearTimeout(timeout);process.exit(0);
}catch(e){console.error(e.message);clearTimeout(timeout);process.exit(1);}
