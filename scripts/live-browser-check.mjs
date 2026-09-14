// Isolated simulated feed: never connects to a real indexer or changes user data.
import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'@playwright/test');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=express(),address='0x'+'1'.repeat(40),now=Math.floor(Date.now()/1000),bucket=Math.floor(now/3600)*3600;
const market={address,symbol:'TEST',name:'Test fixture',source:'dyor',price:.01,marketCap:10000,fdv:10000,changes:{},versions:[],volume:30};
const one={id:'one',at:now-10,price:.01,usd_volume:10,buy:true,tx:'0x'+'2'.repeat(64)};
const two={id:'two',at:now,price:.012,usd_volume:20,buy:false,tx:'0x'+'3'.repeat(64)};
let calls=0;
app.get('/api/market/:address',(req,res)=>res.json({market,timeframe:req.query.tf,candles:[{bucket:bucket-3600,open:.01,high:.011,low:.009,close:.01,volume:5},{bucket,open:.01,high:.011,low:.009,close:.01,volume:10}],closes:[],trades:[one],errors:{},cache:{},supported:true}));
app.get('/api/live/:address',(_,res)=>res.json({market:{...market,price:++calls>1?.012:.01},trades:calls>1?[two,one]:[one],lastTradeAt:now,stale:false,errors:{}}));
app.get('/vendor/charts.js',(_,res)=>res.sendFile(path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));
app.use(express.static(path.join(root,'public')));
app.get('/token/:address',(_,res)=>res.sendFile(path.join(root,'public/index.html')));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/token/'+address);
 await page.waitForSelector('#trades tr[data-trade-key="one"]');
 await page.evaluate(()=>window.keptTrade=document.querySelector('#trades tr[data-trade-key="one"]'));
 await page.waitForSelector('#trades tr[data-trade-key="two"]');
 assert.equal(await page.locator('#trades tr').count(),2);
 assert.equal(await page.evaluate(()=>window.keptTrade===document.querySelector('#trades tr[data-trade-key="one"]')),true);
 await page.locator('[data-tf="5m"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-tf="5m"]').classList.contains('active'));
 assert.equal(await page.locator('#trades tr').count(),2);
 assert.equal(await page.evaluate(()=>window.keptTrade.isConnected),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: live transaction arrival, stable existing row, timeframe switch, zero browser errors');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
