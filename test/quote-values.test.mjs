import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichQuoteRows,usdQuoteRow,crossQuote} from '../src/quote-values.js';
const address='0x1111111111111111111111111111111111111111';
const quote='0x2222222222222222222222222222222222222222';
const row={address,quotes:[quote,'USDC'],price:0.00014,mcap:140000,spark:[0.00014]};
test('non-USDC quote uses a coherent USD detail packet, not list units',async()=>{
 const detail={address,price:0.0095,mcap:9500000,fdv:10000000,quoteToken:quote};
 const result=await enrichQuoteRows({tokens:[row]},async()=>detail);
 assert.equal(result.tokens[0].price,0.0095);assert.equal(result.tokens[0].mcap,9500000);
 assert.equal(result.tokens[0].fdv,10000000);assert.deepEqual(result.tokens[0].spark,[]);
 assert.equal(crossQuote({quote_token:result.tokens[0].quoteToken}),true);
});
test('USDC-only rows are unchanged and require no detail request',async()=>{
 const token={...row,quotes:['USDC','0x3600000000000000000000000000000000000000']};
 const result=await enrichQuoteRows({tokens:[token]},()=>{throw Error('Must not call');});
 assert.equal(result.tokens[0],token);
});
test('missing or invalid detail never exposes raw quote as USD',async()=>{
 for(const detail of [null,{address,price:Infinity},{address,price:0},{address:quote,price:10}]){
  const result=usdQuoteRow(row,detail);assert.equal(result.price,null);assert.equal(result.mcap,null);assert.equal(result.fdv,null);assert.equal(result.quotePending,true);
 }
 const result=await enrichQuoteRows({tokens:[row]},async()=>{throw Error('offline');});
 assert.equal(result.tokens[0].price,null);
});
test('enrichment works for arbitrary quote assets without multiplying USD twice',async()=>{
 for(const q of [quote,'WETH','CRCL']){
  const detail={address,price:12,mcap:1200,fdv:1500,quoteToken:q};
  const a=usdQuoteRow({...row,quotes:[q]},detail),b=usdQuoteRow(a,detail);
  assert.equal(b.price,12);assert.equal(b.mcap,1200);
 }
});
test('invalid addresses never reach the provider',async()=>{
 let calls=0;await enrichQuoteRows({tokens:[{...row,address:'../bad'}]},async()=>{calls++;});assert.equal(calls,0);
});
