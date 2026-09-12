import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {init,pool,storage} from './db.js';
import {syncExternal} from './providers.js';
import {listMarkets,getMarket,invalidateMarkets} from './market-service.js';
import {startWorker} from './worker.js';
import {snapshotStatus} from './snapshots.js';
import {onchainStatus} from './onchain.js';
const app=express(),root=path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
let status={syncing:false,lastSync:null,lastError:null,sources:[]};
const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('[http]',e.message);res.status(500).json({error:e.message});}};
app.get('/health',(_,res)=>res.json({ok:true,storage,...status}));
app.get('/api/status',(_,res)=>res.json({chainId:5042,storage,...status}));
app.get('/api/onchain',route(async(_,res)=>res.json(await onchainStatus())));
app.get('/api/indexer',route(async(_,res)=>res.json(await snapshotStatus())));
app.get('/api/markets',route(async(req,res)=>res.json({...await listMarkets(req.query),status})));
app.get('/api/screener',route(async(req,res)=>res.json({...await listMarkets(req.query),status})));
app.get('/api/search',route(async(req,res)=>res.json(await listMarkets({...req.query,mode:'all',limit:50}))));
app.get('/api/market/:address',route(async(req,res)=>{
 if(!/^0x[0-9a-f]{40}$/i.test(req.params.address))return res.status(400).json({error:'Invalid address'});
 if(!['1m','5m','15m','1h','4h','1d'].includes(String(req.query.tf||'1h')))return res.status(400).json({error:'Invalid timeframe'});
 const data=await getMarket(req.params.address,String(req.query.tf||'1h'));
 if(!data)return res.status(404).json({error:'This token is not in the connected sources yet.'});res.json(data);
}));
app.get('/vendor/charts.js',(_,res)=>res.sendFile(path.join(root,'../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));
app.use(express.static(path.join(root,'../public')));
app.get('/token/:address',(_,res)=>res.sendFile(path.join(root,'../public/index.html')));
await init();
const stopWorker=process.env.INDEXER_MODE==='external'?()=>{}:startWorker();
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('[http] Listening on '+(process.env.PORT||3000)));
async function sync(){
 if(status.syncing)return;status.syncing=true;
 try{status.sources=await syncExternal();status.lastSync=Math.floor(Date.now()/1000);status.lastError=status.sources.filter(s=>!s.ok).map(s=>s.id+': '+s.error).join('; ')||null;invalidateMarkets();}
 catch(e){status.lastError=e.message;console.error('[sync]',e.message);}
 finally{status.syncing=false;}
}
let stopped=false;
async function loop(){await sync();if(!stopped)setTimeout(loop,60000).unref();}
loop();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{stopped=true;stopWorker();server.close();await pool.end();process.exit(0);});
