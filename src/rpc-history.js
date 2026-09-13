import {createPublicClient,fallback,http,parseAbi,parseAbiItem,keccak256,encodeAbiParameters,parseAbiParameters} from 'viem';
import {RPC_HTTP,USDC} from './config.js';

// Batching is off because Arc rejects batched requests. Ranking is deliberately not used here: this
// reader holds a cursor across calls, and the ranker's own probing made its passes hang.
const rpc=createPublicClient({transport:fallback(
 RPC_HTTP.map(url=>http(url,{batch:false,timeout:12000,retryCount:1}))),cacheTime:30000});
const abi=parseAbi(['function token0() view returns (address)','function token1() view returns (address)','function decimals() view returns (uint8)']);
const events=[parseAbiItem('event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)'),parseAbiItem('event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)')];
const v4Swap=parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const v4Manager='0x8366a39cc670b4001a1121b8f6a443a643e40951';
const zero='0x0000000000000000000000000000000000000000';
export function sqrtPriceToUsd(sqrt,info){
 const square=BigInt(sqrt)**2n,Q192=1n<<192n;
 if(square===0n)return null;
 // Keep the rational computation in integers until the presentation boundary.
 const tokenScale=10n**BigInt(info.decimals),quoteScale=10n**BigInt(info.quoteDecimals??6);
 const numerator=(info.token0?square:Q192)*tokenScale;
 const denominator=(info.token0?Q192:square)*quoteScale;
 return Number(numerator)/Number(denominator);
}
export function v4PoolInfo(address,token,descriptor,decimals){
 if(descriptor?.version!=='v4'||descriptor.quoteToken?.toLowerCase()!==USDC)throw Error('Unsupported V4 quote');
 const quote=descriptor.nativeQuote?zero:USDC;
 const [a,b]=[quote,token].sort();
 const id=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[a,b,descriptor.feeTier,descriptor.tickSpacing,descriptor.hooks]));
 if(id!==address)throw Error('V4 pool key mismatch');
 return {v4:true,token0:a===token,decimals,quoteDecimals:descriptor.nativeQuote?18:6};
}
const pools=new Map(),times=new Map();let verified=false;
// Arc returns the block's timestamp on the log itself. Using it removes one request per block: asking the
// node separately for every block in a window was what made reaching back through a token's history take
// hours, and on a busy pool it stalled the pass outright.
const logTime=log=>{
 const raw=log?.blockTimestamp;
 if(raw==null)return null;
 const at=Number(typeof raw==='string'?BigInt(raw):raw);
 return Number.isFinite(at)&&at>0?at:null;
};

async function blockTime(block){
 const key=String(block);if(times.has(key))return times.get(key);
 const at=Number((await rpc.getBlock({blockNumber:BigInt(block)})).timestamp);
 if(times.size>3000)times.delete(times.keys().next().value);times.set(key,at);return at;
}
// One endpoint answers a contract read with a JSON-RPC error rather than a transport failure, and a
// fallback transport treats that as a real answer and stops there. Contract reads therefore try the
// endpoints themselves, in order, and keep the first that actually answers.
const readers=RPC_HTTP.map(url=>createPublicClient({transport:http(url,{batch:false,timeout:10000,retryCount:0})}));
async function readAnywhere(call){
 let last;
 for(const reader of readers){
  try{return await reader.readContract(call);}catch(e){last=e;}
 }
 throw last||Error('No endpoint answered the contract read');
}

// Log queries need the same treatment, and for the same reason: an endpoint that does not keep old logs
// answers a deep window with an error rather than a failure, and the fallback would take that as final.
async function logsAnywhere(query){
 let last;
 for(const reader of readers){
  try{return await reader.getLogs(query);}catch(e){last=e;}
 }
 throw last||Error('No endpoint answered the log query');
}

async function poolInfo(address,token,descriptor){
 const key=address+token;if(pools.has(key))return pools.get(key);
 if(!verified){if(await rpc.getChainId()!==5042)throw Error('RPC chain mismatch');verified=true;}
 if(address.length===66){const d=await readAnywhere({address:token,abi,functionName:'decimals'});const info=v4PoolInfo(address,token,descriptor,Number(d));pools.set(key,info);return info;}
 // Read one after another. Firing these together made the first endpoint answer with something that is
 // not JSON-RPC at all, which failed the whole backfill; this happens once per pool and is then cached.
 const a=await readAnywhere({address,abi,functionName:'token0'});
 const b=await readAnywhere({address,abi,functionName:'token1'});
 const d=await readAnywhere({address:token,abi,functionName:'decimals'});
 const token0=a.toLowerCase()===token;
 if((token0?b:a).toLowerCase()!==USDC||(token0?a:b).toLowerCase()!==token)throw Error('Pool is not the selected token/USDC market');
 const info={token0,decimals:Number(d),quoteDecimals:6};pools.set(key,info);return info;
}
export function decodePoolTrade(log,info,at){
 const a=log.args;let quote,amount,price,buy;
 if(a.sqrtPriceX96!=null){
  const q=info.token0?a.amount1:a.amount0,t=info.token0?a.amount0:a.amount1;
  if(q==null||t==null||q===0n||t===0n)return null;
  quote=Math.abs(Number(q))/10**(info.quoteDecimals??6);amount=Math.abs(Number(t))/10**info.decimals;buy=info.v4?q<0n:q>0n;
  price=sqrtPriceToUsd(a.sqrtPriceX96,info);
 }else{
  const q=info.token0?a.amount1In-a.amount1Out:a.amount0In-a.amount0Out;
  const t=info.token0?a.amount0In-a.amount0Out:a.amount1In-a.amount1Out;
  quote=Math.abs(Number(q))/1e6;amount=Math.abs(Number(t))/10**info.decimals;buy=q>0n;price=quote/amount;
 }
 if(!(quote>0&&amount>0&&price>0&&Number.isFinite(price)))return null;
 return {id:log.transactionHash+':'+log.logIndex,at,price,usd_volume:quote,buy,trader:info.v4?null:a.recipient||a.to,tx:log.transactionHash,block:Number(log.blockNumber),logIndex:Number(log.logIndex)};
}
// Target one verified USDC pool. A bounded 10k-block window respects public
// RPC log limits; cursors advance only after the entire window is decoded.
export async function poolHistory(token,address,state={},descriptor){
 state=state||{};
 address=String(address||'').toLowerCase();token=token.toLowerCase();
 if(!/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(address))return null;
 if(state.schema!==3||state.pool&&state.pool!==address)state={};
 const info=await poolInfo(address,token,descriptor),head=Math.max(0,Number(await rpc.getBlockNumber())-12);
 if(state.head>head)throw Error('RPC head is behind the indexed checkpoint');
 if(state.hash&&(await rpc.getBlock({blockNumber:BigInt(state.head)})).hash!==state.hash){
  state={generation:Date.now()};times.clear();
 }
 const generation=state.generation||0;
 let from,to;
 if(state.head!=null&&head-state.head>=10000){from=state.head+1;to=Math.min(head,from+9999);}
 else {to=state.oldest!=null?state.oldest-1:head;from=Math.max(0,to-9999);}
 const ranges=to>=0?[{from,to}]:[];
 // One window per pass meant a token a few weeks old took hours to reach its first day. Several are taken
 // per pass, in sequence rather than together, and they are consecutive so the checkpoint still moves in
 // one unbroken line.
 const extra=Math.max(0,Math.min(60,Number(process.env.RPC_HISTORY_WINDOWS||10))-1);
 let edge=ranges.length?ranges[ranges.length-1].from:null;
 for(let i=0;i<extra&&edge!=null&&edge>0;i++){
  const stop=edge-1,start=Math.max(0,stop-9999);
  ranges.push({from:start,to:stop});edge=start;
 }
 if(state.head!=null&&head>state.head&&head-state.head<10000)ranges.push({from:state.head+1,to:head});
 const trades=[];
 for(const range of ranges){
  const logs=await logsAnywhere({...(info.v4?{address:v4Manager,event:v4Swap,args:{id:address}}:{address,events}),fromBlock:BigInt(range.from),toBlock:BigInt(range.to)});
  let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{while(cursor<logs.length){const log=logs[cursor++];if(log.removed)continue;const row=decodePoolTrade(log,info,logTime(log)??await blockTime(log.blockNumber));if(row)trades.push({...row,pool:address,generation});}}));
 }
 // The checkpoint records the deepest window this pass read, not the first of them.
 const deepest=Math.min(...ranges.map(r=>r.from));
 const oldest=Math.min(state.oldest??deepest,deepest),end=Math.max(state.head??to,...ranges.map(r=>r.to));
 const hash=(await rpc.getBlock({blockNumber:BigInt(end)})).hash;
 return {trades,state:{schema:3,pool:address,oldest,head:end,hash,generation,from:await blockTime(oldest),to:await blockTime(end),complete:oldest===0}};
}
