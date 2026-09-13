// What a wallet holds, and what the site refuses to guess about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeHoldings,isAddress} from '../src/wallet.js';

const A='0x'+'a'.repeat(40), B='0x'+'b'.repeat(40), C='0x'+'c'.repeat(40);
const prices=new Map([[A,{symbol:'AAA',name:'Alpha',price:2,logo:'https://example.com/a.png',source:'tolly'}]]);
const item=(address,qty,dec,extra={})=>({TokenAddress:address,TokenQuantity:qty,TokenDivisor:dec,TokenSymbol:extra.symbol,TokenName:extra.name});

test('balances are scaled by the token\u2019s own decimals and valued at our price',()=>{
 const [row]=shapeHoldings([item(A,'2500000000000000000','18')],prices);
 assert.equal(row.balance,2.5);
 assert.equal(row.price,2);
 assert.equal(row.value,5);
 assert.equal(row.symbol,'AAA');
 assert.equal(row.listed,true);
});

test('a holding we cannot price keeps its balance and no value',()=>{
 const [row]=shapeHoldings([item(B,'1000000','6',{symbol:'BBB'})],prices);
 assert.equal(row.balance,1);
 assert.equal(row.price,null);
 assert.equal(row.value,null,'no price means no value, not a zero');
 assert.equal(row.listed,false);
});

test('empty and unusable entries are left out',()=>{
 assert.deepEqual(shapeHoldings([item(C,'0','18')],prices),[],'a zero balance is not a holding');
 assert.deepEqual(shapeHoldings([{TokenAddress:'not-an-address',TokenQuantity:'5',TokenDivisor:'18'}],prices),[]);
 assert.deepEqual(shapeHoldings(null,prices),[]);
});

test('the most valuable holdings come first, unpriced ones after',()=>{
 const rows=shapeHoldings([item(B,'9000000000000000000','18'),item(A,'1000000000000000000','18')],prices);
 assert.equal(rows[0].address,A,'valued at $2 it outranks a larger unpriced balance');
 assert.equal(rows[1].address,B);
});

test('only a real address is accepted',()=>{
 assert.equal(isAddress(A),true);
 assert.equal(isAddress('0x123'),false);
 assert.equal(isAddress(''),false);
});

test('a holding carries what it did today and how much of the wallet it is',async()=>{
 const {walletHoldings}=await import('../src/wallet.js');
 const A='0x'+'a'.repeat(40);
 const prices=new Map([[A,{symbol:'AAA',price:2,changes:{'24h':12.5},marketCap:1000,liquidity:50}]]);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({status:'1',result:[{TokenAddress:A,TokenQuantity:'3000000000000000000',TokenDivisor:'18',TokenSymbol:'AAA'}]})});
 try{
  const d=await walletHoldings('0x'+'1'.repeat(40),prices);
  const [row]=d.tokens;
  assert.equal(row.value,6);
  assert.equal(row.change24h,12.5,'the day\u2019s move comes from the same row the list shows');
  assert.equal(row.marketCap,1000);
  assert.ok(row.share>0&&row.share<=100,'its share of the wallet is a share, not a raw value');
  assert.equal(d.totals.inTokens,6);
  assert.ok(d.totals.valued>=6,'the total counts USDC alongside the tokens');
 }finally{globalThis.fetch=original;}
});
