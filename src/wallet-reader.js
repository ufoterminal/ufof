// Shared, progressive wallet scans. Page work is bounded per request, not silently truncated.
export function createWalletReader({readPage,readNative,pageSize=100,pagesPerPass=4,waitMs=1000,ttl=30000,retryMs=15000,maxWallets=100,maxHoldings=50000,now=Date.now}){
 const states=new Map();let active=0;
 const signal=s=>{for(const resolve of s.listeners)resolve();s.listeners.clear();};
 function entry(address){
  let s=states.get(address);
  if(s)return s;
  if(states.size>=maxWallets){const unused=[...states].find(([,v])=>!v.tokenFlight&&!v.nativeFlight);if(unused)states.delete(unused[0]);else throw Error('Wallet readers busy; retry shortly');}
  s={previous:new Map(),scan:new Map(),page:1,complete:false,at:0,nativeAt:0,usdc:null,error:null,nativeError:null,retryAt:0,nativeRetryAt:0,seen:new Set(),listeners:new Set()};
  states.set(address,s);return s;
 }
 async function tokens(address,s){
  if(s.tokenFlight||active>=4||s.retryAt>now()||(s.complete&&now()-s.at<ttl))return;
  if(s.complete){s.previous=s.scan;s.scan=new Map();s.page=1;s.seen.clear();s.complete=false;}
  s.tokenFlight=true;active++;s.error=null;
  try{
   for(let i=0;i<pagesPerPass;i++){
    const rows=await readPage(address,s.page,pageSize);
    if(!Array.isArray(rows))throw Error('Invalid explorer balance response');
    const fingerprint=JSON.stringify(rows);
    if(rows.length&&s.seen.has(fingerprint))throw Error('Explorer repeated a page; balances may be incomplete');
    if(rows.length)s.seen.add(fingerprint);
    for(const row of rows){
     const key=String(row?.TokenAddress||row?.contractAddress||'').toLowerCase();
     if(!/^0x[0-9a-f]{40}$/.test(key))continue;
     if(!s.scan.has(key)&&s.scan.size>=maxHoldings)throw Error('Wallet safety limit reached; balances are incomplete');
     s.scan.set(key,row);
    }
    s.at=now();s.page++;
    if(rows.length<pageSize){s.complete=true;s.previous=new Map();signal(s);break;}
    signal(s);
   }
  }catch(e){s.error=e.message;s.retryAt=now()+retryMs;}
  finally{s.tokenFlight=false;active--;signal(s);}
 }
 async function native(address,s){
  if(s.nativeFlight||active>=4||s.nativeRetryAt>now()||(s.nativeAt&&now()-s.nativeAt<ttl))return;
  s.nativeFlight=true;active++;s.nativeError=null;
  try{const value=await readNative(address);if(!Number.isFinite(value)||value<0)throw Error('Native USDC unavailable');s.usdc=value;s.nativeAt=now();}
  catch(e){s.nativeError=e.message;s.nativeRetryAt=now()+retryMs;}
  finally{s.nativeFlight=false;active--;signal(s);}
 }
 return async address=>{
  const s=entry(address);let wake,timer;
  const progress=new Promise(resolve=>{wake=resolve;s.listeners.add(resolve);});
  void tokens(address,s);void native(address,s);
  if(!s.at&&s.usdc==null)await Promise.race([progress,new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);
  clearTimeout(timer);s.listeners.delete(wake);
  const merged=new Map([...s.previous,...s.scan]);
  return {result:[...merged.values()],usdc:s.usdc,complete:s.complete,
   pending:!!s.tokenFlight||!!s.nativeFlight||(!s.complete&&!s.error)||(!s.nativeAt&&!s.nativeError),
   stale:!!s.previous.size||!!s.error||!!s.nativeError,
   asOf:s.at||null,nativeAsOf:s.nativeAt||null,pages:s.page-1,
   errors:{...(s.error?{tokens:s.error}:{}),...(s.nativeError?{native:s.nativeError}:{})}};
 };
}
