// Isolated progressive-wallet fixture; no production API/RPC calls.
import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'@playwright/test');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),app=express();
const address='0x'+'1'.repeat(40);let calls=0;
const token=(n,extra)=>({address:'0x'+String(n).repeat(40),symbol:'TOKEN'+n,name:'Fixture',price:null,value:null,share:null,change24h:null,listed:false,balance:1,balanceExact:'1',balanceRaw:'1',...extra});
app.get('/api/wallet/:address',(_,res)=>{const complete=++calls>1;res.json({address,pending:!complete,complete,pages:complete?3:1,usdc:complete?2:null,
 tokens:complete?[token(2),token(3,{balance:1e-18,balanceExact:'0.000000000000000001'}),token(4,{balance:null,balanceRaw:'42'})]:[token(2)],
 totals:{tokens:complete?3:1,valued:complete?2:0,inTokens:0,inUsdc:complete?2:null,unpriced:complete?3:1,partial:true,usdcShare:100}});});
app.get('/api/markets',(_,res)=>res.status(503).json({error:'fixture search unavailable'}));
app.get('/vendor/charts.js',(_,res)=>res.sendFile(path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));
app.use(express.static(path.join(root,'public')));
app.get('/wallet/:address',(_,res)=>res.sendFile(path.join(root,'public/index.html')));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/wallet/'+address);
 await page.waitForFunction(()=>document.querySelector('#wallet-rows')?.textContent.includes('TOKEN2'));
 await page.waitForFunction(()=>document.querySelector('#wallet-rows')?.textContent.includes('TOKEN4'));
 assert.equal(await page.locator('#wallet-rows tr').count(),4);
 assert.match(await page.locator('#wallet-rows').textContent(),/0\.000000000000000001/);
 assert.match(await page.locator('#wallet-rows').textContent(),/42 raw units/);
 assert.match(await page.locator('#wallet-head').textContent(),/known holdings value/);
 await page.locator('#global-search').fill(address);
 await page.waitForFunction(()=>document.querySelector('#search-results')?.textContent.includes('Token search unavailable'));
 assert.equal(await page.locator('#search-results a[href="/wallet/'+address+'"]').count(),1);
 assert.deepEqual(errors,[]);
 console.log('PASS: progressive holdings, unpriced/unknown/tiny balances, USDC once, wallet shortcut survives failed token search');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
