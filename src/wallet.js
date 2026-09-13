// What a wallet holds on Arc.
//
// The chain explorer indexes balances for every address, which is the one thing we cannot reproduce
// cheaply: finding a wallet's tokens from the chain alone would mean scanning every token's transfers.
// The native USDC balance is read straight from the chain, because that is a single call and the chain is
// the authority on it.
//
// Prices come from our own market list, so a holding is valued the same way the rest of the site values
// it. A token we do not price is shown with its balance and no value, never with a made-up one.
import {createPublicClient,fallback,http} from 'viem';
import {cachedJson} from './direct.js';
import {RPC_HTTP,USDC} from './config.js';

const EXPLORER='https://api.arc-scan.org/api?module=account&action=';

let client;
const rpc=()=>client??=createPublicClient({transport:fallback(
 RPC_HTTP.map(url=>http(url,{batch:false,timeout:10000,retryCount:0})),
 {rank:{interval:60000,sampleCount:3,timeout:2000}})});

const scale=(raw,decimals)=>{
 const n=Number(raw);
 if(!Number.isFinite(n))return null;
 const d=Number(decimals);
 return n/10**(Number.isFinite(d)?d:18);
};

export function shapeHoldings(result,prices=new Map()){
 if(!Array.isArray(result))return [];
 const rows=[];
 for(const item of result){
  const address=String(item?.TokenAddress||item?.contractAddress||'').toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(address))continue;
  const balance=scale(item.TokenQuantity??item.balance,item.TokenDivisor??item.decimals);
  if(balance==null||balance<=0)continue;
  const market=prices.get(address)||null;
  const price=market&&Number.isFinite(Number(market.price))?Number(market.price):null;
  rows.push({address,
   symbol:String(item.TokenSymbol||market?.symbol||''),
   name:String(item.TokenName||market?.name||''),
   balance,price,
   value:price==null?null:balance*price,
   // What the holding did today and how deep the market is, so a position can be read without opening
   // each token. Taken from the same row the list shows, never computed here.
   change24h:market?.changes?.['24h']??null,
   marketCap:market?.marketCap??null,
   liquidity:market?.liquidity??null,
   logo:market?.logo??null,
   source:market?.source??null,
   listed:!!market});
 }
 // Worth the most first; holdings we cannot price sit after them, by size.
 return rows.sort((a,b)=>(b.value??-1)-(a.value??-1)||b.balance-a.balance);
}

// Arc's gas token is USDC. It has a 6 decimal ERC-20 view and an 18 decimal native balance, one balance
// seen two ways, so it is read once from the chain and reported in whole USDC.
export async function nativeBalance(address){
 const wei=await rpc().getBalance({address}).catch(()=>null);
 return wei==null?null:Number(wei)/1e18;
}

// The market rows are looked up for the addresses actually held, rather than taken from the top of the
// list: the list answers in pages, so pricing a wallet from it left everything past the first page with no
// price and no logo, however ordinary the holding was.
export async function walletHoldings(address,lookup){
 const wallet=String(address||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(wallet))throw Error('Invalid wallet address');
 const errors={};
 let tokens=[];
 try{
  const payload=await cachedJson(EXPLORER+'addresstokenbalance&address='+wallet,60000);
  if(payload?.status==='1'||Array.isArray(payload?.result)){
   const held=shapeHoldings(payload.result,new Map());
   const prices=typeof lookup==='function'
    ?await lookup(held.map(t=>t.address)).catch(()=>new Map())
    :(lookup instanceof Map?lookup:new Map());
   tokens=shapeHoldings(payload.result,prices);
  }
  else errors.tokens=String(payload?.result||'no balances returned');
 }catch(e){errors.tokens=e.message;}
 const usdc=await nativeBalance(wallet).catch(()=>null);
 const valued=tokens.reduce((a,t)=>a+(t.value||0),0);
 const total=valued+(usdc||0);
 // Each holding's share of what we can value. A holding we cannot price has no share rather than a zero.
 const withShare=tokens.map(t=>({...t,share:t.value==null||!(total>0)?null:t.value/total*100}));
 return {address:wallet,usdc,tokens:withShare,
  totals:{tokens:tokens.length,valued:total,inTokens:valued,inUsdc:usdc||0,
   usdcShare:total>0?(usdc||0)/total*100:null,unpriced:tokens.filter(t=>t.value==null).length},
  errors:Object.keys(errors).length?errors:undefined};
}

export const isAddress=value=>/^0x[0-9a-f]{40}$/.test(String(value||'').toLowerCase());
export {USDC};
