// Arc ERC-20 holdings. Unpriced and unknown-decimal assets are never hidden.
import {RPC_HTTP,USDC} from './config.js';
import {createWalletReader} from './wallet-reader.js';

export const isAddress=value=>/^0x[0-9a-f]{40}$/.test(String(value||'').toLowerCase());
export {USDC};
export function balanceAmount(raw,decimals){
 const text=String(raw??'');
 if(!/^\d+$/.test(text))return null;
 const units=BigInt(text);if(units===0n)return null;
 const d=decimals==null||decimals===''?null:Number(decimals);
 if(!Number.isInteger(d)||d<0||d>255)return {balance:null,balanceExact:null,balanceRaw:units.toString(),decimals:null};
 const digits=units.toString().padStart(d+1,'0');
 const exact=d?(digits.slice(0,-d)+'.'+digits.slice(-d)).replace(/\.?0+$/,''):digits;
 const value=Number(exact);
 return {balance:Number.isFinite(value)?value:null,balanceExact:exact,balanceRaw:units.toString(),decimals:d};
}
export function shapeHoldings(result,prices=new Map()){
 if(!Array.isArray(result))return [];
 const unique=new Map();
 for(const item of result){
  const address=String(item?.TokenAddress||item?.contractAddress||'').toLowerCase();
  if(isAddress(address)&&address!==USDC.toLowerCase())unique.set(address,item);
 }
 const rows=[];
 for(const [address,item] of unique){
  const amount=balanceAmount(item.TokenQuantity??item.balance,item.TokenDivisor??item.decimals);
  if(!amount)continue;
  const market=prices.get(address)||null;
  const p=market?.price,price=p!=null&&p!==''&&Number.isFinite(Number(p))&&Number(p)>=0?Number(p):null;
  const product=price!=null&&amount.balance!=null?amount.balance*price:null;
  rows.push({address,...amount,symbol:String(item.TokenSymbol||market?.symbol||''),name:String(item.TokenName||market?.name||''),
   price,value:Number.isFinite(product)?product:null,change24h:market?.changes?.['24h']??null,
   marketCap:market?.marketCap??null,liquidity:market?.liquidity??null,logo:market?.logo??null,source:market?.source??null,listed:!!market});
 }
 return rows.sort((a,b)=>(b.value??-1)-(a.value??-1)||(b.balance??-1)-(a.balance??-1)||a.address.localeCompare(b.address));
}
export async function nativeBalance(address,budget=6000){
 const until=Date.now()+budget;
 for(const url of RPC_HTTP){
  const left=until-Date.now();if(left<=0)break;
  try{
   const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(Math.min(2500,left)),
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[address,'latest']})});
   if(!response.ok)continue;
   const data=await response.json();
   if(!data.error&&typeof data.result==='string'&&/^0x[0-9a-f]+$/i.test(data.result))return Number(BigInt(data.result))/1e18;
  }catch{}
 }
 return null;
}
async function readPage(address,page,size){
 const url=new URL(process.env.WALLET_EXPLORER_API||'https://api.arc-scan.org/api');
 for(const [key,value] of Object.entries({module:'account',action:'addresstokenbalance',address,page,offset:size}))url.searchParams.set(key,String(value));
 const response=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('Explorer HTTP '+response.status);
 const data=await response.json();
 if(Array.isArray(data.result)&&(data.status==='1'||!data.result.length&&/no (tokens|transactions|records)/i.test(data.message||'')))return data.result;
 throw Error('Explorer could not return balances');
}
const readWallet=createWalletReader({readPage,readNative:nativeBalance});
export async function walletHoldings(address,lookup){
 const wallet=String(address||'').toLowerCase();
 if(!isAddress(wallet))throw Error('Invalid wallet address');
 const read=await readWallet(wallet),errors={...read.errors};
 const held=shapeHoldings(read.result);
 let prices=new Map(),pricePending=false,timer;
 try{
  if(typeof lookup==='function'){
   const result=await Promise.race([Promise.resolve().then(()=>lookup(held.map(t=>t.address))),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),750);})]);
   if(result==null)pricePending=true;else prices=result;
  }else if(lookup instanceof Map)prices=lookup;
 }catch{errors.prices='Market prices unavailable';}finally{clearTimeout(timer);}
 const tokens=shapeHoldings(read.result,prices),valued=tokens.reduce((n,t)=>n+(t.value??0),0);
 // Native USDC and its ERC-20 view represent the same asset: never count both.
 const alias=read.result.find(t=>String(t.TokenAddress||t.contractAddress||'').toLowerCase()===USDC.toLowerCase());
 const aliasBalance=alias?balanceAmount(alias.TokenQuantity??alias.balance,alias.TokenDivisor??alias.decimals)?.balance:null;
 const usdc=read.usdc??aliasBalance??null,total=valued+(usdc??0);
 const unpriced=tokens.filter(t=>t.value==null).length;
 return {address:wallet,usdc,tokens:tokens.map(t=>({...t,share:t.value==null||total<=0?null:t.value/total*100})),
  pending:read.pending||pricePending,complete:read.complete,stale:read.stale,asOf:read.asOf,pages:read.pages,
  totals:{tokens:tokens.length,valued:total,inTokens:valued,inUsdc:usdc,usdcShare:usdc!=null&&total>0?usdc/total*100:null,unpriced,
   partial:!read.complete||usdc==null||unpriced>0},
  errors:Object.keys(errors).length?errors:undefined};
}
