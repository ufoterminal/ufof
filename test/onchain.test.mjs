// The on-chain engine decides what is listed and what the numbers are, so these check the parts that
// could quietly go wrong: which pools count, how a swap is read, and when a total may call itself a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSwap,poolFromLog,priceAt,venueOf} from '../src/onchain.js';
test('a pair records its factory, and only a known factory names the exchange',()=>{
 const token='0x'+'b'.repeat(40),dyor='0x942bd5bfdc5317c5507e326f8eb4bb6058ab5c10';
 const pair={address:'0x942BD5BFDC5317C5507E326F8EB4BB6058AB5C10',args:{token0:token,token1:'0x3600000000000000000000000000000000000000',pair:'0x'+'a'.repeat(40),length:1n},blockNumber:5n,blockTimestamp:'0x64000000'};
 assert.equal(poolFromLog(pair).factory,dyor,'stored lower case, as every other address is');
 assert.equal(venueOf('v2',dyor),'dyorswap-v2');
 assert.equal(venueOf('v2','0x'+'9'.repeat(40)),null,'an unknown v2 factory is not credited to any exchange');
 assert.equal(venueOf('v2',null),null);assert.equal(venueOf('v2','unknown'),null);
 assert.equal(venueOf('v3',null),'uniswap-v3');assert.equal(venueOf('v4','anything'),'uniswap-v4');
});
import {USDC} from '../src/config.js';

const pool={pool:'0x'+'a'.repeat(40),token:'0x'+'b'.repeat(40),token_is_token0:true,version:'v3'};
// A price of 1e-6 USDC per token with 18 decimal token and 6 decimal quote.
const sqrtFor=price=>BigInt(Math.floor(Math.sqrt(price*10**(6-18))*2**96));

test('a pool quoted in a token that trades against USDC is kept with that token as its quote',()=>{
 const token='0x'+'b'.repeat(40),crcl='0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b',long='0x2164bb17a2d38c1b5170e987b2c0416df1efc752';
 const log=(t0,t1)=>({args:{token0:t0,token1:t1,fee:3000,tickSpacing:60,pool:'0x'+'a'.repeat(40)},blockNumber:5n,blockTimestamp:'0x64000000'});
 const bridges=new Set([crcl,long]);
 const row=poolFromLog(log(long,token),bridges);
 assert.equal(row.token,token);assert.equal(row.quote_token,long);assert.equal(row.token_is_token0,false);
 assert.equal(row.quote_decimals,null,'the bridge’s decimals are read when its swaps are decoded');
 assert.equal(poolFromLog(log(long,token)),null,'not a bridge unless it has a USDC market we hold');
 assert.equal(poolFromLog(log(long,crcl),bridges),null,'two bridges: no way to say which side is the market');
 assert.equal(poolFromLog(log(USDC,token),bridges).quote_token,null,'a USDC side still wins');
});

test('a bridge-quoted swap is carried into dollars at the bridge price, or dropped without one',()=>{
 const bridgePool={pool:'0x'+'a'.repeat(40),token:'0x'+'b'.repeat(40),token_is_token0:true,version:'v2',quote_token:'0x'+'c'.repeat(40),quote_token_decimals:18};
 const at={blockNumber:1n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 const buy={args:{amount0In:0n,amount1In:2000000000000000000n,amount0Out:1000000000000000000n,amount1Out:0n,to:'0x'+'c'.repeat(40)},...at};
 const row=decodeSwap(buy,bridgePool,18,3);
 assert.equal(row.usd_volume,6,'two bridge tokens at three dollars');assert.equal(row.price,6);assert.equal(row.buy,true);
 assert.equal(decodeSwap(buy,bridgePool,18),null,'no bridge price, no trade');
 assert.equal(decodeSwap(buy,{...bridgePool,quote_token_decimals:null},18,3),null,'bridge decimals unknown, no trade');
 const v3={args:{amount0:-1000000000000000000n,amount1:2000000000000000000n,sqrtPriceX96:BigInt(Math.floor(Math.sqrt(2)*2**96)),recipient:'0x'+'c'.repeat(40)},...at};
 const r3=decodeSwap(v3,{...bridgePool,version:'v3'},18,3);
 assert.ok(Math.abs(r3.price-6)<1e-6,'two bridge tokens per token at three dollars');assert.equal(r3.usd_volume,6);
});

test('a bridge price is the median of its recent trades, not whichever trade happened last',()=>{
 const spiky=[{at:1000,price:38},{at:1010,price:38.2},{at:1020,price:28.8}];
 assert.equal(priceAt(spiky,1030),38,'one outlying last trade does not reprice everything quoted in the bridge');
 assert.equal(priceAt([{at:1000,price:1},{at:1500,price:9}],1200),1,'a trade after the swap is not used to price it');
 assert.equal(priceAt([{at:0,price:5},{at:3000,price:7}],3000),7,'only the quarter hour before counts toward the median');
 assert.equal(priceAt([{at:0,price:5}],3000),5,'no trade in the quarter hour: the last one inside the hour');
 assert.equal(priceAt([{at:0,price:5}],3601),null,'an hour-old bridge price is too old');
 assert.equal(priceAt([{at:100,price:2}],50),null,'nothing before the trade');
 assert.equal(priceAt([],100),null);assert.equal(priceAt(undefined,100),null);
});

test('a v3 swap is read with the right side and size',()=>{
 const log={args:{amount0:-1000000000000000000n,amount1:2000000n,sqrtPriceX96:sqrtFor(0.000002),recipient:'0x'+'c'.repeat(40)},
  blockNumber:10n,logIndex:2,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 const row=decodeSwap(log,pool,18);
 assert.equal(row.usd_volume,2,'2 USDC moved');
 assert.equal(row.buy,true,'quote going into the pool is a buy on v3');
 assert.ok(row.price>0&&Number.isFinite(row.price));
 assert.equal(row.token,pool.token);
 assert.equal(row.at,Number(BigInt('0x64000000')));
});

test('the v4 sign convention is the opposite of v3',()=>{
 const base={amount0:-1000000000000000000n,amount1:2000000n,sqrtPriceX96:sqrtFor(0.000002)};
 const v4={args:{...base,id:'0x'+'e'.repeat(64)},blockNumber:10n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 const v3={args:{...base,recipient:'0x'+'c'.repeat(40)},blockNumber:10n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 assert.equal(decodeSwap(v3,pool,18).buy,true);
 assert.equal(decodeSwap({...v4},{...pool,version:'v4'},18).buy,false,'the same amounts are a sell on v4');
});

test('a swap with a zero leg or an unusable price is dropped, not rounded into existence',()=>{
 const at={blockNumber:1n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 assert.equal(decodeSwap({args:{amount0:0n,amount1:2000000n,sqrtPriceX96:sqrtFor(0.000002)},...at},pool,18),null);
 assert.equal(decodeSwap({args:{amount0:-1n,amount1:0n,sqrtPriceX96:sqrtFor(0.000002)},...at},pool,18),null);
 assert.equal(decodeSwap({args:{amount0:-1000000000000000000n,amount1:2000000n,sqrtPriceX96:0n},...at},pool,18),null);
});

test('the quote side is read from the pool, not assumed to be token0',()=>{
 const log={args:{amount0:2000000n,amount1:-1000000000000000000n,sqrtPriceX96:sqrtFor(0.000002),recipient:null},
  blockNumber:1n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 const row=decodeSwap(log,{...pool,token_is_token0:false},18);
 assert.equal(row.usd_volume,2,'USDC is amount0 when the token is token1');
});

test('a v2 pair reports four unsigned amounts and prices the trade from what it paid',()=>{
 const at={blockNumber:1n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 const buy={args:{amount0In:0n,amount1In:2000000n,amount0Out:1000000000000000000n,amount1Out:0n,to:'0x'+'c'.repeat(40)},...at};
 const row=decodeSwap(buy,{...pool,version:'v2'},18);
 assert.equal(row.usd_volume,2,'2 USDC in');
 assert.equal(row.price,2,'2 USDC for one whole token');
 assert.equal(row.buy,true);
 const sell={args:{amount0In:1000000000000000000n,amount1In:0n,amount0Out:0n,amount1Out:2000000n,to:'0x'+'c'.repeat(40)},...at};
 assert.equal(decodeSwap(sell,{...pool,version:'v2'},18).buy,false,'USDC leaving the pair is a sell');
});

test('a v4 pool against Arc’s native gas token is listed as a USDC market at 18 decimals',()=>{
 const token='0x'+'b'.repeat(40),zero='0x'+'0'.repeat(40),other='0x'+'1'.repeat(40);
 const at={blockNumber:5n,blockTimestamp:'0x64000000'};
 const native={args:{id:'0x'+'e'.repeat(64),currency0:zero,currency1:token,fee:3000,tickSpacing:60,hooks:zero},...at};
 const row=poolFromLog(native);
 assert.equal(row.token,token);assert.equal(row.version,'v4');
 assert.equal(row.quote_decimals,18);assert.equal(row.token_is_token0,false,'the zero address always sorts first');
 assert.equal(poolFromLog({...native,args:{...native.args,currency0:USDC,currency1:token}}).quote_decimals,6,'the ERC-20 stays at six');
 assert.equal(poolFromLog({...native,args:{...native.args,currency0:zero,currency1:USDC}}),null,'native against USDC is not a token market');
 assert.equal(poolFromLog({args:{token0:zero,token1:token,fee:3000,tickSpacing:60,pool:'0x'+'a'.repeat(40)},...at}),null,'the zero address means native only on v4');
 assert.equal(poolFromLog({args:{token0:other,token1:token,fee:3000,tickSpacing:60,pool:'0x'+'a'.repeat(40)},...at}),null,'no USDC side, no dollar price');
});

test('a swap against native USDC is sized and priced at 18 decimals',()=>{
 const pool={pool:'0x'+'e'.repeat(64),token:'0x'+'b'.repeat(40),token_is_token0:false,version:'v4',quote_decimals:18};
 const log={args:{id:pool.pool,amount0:-2000000000000000000n,amount1:1000000000000000000n,sqrtPriceX96:BigInt(Math.floor(Math.sqrt(0.5)*2**96))},
  blockNumber:6n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)};
 const row=decodeSwap(log,pool,18);
 assert.equal(row.usd_volume,2,'two dollars, not two trillion');
 assert.ok(Math.abs(row.price-2)<1e-6,'two dollars a token');
 assert.equal(decodeSwap({args:{amount0:-1000000000000000000n,amount1:2000000n,sqrtPriceX96:sqrtFor(0.000002)},blockNumber:1n,logIndex:0,blockTimestamp:'0x64000000',transactionHash:'0x'+'d'.repeat(64)},{pool:'0x'+'a'.repeat(40),token:'0x'+'b'.repeat(40),token_is_token0:true,version:'v3',quote_decimals:null},18).usd_volume,2,'a pool stored before the column existed still reads as six decimals');
});

// Coverage rule: a 24 hour total may only be published when the tape really covers it, or when the token
// is younger than the tape and every trade it ever had is therefore in hand.
const whole=(coverage,created,now)=>coverage!=null&&(coverage<=now-86400||(created!=null&&created>=coverage));

test('totals wait until the tape can back them up',()=>{
 const now=1_800_000_000;
 assert.equal(whole(null,now-3600,now),false,'no tape, no totals');
 assert.equal(whole(now-3600,now-7200,now),false,'token older than a six hour tape');
 assert.equal(whole(now-3600,now-1800,now),true,'token younger than the tape: we hold all of its trades');
 assert.equal(whole(now-90000,now-500000,now),true,'tape older than a day covers any token');
});

// Holder labels: a market and a burn address must not read as ordinary wallets.
import {labelPools} from '../src/holders.js';
test('pools and burn addresses are named in a holder list',()=>{
 const dead='0x000000000000000000000000000000000000dead', zero='0x'+'0'.repeat(40);
 const poolAddress='0x'+'a'.repeat(40), wallet='0x'+'b'.repeat(40);
 const rows=labelPools([{address:dead},{address:zero},{address:poolAddress},{address:wallet}],[{address:poolAddress,label:'Pool'}]);
 assert.deepEqual(rows.map(r=>r.label),['Burned','Burned','Pool',null]);
});
test('a label the source already supplied is kept',()=>{
 const [row]=labelPools([{address:'0x'+'c'.repeat(40),label:'Treasury'}],[]);
 assert.equal(row.label,'Treasury');
});
