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

// Nothing here may outlast the page waiting on it. Both sources sit behind endpoints that can hang for
// their full timeout, and the two reads used to run one after the other, so a slow explorer and a slow
// RPC added up into a wallet page that took most of a minute to say anything at all.
const before=(promise,ms)=>{
 let timer;
 return Promise.race([promise.finally(()=>clearTimeout(timer)),
  new Promise(resolve=>{timer=setTimeout(()=>resolve(undefined),ms);})]);
};

// Arc's gas token is USDC. It has a 6 decimal ERC-20 view and an 18 decimal native balance, one balance
// seen two ways, so it is read once from the chain and reported in whole USDC. Arc's public endpoints
// refuse calls often enough that a single attempt dropped the USDC row from wallets that do hold some.
export async function nativeBalance(address,budget=7000){
 const until=Date.now()+budget;
 for(let attempt=0;attempt<2;attempt++){
  const wei=await before(rpc().getBalance({address}).catch(()=>null),Math.max(0,until-Date.now()));
  if(wei!=null)return Number(wei)/1e18;
  if(Date.now()>=until)break;
  if(!attempt)await new Promise(r=>setTimeout(r,300));
 }
 return null;
}

// The explorer is the only thing that knows which tokens an address holds: finding them from the chain
// alone would mean scanning every token's transfers. So one refusal must not read as an empty wallet.
// It is asked again before giving up, and its last good answer is kept to serve while it is down.
const balancesRead=p=>p?.status==='1'||Array.isArray(p?.result);
const lastBalances=new Map();
const KEEP_BALANCES_MS=600000;
async function readBalances(wallet,budget=13000){
 const url=EXPLORER+'addresstokenbalance&address='+wallet;
 const until=Date.now()+budget;
 let reason='no balances returned';
 for(let attempt=0;attempt<3;attempt++){
  try{
   const payload=await before(cachedJson(url,60000,balancesRead),Math.max(0,until-Date.now()));
   if(payload===undefined)return {reason:'explorer did not answer in time'};
   if(balancesRead(payload))return {result:Array.isArray(payload.result)?payload.result:[]};
   reason=String(payload?.result||payload?.message||reason);
  }catch(e){reason=e.message;}
  // Retrying only pays while the refusals come back quickly, which is how this endpoint fails.
  if(Date.now()>=until)break;
  if(attempt<2)await new Promise(r=>setTimeout(r,400*(attempt+1)));
 }
 return {reason};
}

// The market rows are looked up for the addresses actually held, rather than taken from the top of the
// list: the list answers in pages, so pricing a wallet from it left everything past the first page with no
// price and no logo, however ordinary the holding was.
export async function walletHoldings(address,lookup){
 const wallet=String(address||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(wallet))throw Error('Invalid wallet address');
 const errors={};
 // The token list and the gas balance come from different places and neither needs the other.
 const [read,usdc]=await Promise.all([readBalances(wallet),nativeBalance(wallet).catch(()=>null)]);
 let balances=read.result,stale=false;
 if(balances){
  if(lastBalances.size>=500)lastBalances.delete(lastBalances.keys().next().value);
  lastBalances.set(wallet,{result:balances,at:Date.now()});
 }else{
  errors.tokens=read.reason;
  const kept=lastBalances.get(wallet);
  if(kept&&Date.now()-kept.at<KEEP_BALANCES_MS){balances=kept.result;stale=true;}
 }
 let tokens=[];
 if(balances?.length){
  const held=shapeHoldings(balances,new Map());
  const prices=typeof lookup==='function'
   ?await lookup(held.map(t=>t.address)).catch(()=>new Map())
   :(lookup instanceof Map?lookup:new Map());
  tokens=shapeHoldings(balances,prices);
 }
 const valued=tokens.reduce((a,t)=>a+(t.value||0),0);
 const total=valued+(usdc||0);
 // Each holding's share of what we can value. A holding we cannot price has no share rather than a zero.
 const withShare=tokens.map(t=>({...t,share:t.value==null||!(total>0)?null:t.value/total*100}));
 return {address:wallet,usdc,tokens:withShare,stale,
  totals:{tokens:tokens.length,valued:total,inTokens:valued,inUsdc:usdc||0,
   usdcShare:total>0?(usdc||0)/total*100:null,unpriced:tokens.filter(t=>t.value==null).length},
  errors:Object.keys(errors).length?errors:undefined};
}

export const isAddress=value=>/^0x[0-9a-f]{40}$/.test(String(value||'').toLowerCase());
export {USDC};
