import test from 'node:test';
import assert from 'node:assert/strict';
process.env.RPC_HTTP='https://rpc.test';
test('live head reads one bounded window, not the historical backfill windows',async()=>{
 const original=globalThis.fetch,queries=[];
 globalThis.fetch=async(_url,options)=>{
  const request=JSON.parse(options.body);let result;
  if(request.method==='eth_blockNumber')result='0xf4240';
  else if(request.method==='eth_chainId')result='0x13b2';
  else if(request.method==='eth_call')result='0x'+(18).toString(16).padStart(64,'0');
  else if(request.method==='eth_getLogs'){queries.push(request.params[0]);result=[];}
  else if(request.method==='eth_getBlockByNumber')result={hash:'0x'+'1'.repeat(64),number:request.params[0],timestamp:'0x6553f100',transactions:[]};
  else throw Error('Unexpected RPC '+request.method);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
 };
 try{
  const {poolHistory}=await import('../src/rpc-history.js');
  const result=await poolHistory('0x6d4ac8738dc285b4a7e03848f4c1a95d54d9785f','0x7c6912d8fffd8f606c70b1bfef8abea111624df04d836f603319c9db9af50f24',{},
   {version:'v4',feeTier:2500,tickSpacing:25,hooks:'0x'+'0'.repeat(40),quoteToken:'0x3600000000000000000000000000000000000000',nativeQuote:true},{headOnly:true});
  assert.equal(queries.length,1);
  assert.equal(Number(BigInt(queries[0].toBlock)-BigInt(queries[0].fromBlock)+1n),2048);
  assert.equal(result.state.head,1000000-12);
 }finally{globalThis.fetch=original;}
});
