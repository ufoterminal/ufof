// Who holds the token, for the holders panel.
//
// The chain explorer indexes balances for every token on Arc, whichever pad launched it, so it is asked
// first. It answers with an internal error often enough that a fallback matters, so when it fails the
// token's own pad is asked, and when that fails too the panel says plainly that the list is unavailable
// rather than showing an invented one.
import {cachedJson} from './direct.js';

const EXPLORER='https://api.arc-scan.org/v1/tokens/';
// The explorer answers for most tokens but returns an internal error for some of them, consistently, so
// a token's own pad is asked next where it publishes holders, and a general index last. Without that last
// step the panel would simply be empty on those tokens.
const padHolders={
 tolly:a=>'https://api.tollylabs.com/holders?token='+a,
 circlewarp:a=>'https://warp-arc-production.up.railway.app/api/tokens/'+a+'/holders'
};
const generalHolders=a=>'https://api.radardex.pro/token/'+a+'/holders?limit=50';

const scale=(raw,decimals)=>{
 if(raw==null)return null;
 const n=Number(raw);
 return Number.isFinite(n)?n/10**(Number(decimals)||18):null;
};

function fromExplorer(json){
 if(!Array.isArray(json?.items))return null;
 const rows=json.items.map(h=>({
  address:String(h.address?.address||'').toLowerCase(),
  balance:h.balance?.formatted!=null?Number(h.balance.formatted):scale(h.balance?.raw,h.balance?.decimals),
  share:h.share==null?null:Number(h.share)*100,
  label:h.address?.label||null
 })).filter(h=>/^0x[0-9a-f]{40}$/.test(h.address));
 return rows.length?{holders:rows,count:json.holder_count??null,provider:'arc-scan'}:null;
}

function fromPad(json,source){
 const list=Array.isArray(json?.holders)?json.holders:Array.isArray(json)?json:null;
 if(!list)return null;
 const decimals=json?.decimals;
 const total=Number(json?.total)||null;
 const rows=list.map(h=>{
  const balance=h.balance!=null&&String(h.balance).length>15?scale(h.balance,decimals):Number(h.balance);
  return {address:String(h.address||'').toLowerCase(),
   balance:Number.isFinite(balance)?balance:null,
   share:h.percent!=null?Number(h.percent):h.shareBps!=null?Number(h.shareBps)/100:
    (total&&h.balance!=null?Number(h.balance)/total*100:null),
   label:h.label||(h.isPool?'Pool':null)};
 }).filter(h=>/^0x[0-9a-f]{40}$/.test(h.address));
 return rows.length?{holders:rows,count:json?.holderCount??null,provider:source}:null;
}

// Addresses that are a market, not a person. The v4 PoolManager holds every v4 pool's tokens, so it is
// always one of these; v2 and v3 pools are their own addresses and come from what we indexed.
// The two addresses tokens are burned to hold supply nobody can spend, so they are named as such rather
// than appearing as the token's largest anonymous holder.
const BURN_LABELS={'0x000000000000000000000000000000000000dead':'Burned','0x0000000000000000000000000000000000000000':'Burned'};
export function labelPools(rows,pools=[]){
 const known=new Map(pools.filter(p=>p&&p.address).map(p=>[String(p.address).toLowerCase(),p.label||'Pool']));
 return rows.map(h=>({...h,label:BURN_LABELS[h.address]||known.get(h.address)||h.label||null}));
}

export async function tokenHolders(address,source,pools=[]){
 const token=String(address||'').toLowerCase();
 if(!/^0x[0-9a-f]{40}$/.test(token))throw Error('Invalid token address');
 const errors={};
 try{
  const found=fromExplorer(await cachedJson(EXPLORER+token+'/holders?limit=50',120000));
  if(found)return {...found,holders:labelPools(found.holders.slice(0,50),pools)};
  errors.explorer='no holders returned';
 }catch(e){errors.explorer=e.message;}
 const url=padHolders[source];
 if(url){
  try{
   const found=fromPad(await cachedJson(url(token),120000),source);
   if(found)return {...found,holders:labelPools(found.holders.slice(0,50),pools),errors};
   errors.source='no holders returned';
  }catch(e){errors.source=e.message;}
 }
 try{
  const found=fromPad(await cachedJson(generalHolders(token),120000),'radardex');
  if(found)return {...found,holders:labelPools(found.holders.slice(0,50),pools),errors};
  errors.general='no holders returned';
 }catch(e){errors.general=e.message;}
 return {holders:[],count:null,provider:null,errors};
}
