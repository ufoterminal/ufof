import {init,q,pool} from './db.js';
import {buildMarket} from './market-service.js';
import {frames,requestSnapshot,claimJob,finishJob,publishSnapshot,initSnapshots} from './snapshots.js';
import {drainHolderMaps,seedHolderMaps} from './holder-map.js';
import {scanPadsInBackground} from './pad-registry.js';
import {readPadMetadata,readDiscoveredMetadata} from './token-metadata.js';
import {onchainSync,findPoolsFor,tokensMissingPools} from './onchain.js';
import {namePadLaunches} from './direct.js';
import {refreshRegistryInBackground} from './argus.js';
let stopped=false;
export async function seedJobs(){
 await initSnapshots();
 // Warm active markets. Inactive tokens remain searchable and are queued on
 // demand, rather than spending RPC capacity on thousands of idle contracts.
 await q(`INSERT INTO market_jobs_v3(token,tf,next_at)
 SELECT address,tf,ROW_NUMBER() OVER(ORDER BY COALESCE((metadata->>'volume24h')::numeric,0) DESC,address)
 FROM tokens CROSS JOIN unnest($1::text[]) AS tf WHERE metadata->>'feed_schema'='2'
 AND (COALESCE((metadata->>'volume24h')::numeric,0)>0 OR COALESCE((metadata->>'last_trade_at')::numeric,0)>$2)
 ON CONFLICT(token,tf) DO NOTHING`,[frames,Date.now()/1000-86400]);
 await q(`UPDATE market_jobs_v3 j SET next_at=GREATEST(next_at,$1) WHERE priority=0 AND lease_until<$2 AND NOT EXISTS
 (SELECT 1 FROM tokens t WHERE t.address=j.token AND (COALESCE((t.metadata->>'volume24h')::numeric,0)>0
 OR COALESCE((t.metadata->>'last_trade_at')::numeric,0)>$3))`,[Date.now()+86400000,Date.now(),Date.now()/1000-86400]);
}
export function startWorker(){
 const timers=new Set();
 const later=(fn,ms)=>{if(stopped)return;const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);timer.unref();};
 async function run(){
  let job;
  try{job=await claimJob();if(job){try{await publishSnapshot(job.token,job.tf,await buildMarket(job.token,job.tf));await finishJob(job,null);}catch(e){await finishJob(job,e.shortMessage||e.message);}}}
  catch(e){console.error('[worker]',e.message);}
  later(run,job?100:1000);
 }
 async function seed(){try{await seedJobs();await seedHolderMaps();}catch(e){console.error('[seed]',e.message);}later(seed,60000);}
 // Holder maps are filled a few windows at a time between snapshot jobs.
 async function maps(){
  let worked=false;
  try{worked=!!await drainHolderMaps();}catch(e){console.error('[holder-map]',e.message);}
  later(maps,worked?500:5000);
 }
 // The chain-backed pad registries, kept out of the sync path.
 async function registries(){
  try{await scanPadsInBackground();await refreshRegistryInBackground();await namePadLaunches();await readPadMetadata();await readDiscoveredMetadata();}catch(e){console.error('[registries]',e.message);}
  later(registries,15000);
 }
 // Following the chain: new pools and new swaps, continuously, apart from the market round.
 async function indexer(){
  let worked=false;
  try{
   const p=await onchainSync();
   // Known launches without a pool are asked about directly, which is far cheaper than waiting for the
   // backwards scan to reach the block they were created in.
   const waiting=await tokensMissingPools();
   const linked=waiting.length?await findPoolsFor(waiting):[];
   worked=!!(p.pools||p.trades||linked.length);
  }catch(e){console.error('[indexer]',e.message);}
  later(indexer,worked?1000:5000);
 }
 indexer();
 registries();
 maps();
 for(let i=0;i<Math.max(1,Math.min(4,Number(process.env.INDEXER_CONCURRENCY)||2));i++)run();
 seed();return ()=>{stopped=true;for(const timer of timers)clearTimeout(timer);};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/worker.js')){
 if(!process.env.DATABASE_URL)throw Error('Standalone worker requires DATABASE_URL shared with the web service');
 await init();startWorker();setInterval(()=>{},60000);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{stopped=true;await pool.end();process.exit(0);});
}
