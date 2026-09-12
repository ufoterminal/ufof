// ArgusPad launch registry, read straight from its Portal contracts on Arc.
//
// ArgusPad does not publish a token list endpoint. Its launch list lives on chain: every Portal keeps
// tokenCount() and allTokens(i). The addresses and the Portal history below come from ArgusPad's own
// integrator bundle (https://arguspad.io/argus-v4.json), which re-reads them from deployed bytecode.
// This registry is what decides whether a token belongs to ArgusPad; market numbers come from elsewhere
// and are only accepted for addresses found here.
import {createPublicClient,fallback,http,parseAbi} from 'viem';
import {RPC_HTTP} from './config.js';

export const ARGUS_PORTALS=[
 {address:'0xa5628a11c412596e1f63b75a2c0284f843c549d6',line:'hooked-v4',deployBlock:20240260,current:true},
 {address:'0x07a688a001f416cc433c68ff56aa26bc5131cc6e',line:'hooked-v4',deployBlock:20081606},
 {address:'0xa36c443a797771df82533b8b4a86f0affd970862',line:'hooked-v4',deployBlock:19690658},
 {address:'0x7a17ab0106c46c0be30623f3eb7f299cc0058338',line:'hooked-v4',deployBlock:19674154},
 {address:'0xbed9880a0ba12722ba4b8791c0b6f8c74338246c',line:'legacy-v3',deployBlock:19056397},
 {address:'0x0f1c7cb26d6cd36bd4189e41947658b39437587a',line:'legacy-v3',deployBlock:18817867}
];

const portalAbi=parseAbi(['function tokenCount() view returns (uint256)','function allTokens(uint256) view returns (address)']);
const erc20Abi=parseAbi(['function name() view returns (string)','function symbol() view returns (string)','function decimals() view returns (uint8)']);

let client;
// Arc refuses JSON-RPC batching (-32600), so every transport is created with batching off.
const rpc=()=>client??=createPublicClient({transport:fallback(RPC_HTTP.map(url=>http(url,{batch:false,timeout:10000,retryCount:1})))});

export const chainReader={
 count:async portal=>Number(await rpc().readContract({address:portal,abi:portalAbi,functionName:'tokenCount'})),
 token:async(portal,index)=>String(await rpc().readContract({address:portal,abi:portalAbi,functionName:'allTokens',args:[BigInt(index)]})).toLowerCase(),
 meta:async token=>{
  const read=fn=>rpc().readContract({address:token,abi:erc20Abi,functionName:fn}).catch(()=>null);
  const [name,symbol,decimals]=await Promise.all([read('name'),read('symbol'),read('decimals')]);
  return {name:name==null?'':String(name),symbol:symbol==null?'':String(symbol),decimals:decimals==null?null:Number(decimals)};
 }
};

// Known launches per Portal, in index order. A launch never leaves a Portal, so each refresh only reads
// the indices past what is already known.
const known=new Map(ARGUS_PORTALS.map(p=>[p.address,[]]));
const metaCache=new Map();
let checkedAt=0,inflight=null;
export const registryState={errors:{},checkedAt:null};

export async function refreshRegistry(reader=chainReader){
 const errors={};
 for(const portal of ARGUS_PORTALS){
  const list=known.get(portal.address);
  try{
   const count=await reader.count(portal.address);
   if(!Number.isInteger(count)||count<0)throw Error('tokenCount is not a count');
   // Indices are read in parallel batches: one at a time turned the first run of this source into a
   // minute of waiting, which was long enough to be dropped from the sync.
   const lanes=Math.max(1,Math.min(32,Number(process.env.ARGUS_CONCURRENCY||12)));
   for(let start=list.length;start<count;start+=lanes){
    const indices=[];
    for(let i=start;i<Math.min(count,start+lanes);i++)indices.push(i);
    const tokens=await Promise.all(indices.map(i=>reader.token(portal.address,i)));
    for(const token of tokens){
     if(!/^0x[0-9a-f]{40}$/.test(token))throw Error('allTokens returned something that is not an address');
     list.push(token);
    }
   }
  }catch(e){errors[portal.address]=e.shortMessage||e.message;}
 }
 registryState.errors=errors;registryState.checkedAt=Math.floor(Date.now()/1000);
 const entries=registryEntries();
 // One Portal failing keeps the rest; nothing read at all is an error, not an empty pad.
 if(!entries.length&&Object.keys(errors).length)throw Error('ArgusPad registry unreadable: '+Object.values(errors)[0]);
 return entries;
}

export function registryEntries(){
 const out=[];
 for(const portal of ARGUS_PORTALS)known.get(portal.address).forEach((address,index)=>out.push({address,portal:portal.address,index,line:portal.line}));
 return out;
}

export async function argusRegistry({ttl=60000,reader=chainReader}={}){
 if(checkedAt>Date.now()-ttl&&registryEntries().length)return registryEntries();
 if(inflight)return inflight;
 inflight=refreshRegistry(reader).then(entries=>{checkedAt=Date.now();return entries;}).finally(()=>{inflight=null;});
 return inflight;
}

// Name and symbol for a launch the market feed has not picked up yet. Read once per token.
export async function launchMeta(token,reader=chainReader){
 if(metaCache.has(token))return metaCache.get(token);
 const meta=await reader.meta(token);
 if(meta.symbol||meta.name)metaCache.set(token,meta);
 return meta;
}

export function resetRegistry(){for(const list of known.values())list.length=0;metaCache.clear();checkedAt=0;inflight=null;}
