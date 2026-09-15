// Isolated simulated feed: never connects to a real indexer or changes user data.
import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createEventStream} from '../src/event-stream.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'@playwright/test');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=express(),address='0x'+'1'.repeat(40),now=Math.floor(Date.now()/1000),bucket=Math.floor(now/3600)*3600;
const market={address,pool:'primary',symbol:'TEST',name:'Test fixture',source:'uniswap',launchpad:'dyor',price:.01,marketCap:10000,fdv:10000,changes:{},versions:[],volume:30};
const one={id:'one',pool:'primary',logIndex:1,at:now-10,price:.01,usd_volume:10,buy:true,tx:'0x'+'2'.repeat(64)};
const two={id:'two',pool:'primary',logIndex:2,at:now,price:.012,usd_volume:20,buy:false,tx:'0x'+'3'.repeat(64)};
let calls=0;
const stream=createEventStream(async()=>({market:{...market,price:++calls>1?.012:.01,marketCap:calls>1?12000:10000},chartTrades:calls>1?[two,one]:[one],trades:calls>1?[two,one]:[one],lastTradeAt:now,stale:false,errors:{}}),new EventEmitter(),{interval:300});
app.get('/api/events',stream.handler);
app.get('/api/market/:address',(req,res)=>{const seconds={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[req.query.tf];const start=Math.floor((now-20)/seconds)*seconds;res.json({market,timeframe:req.query.tf,candles:[{bucket:start,open:.01,high:.011,low:.009,close:.01,volume:5}],history:{pool:'primary',lastTradeAt:now-20},closes:[],trades:[one],errors:{},cache:{},supported:true});});
app.get('/api/live/:address',(_,res)=>res.json({market:{...market,price:++calls>1?.012:.01},trades:calls>1?[two,one]:[one],lastTradeAt:now,stale:false,errors:{}}));
app.get('/vendor/charts.js',(_,res)=>res.sendFile(path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));
app.use(express.static(path.join(root,'public')));
app.get('/token/:address',(_,res)=>res.sendFile(path.join(root,'public/index.html')));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/vendor/charts.js',async route=>{const response=await route.fetch();const script=await response.text();await route.fulfill({response,body:script+`;(()=>{const api=window.LightweightCharts;window.LightweightCharts={...api,createChart:(...args)=>{const chart=api.createChart(...args);const add=chart.addCandlestickSeries.bind(chart);chart.addCandlestickSeries=(...a)=>{const s=add(...a);window.testCandles=s;const create=s.createPriceLine.bind(s);s.createPriceLine=(...v)=>{const p=create(...v);window.testMark=p;return p};return s};return chart}}})()`});});
 await page.goto('http://127.0.0.1:'+server.address().port+'/token/'+address);
 await page.waitForSelector('#trades tr[data-trade-key="one"]');
 await page.evaluate(()=>window.keptTrade=document.querySelector('#trades tr[data-trade-key="one"]'));
 await page.waitForSelector('#trades tr[data-trade-key="two"]');
 assert.equal(await page.locator('#trades tr').count(),2);
 assert.equal(await page.locator('#token-heading .launchpad-tag').textContent(),'DYOR');
 assert.equal(await page.evaluate(()=>window.keptTrade===document.querySelector('#trades tr[data-trade-key="one"]')),true);
 await page.locator('[data-tf="5m"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-tf="5m"]').classList.contains('active'));
 assert.equal(await page.locator('#trades tr').count(),2);
 assert.equal(await page.evaluate(()=>window.keptTrade.isConnected),true);
 await page.locator('[data-scale="mc"]').click();
 for(const frame of ['1m','5m','15m','1h','4h','1d']){
  await page.locator('[data-tf="'+frame+'"]').click();
  await page.waitForFunction(()=>document.querySelector('#chart-empty').style.display==='none'&&window.testMark.options().price===12000&&Math.abs(window.testCandles.data().at(-1)?.close-12000)<.00001);
  assert.equal(await page.evaluate(()=>window.testMark.options().price),12000);
 }
 // A quiet SSE stream is not a reason to restore an old timeframe valuation after 20 seconds.
 await page.evaluate(()=>{const now=Date.now();Date.now=()=>now+25000;});
 await page.locator('[data-tf="1m"]').click();
 await page.waitForFunction(()=>window.testMark.options().price===12000);
 assert.ok((await page.locator('#token-heading .head-price').textContent()).includes('0.012'));
 assert.deepEqual(errors,[]);
 console.log('PASS: live transactions, stable rows, six-frame candle close and MC marker equality, quiet-SSE valuation retention, zero browser errors');
}finally{stream.close();await browser?.close();await new Promise(resolve=>server.close(resolve));}
