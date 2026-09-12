// The on-chain engine decides what is listed and what the numbers are, so these check the parts that
// could quietly go wrong: which pools count, how a swap is read, and when a total may call itself a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSwap} from '../src/onchain.js';
import {USDC} from '../src/config.js';

const pool={pool:'0x'+'a'.repeat(40),token:'0x'+'b'.repeat(40),token_is_token0:true,version:'v3'};
// A price of 1e-6 USDC per token with 18 decimal token and 6 decimal quote.
const sqrtFor=price=>BigInt(Math.floor(Math.sqrt(price*10**(6-18))*2**96));

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
