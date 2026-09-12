import {SOURCES,VENUES} from './sources.js';
import {esc,valid,price,usd,count,percent,color,short,age,date,since,safeUrl,sourceName,icon,spark} from './ui-utils.js';
const $=id=>document.getElementById(id),app=$('app'),params=new URLSearchParams(location.search);
const address=location.pathname.startsWith('/token/')?location.pathname.split('/').pop():null;
let watch=[];try{watch=JSON.parse(localStorage.getItem('arc-radar-watch-v1')||'[]').filter(a=>/^0x[0-9a-f]{40}$/.test(a)).slice(0,100);}catch{}
const timeframes=new Set(['1m','5m','15m','1h','4h','1d']);
const chartViews=new Set(['candles','line']);
const chartScales=new Set(['price','mc']);
let listData=null,listSeq=0,listController,searchSeq=0,searchController,searchTimer,detailSeq=0,detailController,tf=timeframes.has(params.get('tf'))?params.get('tf'):'1h',viewMode=chartViews.has(params.get('view'))?params.get('view'):'candles',scaleMode=chartScales.has(params.get('scale'))?params.get('scale'):'price',currentDetail=null;
let state={mode:params.get('mode')==='watch'?'watch':'active',page:1,sort:'volume',dir:'desc',source:'',version:'',venue:'',minLiquidity:'',minVolume:''};
const api=async(path,controller)=>{const r=await fetch(path,{signal:controller?AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed ('+r.status+')');return j;};
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,2200);}
function saveWatch(a){watch=watch.includes(a)?watch.filter(v=>v!==a):[...watch,a].slice(-100);try{localStorage.setItem('arc-radar-watch-v1',JSON.stringify(watch));}catch{}if(listData)paintList();toast(watch.includes(a)?'Added to watchlist':'Removed from watchlist');}
document.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.remove();},true);
function star(a){return '<button class="star '+(watch.includes(a)?'saved':'')+'" data-star="'+esc(a)+'" aria-label="'+(watch.includes(a)?'Remove from':'Add to')+' watchlist">☆</button>';}
function listShell(){
 app.innerHTML='<section class="hero"><div><div class="eyebrow">ARC NETWORK / MARKET EXPLORER</div><h1>Your view of Arc.</h1><p>Discover tokens. Follow the market. All in one place.</p></div><div class="stats"><div><small>ACTIVE MARKETS</small><strong id="stat-active">—</strong></div><div><small>24H VOLUME</small><strong id="stat-volume">—</strong></div><div><small>LIQUIDITY</small><strong id="stat-liquidity">—</strong></div><div><small>24H TXNS</small><strong id="stat-transactions">—</strong></div></div></section>'+
 '<div class="tape"><div class="tape-label">↗ MOST ACTIVE</div><div id="tape-items" class="tape-items"><span class="muted">Connecting to markets…</span></div></div><div id="list-banner" class="banner"></div>'+
 '<div class="workspace"><section class="market-main"><div class="toolbar"><div class="modes">'+[['active','Trending'],['new','New tokens'],['gainers','Gainers'],['losers','Losers'],['watch','☆ Watchlist']].map(([id,label])=>'<button data-mode="'+id+'" class="'+(state.mode===id?'active':'')+'">'+label+'</button>').join('')+'</div><div class="refresh-area"><span class="pill">24H</span><span class="synced" id="synced">Connecting</span><button id="refresh" class="icon-btn" aria-label="Refresh markets">↻</button></div></div>'+
 '<div class="filters"><select id="source-filter" aria-label="Launchpad"><option value="">All sources</option>'+Object.entries(SOURCES).map(([id,s])=>'<option value="'+id+'">'+s.label+'</option>').join('')+'</select><select id="version-filter" aria-label="Pool version"><option value="">All versions</option><option value="v2">V2</option><option value="v3">V3</option><option value="v4">V4</option></select><select id="venue-filter" aria-label="DEX"><option value="">All DEXes</option>'+Object.entries(VENUES).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select><label>MIN LIQ<input id="min-liquidity" type="number" min="0" placeholder="$0"></label><label>MIN VOL<input id="min-volume" type="number" min="0" placeholder="$0"></label><button id="clear-filters" class="muted">Reset</button></div>'+ 
 '<div class="table-scroll"><table class="market-table"><thead><tr><th></th><th> TOKEN</th><th>TREND</th>'+[['marketCap','MCAP'],['price','PRICE'],['createdAt','TOKEN AGE'],['volume','VOLUME ↓'],['transactions','TXNS']].map(([key,label])=>'<th data-sort="'+key+'">'+label+'</th>').join('')+'<th>TRADERS</th><th data-sort="holders">HOLDERS</th><th>5M</th><th>1H</th><th>6H</th><th data-sort="change">24H</th><th data-sort="liquidity">LIQUIDITY</th></tr></thead><tbody id="market-rows">'+Array.from({length:8},()=>'<tr><td></td><td><div class="skeleton"></div></td><td colspan="13"><div class="skeleton"></div></td></tr>').join('')+'</tbody></table></div>'+
 '<footer class="footer"><span id="result-count">Loading markets…</span><div class="pagination"><button id="page-prev" aria-label="Previous page">‹</button><span id="page-label">1 / 1</span><button id="page-next" aria-label="Next page">›</button></div></footer></section>'+
 '<aside class="sidepanel"><section class="side-section"><h2 class="side-title">Market pulse <span>24H</span></h2><div id="pulse"></div></section></aside></div>';
 app.addEventListener('click',listClick);
 for(const [id,key] of [['source-filter','source'],['version-filter','version'],['venue-filter','venue'],['min-liquidity','minLiquidity'],['min-volume','minVolume']])$(id).addEventListener('change',()=>{state[key]=$(id).value;state.page=1;loadList();});
}
function listClick(e){
 const s=e.target.closest('[data-star]');if(s){e.preventDefault();saveWatch(s.dataset.star);if(state.mode==='watch')loadList();return;}
 const mode=e.target.closest('[data-mode]');if(mode){state.mode=mode.dataset.mode;state.page=1;state.sort=state.mode==='new'?'createdAt':['gainers','losers'].includes(state.mode)?'change':'volume';state.dir=state.mode==='losers'?'asc':'desc';loadList();return;}
 const sort=e.target.closest('[data-sort]');if(sort){state.dir=state.sort===sort.dataset.sort&&state.dir==='desc'?'asc':'desc';state.sort=sort.dataset.sort;state.page=1;loadList();return;}
 if(e.target.closest('#refresh')){loadList();return;}
 if(e.target.closest('#page-prev')){state.page--;loadList();return;}if(e.target.closest('#page-next')){state.page++;loadList();return;}
 if(e.target.closest('#clear-filters')){for(const id of ['source-filter','version-filter','venue-filter','min-liquidity','min-volume'])$(id).value='';Object.assign(state,{source:'',version:'',minLiquidity:'',minVolume:'',page:1});loadList();return;}
 const row=e.target.closest('[data-token]');if(row&&!e.target.closest('a'))location.href='/token/'+row.dataset.token;
}
async function loadList(){
 const seq=++listSeq;listController?.abort();listController=new AbortController();
 const q=new URLSearchParams({...state,limit:50,addresses:state.mode==='watch'?watch.join(','):''});
 try{const data=await api('/api/markets?'+q,listController);if(seq!==listSeq)return;listData=data;state.page=data.page;paintList();}
 catch(e){if(e.name==='AbortError')return;$('list-banner').textContent='Refresh unavailable. '+(listData?'Showing the last received data.':'Retrying automatically.');if(!listData)$('market-rows').innerHTML='<tr><td colspan="15" class="empty">Could not load markets. Use ↻ to retry.</td></tr>';}
}
function paintList(){
 const d=listData;
 for(const [id,format] of [['active',count],['volume',usd],['liquidity',usd],['transactions',count]])$('stat-'+id).textContent=format(d.stats[id]);
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
 $('market-rows').innerHTML=d.rows.map(t=>'<tr data-token="'+esc(t.address)+'"><td>'+star(t.address)+'</td><td><a class="token-cell" href="/token/'+esc(t.address)+'">'+icon(t)+'<span><strong>'+esc(t.symbol||'?')+'</strong><span class="source-badge">'+esc(sourceName(t.source))+'</span><span class="description">'+esc(t.name||short(t.address))+'</span></span></a></td><td>'+spark(t.spark,t.changes['24h'])+'</td><td>'+usd(t.marketCap)+'</td><td>'+price(t.price)+'</td><td title="'+esc(date(t.createdAt))+'">'+age(t.createdAt)+'</td><td>'+usd(t.volume)+'</td><td>'+count(t.transactions)+'</td><td>'+count(t.traders)+'</td><td>'+count(t.holders)+'</td>'+['5m','1h','6h','24h'].map(w=>'<td class="'+color(t.changes[w])+'">'+percent(t.changes[w])+'</td>').join('')+'<td>'+usd(t.liquidity)+'</td></tr>').join('')||'<tr><td colspan="15" class="empty">'+(state.mode==='watch'?'Your watchlist is empty. Tap ☆ beside any token.':'No markets match these filters.')+'</td></tr>';
 $('result-count').textContent=count(d.total)+' tokens · source coverage totals';
 $('page-label').textContent=d.page+' / '+d.pages;$('page-prev').disabled=d.page<=1;$('page-next').disabled=d.page>=d.pages;
 $('synced').textContent=d.updatedAt?'Updated '+age(d.updatedAt)+' ago':'Syncing…';
 $('tape-items').innerHTML=d.trending.map((t,i)=>'<a class="tape-item" href="/token/'+esc(t.address)+'"><span class="muted">#'+(i+1)+'</span><b>'+esc(t.symbol)+'</b><span class="'+color(t.changes['24h'])+'">'+percent(t.changes['24h'])+'</span></a>').join('');
 $('pulse').innerHTML=d.trending.slice(0,5).map(t=>'<a class="pulse-row" href="/token/'+esc(t.address)+'">'+icon(t)+'<div><b>'+esc(t.symbol)+'</b><small>'+usd(t.volume)+' volume</small></div><span class="'+color(t.changes['24h'])+'">'+percent(t.changes['24h'])+'</span></a>').join('');
 // Source health and the archive prompt are no longer shown in the panel. The data behind them is still
 // served at /api/status, and the archive is still reachable through search and the mode filter.
 $('list-banner').textContent=d.status?.lastError?'Some sources are unavailable. Their last received data is retained.':d.status?.syncing&&!d.rows.length?'Connecting to source feeds…':'';
}
async function search(){
 const query=$('global-search').value.trim(),seq=++searchSeq;searchController?.abort();
 if(!query){$('search-results').hidden=true;return;}searchController=new AbortController();$('search-results').hidden=false;
 $('search-results').innerHTML='<div class="side-note" style="padding:12px">Searching the archive…</div>';
 try{
  const d=await api('/api/markets?q='+encodeURIComponent(query)+'&limit=10',searchController);if(seq!==searchSeq)return;
  $('search-results').innerHTML=d.rows.map(t=>'<a href="/token/'+esc(t.address)+'"><span class="search-token">'+icon(t)+'<span><b>'+esc(t.symbol)+'</b><small>'+esc(t.name)+' · '+esc(sourceName(t.source))+'</small></span></span><span class="mono">'+price(t.price)+'</span></a>').join('')||'<div class="side-note" style="padding:12px">No indexed token found. Coverage depends on the connected sources.</div>';
 }catch(e){if(e.name!=='AbortError'&&seq===searchSeq)$('search-results').textContent='Search unavailable. Try again.';}
}
$('global-search').addEventListener('input',()=>{searchSeq++;searchController?.abort();clearTimeout(searchTimer);searchTimer=setTimeout(search,220);});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('global-search').focus();}if(e.key==='Escape')$('search-results').hidden=true;});
document.addEventListener('click',e=>{if(!e.target.closest('.searchbox'))$('search-results').hidden=true;});
let chart,candleSeries,lineSeries,volumeSeries,chartTokenTf=null;
function detailShell(){
 app.innerHTML='<div id="token-heading" class="token-head"><a class="back" href="/" aria-label="Back to markets">←</a><div class="skeleton" style="width:230px"></div></div><div class="detail-layout"><section class="chart-main"><div class="chart-tools"><div class="timeframes">'+['1m','5m','15m','1h','4h','1d'].map(v=>'<button data-tf="'+v+'" class="'+(v===tf?'active':'')+'">'+v+'</button>').join('')+'</div><div class="chart-actions"><div class="chart-modes" aria-label="Chart scale"><button data-scale="price" class="'+(scaleMode==='price'?'active':'')+'">Price</button><button data-scale="mc" class="'+(scaleMode==='mc'?'active':'')+'">MC</button></div><div class="chart-modes" aria-label="Chart type"><button data-view="candles" class="'+(viewMode==='candles'?'active':'')+'">Candles</button><button data-view="line" class="'+(viewMode==='line'?'active':'')+'">Line</button></div><button id="fit-chart" class="muted">Reset view</button></div></div><div class="chart-legend" id="chart-legend">Loading candles…</div><div class="chart-container" id="chart-container"><div id="chart-empty" class="chart-empty">Connecting to chart data…</div></div><div class="chart-credit">Charts powered by <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a></div><div class="inline-error" id="chart-error"></div><div class="trade-tabs"><button class="panel-tab active" data-panel="trades">TRANSACTIONS</button><button class="panel-tab" data-panel="holders">HOLDERS</button><button class="panel-tab" data-panel="same">SAME TICKER</button><button class="panel-tab" data-panel="map">HOLDER MAP</button><span id="trade-count"></span><span style="margin-left:auto" id="panel-note">Most recent · source feed</span></div><div id="trade-error" class="inline-error"></div><div class="table-scroll" style="min-height:180px;max-height:520px"><table class="trades-table"><thead><tr><th>TIME</th><th>TYPE</th><th>USD</th><th>PRICE</th><th>TRADER</th><th>TXN ↗</th></tr></thead><tbody id="trades"><tr><td colspan="6" class="empty">Loading transactions…</td></tr></tbody></table><table class="trades-table" id="holders-table" hidden><thead><tr><th>#</th><th>HOLDER</th><th>BALANCE</th><th>SHARE</th></tr></thead><tbody id="holders"><tr><td colspan="4" class="empty">Loading holders…</td></tr></tbody></table><table class="trades-table" id="same-table" hidden><thead><tr><th>TOKEN</th><th>SOURCE</th><th>PRICE</th><th>MCAP</th><th>VOLUME</th><th>AGE</th></tr></thead><tbody id="same"><tr><td colspan="6" class="empty">Looking for tokens with this ticker…</td></tr></tbody></table><div id="map-panel" hidden><div class="map-note" id="map-status">Reading the transfer history…</div><div class="map-layout"><div class="map-canvas" id="map-canvas"></div><div class="map-clusters" id="map-clusters"></div></div></div></div></section><aside class="details-side" id="detail-metrics"><div class="skeleton"></div></aside></div>';
 app.addEventListener('click',e=>{const b=e.target.closest('[data-tf]');if(b){tf=b.dataset.tf;history.replaceState(null,'',location.pathname+'?tf='+tf+'&view='+viewMode);document.querySelectorAll('[data-tf]').forEach(x=>x.classList.toggle('active',x===b));loadDetail();}const v=e.target.closest('[data-view]');if(v){viewMode=v.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===v));history.replaceState(null,'',location.pathname+'?tf='+tf+'&view='+viewMode);chartTokenTf=null;if(currentDetail)paintDetail(currentDetail);}const sc=e.target.closest('[data-scale]');if(sc){scaleMode=sc.dataset.scale;document.querySelectorAll('[data-scale]').forEach(x=>x.classList.toggle('active',x===sc));history.replaceState(null,'',location.pathname+'?tf='+tf+'&view='+viewMode+'&scale='+scaleMode);chartTokenTf=null;if(currentDetail)paintDetail(currentDetail);}
  if(e.target.closest('#fit-chart'))chart?.timeScale().fitContent();const copy=e.target.closest('[data-copy]');if(copy)navigator.clipboard.writeText(copy.dataset.copy).then(()=>toast('Address copied')).catch(()=>toast('Copy not available'));const s=e.target.closest('[data-star]');if(s){saveWatch(s.dataset.star);if(currentDetail)paintDetail(currentDetail);}});
}
function setupChart(){
 if(chart)return;
 const node=$('chart-container');
 chart=window.LightweightCharts.createChart(node,{width:node.clientWidth,height:node.clientHeight,layout:{background:{color:'#0a1421'},textColor:'#7089a5',fontFamily:'IBM Plex Mono, monospace',fontSize:10},grid:{vertLines:{color:'#142236'},horzLines:{color:'#142236'}},rightPriceScale:{borderColor:'#24364d',scaleMargins:{top:.07,bottom:.24},autoScale:true},timeScale:{borderColor:'#24364d',timeVisible:true,secondsVisible:false,rightOffset:3,barSpacing:7,minBarSpacing:2},crosshair:{mode:0,vertLine:{color:'#728aa4',width:1,style:3,labelBackgroundColor:'#26415e'},horzLine:{color:'#728aa4',width:1,style:3,labelBackgroundColor:'#26415e'}},handleScroll:true,handleScale:true});
 candleSeries=chart.addCandlestickSeries({upColor:'#39dbaa',downColor:'#ff697c',borderUpColor:'#39dbaa',borderDownColor:'#ff697c',borderVisible:true,wickUpColor:'#39dbaa',wickDownColor:'#ff697c',lastValueVisible:true,priceLineVisible:true,priceFormat:{type:'custom',formatter:price,minMove:.00000001}});
 lineSeries=chart.addLineSeries({color:'#7caaff',lineWidth:2,visible:false,priceFormat:{type:'custom',formatter:price,minMove:.00000001}});
 volumeSeries=chart.addHistogramSeries({priceScaleId:'volume',priceFormat:{type:'volume'},base:0});volumeSeries.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});
 new ResizeObserver(()=>chart.applyOptions({width:node.clientWidth,height:node.clientHeight})).observe(node);
 chart.subscribeCrosshairMove(p=>{const c=p.seriesData.get(candleSeries),l=p.seriesData.get(lineSeries),v=p.seriesData.get(volumeSeries);const volume=v&&valid(v.value)?'   Vol '+usd(v.value):'';const fmt=currentDetail?chartScale(currentDetail.market).format:price;if(c)$('chart-legend').textContent='O '+fmt(c.open)+'   H '+fmt(c.high)+'   L '+fmt(c.low)+'   C '+fmt(c.close)+volume;else if(l)$('chart-legend').textContent='Recorded close '+fmt(l.value)+volume;});
}
// Market cap is price times the supply behind it. The supply is whatever the row itself implies, market
// cap over price, so the chart and the overview can never disagree. Without both numbers there is nothing
// to scale by, and the chart stays on price rather than inventing a supply.
function chartScale(t){
 if(scaleMode!=='mc')return {factor:1,format:price,label:'Price'};
 const supply=valid(t.marketCap)&&valid(t.price)&&t.price>0?t.marketCap/t.price:null;
 return supply>0?{factor:supply,format:usd,label:'Market cap'}:{factor:1,format:price,label:'Price',unavailable:true};
}

function paintDetail(d){
 const t=d.market;document.title=(t.symbol||'Token')+' · UFO Screener';
 $('token-heading').innerHTML='<a class="back" href="/" aria-label="Back to markets">←</a>'+icon(t)+'<div><h1>'+esc(t.symbol)+(t.originalTicker?'<span class="og-tag" title="The oldest contract we have indexed under this ticker">OG</span>':'')+'</h1><span class="muted">'+esc(t.name)+'</span></div><span class="source-badge">'+esc(sourceName(t.source))+'</span><strong class="head-price">'+price(t.price)+'</strong><span class="'+color(t.changes['24h'])+'">'+percent(t.changes['24h'])+'</span><div class="contract">'+star(t.address)+'<span>'+esc(short(t.address))+'</span><button class="icon-btn" data-copy="'+esc(t.address)+'" aria-label="Copy contract address">⧉</button></div>';
 $('detail-metrics').innerHTML='<h2 class="details-title">Market overview</h2><div class="metrics">'+[['Price',price(t.price)],['Market cap',usd(t.marketCap)],['Liquidity',usd(t.liquidity)],['24h volume',usd(t.volume)],['24h transactions',count(t.transactions)],['Holders',count(t.holders)],['Burned supply',valid(t.burned)?count(t.burned)+(valid(t.burnedPercent)?' \u00b7 '+Number(t.burnedPercent).toFixed(2)+'%':''):'\u2014']].map(([label,value])=>'<div class="metric"><small>'+label+'</small><b>'+value+'</b></div>').join('')+'</div><div class="change-grid">'+['5m','1h','6h','24h'].map(w=>'<div><small>'+w.toUpperCase()+'</small><span class="'+color(t.changes[w])+'">'+percent(t.changes[w])+'</span></div>').join('')+'</div>'+
 '<div class="buy-sell"><span class="up">Buys '+count(t.buys)+'</span><span class="down">Sells '+count(t.sells)+'</span></div>'+(valid(t.buys)&&valid(t.sells)&&t.buys+t.sells>0?'<div class="ratio"><span style="width:'+(t.buys/(t.buys+t.sells)*100)+'%"></span></div>':'')+
 '<div class="facts"><div><span>Launchpad</span><span>'+esc(sourceName(t.source))+'</span></div><div><span>Created</span><span title="'+esc(date(t.createdAt))+'">'+since(t.createdAt)+'</span></div><div><span>Last trade</span><span>'+since(t.lastTradeAt)+'</span></div><div><span>Pool</span><span>'+esc(short(t.pool))+'</span></div><div><span>Updated</span><span>'+since(t.updatedAt)+'</span></div></div><div class="socials">'+[['Website',t.website],['X',t.twitter],['Telegram',t.telegram]].filter(([,url])=>safeUrl(url)).map(([label,url])=>'<a href="'+esc(safeUrl(url))+'" target="_blank" rel="noopener noreferrer">'+label+' ↗</a>').join('')+'</div><a class="all-link" href="https://arc-scan.org/address/'+esc(t.address)+'" target="_blank" rel="noopener">View on Arcscan ↗</a><p class="support-note">Source: '+esc(sourceName(t.source))+'. '+(t.stale?'The list snapshot is older than 3 minutes. ':'')+'Missing figures are not estimated.</p>';
 // Only a real failure earns a line here. How the candles were assembled, and whether a refresh is still
 // pending, are not things the reader has to act on, so those notices are not shown.
 $('chart-error').textContent=d.errors?.chart?'Chart refresh unavailable. Previously loaded candles are retained.':'';
 $('trade-error').textContent=d.errors?.trades?'Transaction refresh unavailable.':'';
 if(window.LightweightCharts){setupChart();
 const scale=chartScale(t),k=scale.factor,fmt=scale.format;
 document.querySelectorAll('[data-scale]').forEach(x=>x.classList.toggle('active',x.dataset.scale===scaleMode));
 if(d.candles.length||(viewMode==='line'&&d.closes?.length)){const closing=viewMode==='line'&&d.chartMode==='close',lineOnly=viewMode==='line',base=t.price>0?t.price*k:0,minMove=base>0?Math.pow(10,Math.floor(Math.log10(base))-5):.00000001;
  candleSeries.applyOptions({visible:!closing&&!lineOnly,priceFormat:{type:'custom',formatter:fmt,minMove}});
  lineSeries.applyOptions({visible:closing||lineOnly,color:'#7caaff',priceFormat:{type:'custom',formatter:fmt,minMove}});
  lineSeries.setData(closing?(d.closes||[]).map(c=>({time:c.bucket,value:c.value*k})):(lineOnly?d.candles.map(c=>({time:c.bucket,value:c.close*k})):[]));
  candleSeries.setData((closing?[]:d.candles).map(c=>({time:c.bucket,open:c.open*k,high:c.high*k,low:c.low*k,close:c.close*k})));
  volumeSeries.setData((closing?d.closes:d.candles).filter(c=>valid(c.volume)&&c.volume>=0).map(c=>({time:c.bucket,value:c.volume,color:closing?'#36588280':c.close>=c.open?'#23856c65':'#af435665'})));
  if(chartTokenTf!==tf){chart.timeScale().fitContent();const bars=closing?d.closes.length:d.candles.length;if(bars>120)chart.timeScale().setVisibleLogicalRange({from:bars-120,to:bars+3});chartTokenTf=tf;}$('chart-empty').style.display='none';
  const last=closing?d.closes.at(-1):d.candles.at(-1);$('chart-legend').textContent=(closing||lineOnly)?scale.label+' '+fmt((last.value??last.close)*k)+(valid(last.volume)?'   Vol '+usd(last.volume):''):'O '+fmt(last.open*k)+'   H '+fmt(last.high*k)+'   L '+fmt(last.low*k)+'   C '+fmt(last.close*k)+(valid(last.volume)?'   Vol '+usd(last.volume):'');
  if(scale.unavailable)$('chart-error').textContent='Market cap needs a supply figure this token has not reported; showing price.';
 }else if(!d.errors?.chart||chartTokenTf!==tf){candleSeries.setData([]);lineSeries.setData([]);volumeSeries.setData([]);$('chart-empty').style.display='grid';$('chart-empty').textContent=d.supported?'No candles available for this timeframe.':'Chart integration is not available for this source yet.';$('chart-legend').textContent='No price history';}}
 else{$('chart-empty').textContent='Chart library could not load. Refresh to retry.';}
 if(panel==='trades')$('trade-count').textContent=d.trades.length+' trades';
 $('trades').innerHTML=d.trades.map(s=>'<tr><td title="'+esc(date(s.at))+'">'+age(s.at)+' ago</td><td class="'+(s.buy?'up':'down')+'">'+(s.buy?'Buy':'Sell')+'</td><td>'+usd(s.usd_volume)+'</td><td>'+price(s.price)+'</td><td>'+esc(short(s.trader))+'</td><td>'+(/^0x[0-9a-f]{64}$/i.test(s.tx||'')?'<a href="https://arc-scan.org/tx/'+esc(s.tx)+'" target="_blank" rel="noopener">'+esc(short(s.tx))+' ↗</a>':'—')+'</td></tr>').join('')||'<tr><td colspan="6" class="empty">'+(d.errors?.trades?'Could not load recent trades.':'No recent trades returned by this source.')+'</td></tr>';
}
// The holders panel is fetched only when it is opened, and only once per token, because the list comes
// from somebody else's index and does not change by the second.
let panel='trades',holdersFor=null,holdersController;
function showPanel(name){
 panel=name;
 document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
 const trades=document.querySelector('.trades-table');
 trades.hidden=name!=='trades';$('holders-table').hidden=name!=='holders';$('same-table').hidden=name!=='same';$('map-panel').hidden=name!=='map';
 $('trade-count').textContent=name==='trades'?(currentDetail?currentDetail.trades.length+' trades':''):'';
 $('panel-note').textContent=name==='trades'?'Most recent \u00b7 source feed':name==='holders'?'Largest first':name==='same'?'Same symbol, different contracts':'Links are token transfers between mapped wallets';
 if(name!=='map')stopMap();
 if(name==='holders')loadHolders();
 if(name==='same')loadSame();
 if(name==='map')loadMap();
}

// Holder Maps. Each bubble is one of the token's hundred largest holders, sized by its share. A line means
// those two wallets have moved this token between them, which is the only claim the picture makes.
let mapTimer=null,mapController;
function stopMap(){if(mapTimer){clearTimeout(mapTimer);mapTimer=null;}}
async function loadMap(){
 if(!currentDetail)return;
 stopMap();mapController?.abort();mapController=new AbortController();
 try{
  const d=await api('/api/holder-map/'+encodeURIComponent(address),mapController);
  if(panel!=='map')return;
  if(d.status==='empty'){$('map-status').textContent=d.error||'No holder list available for this token.';$('map-canvas').innerHTML='';$('map-clusters').innerHTML='';return;}
  if(d.status==='unknown'||d.status==='building'){
   const pct=Math.round((d.progress||0)*100);
   $('map-status').textContent='Reading this token\u2019s transfer history\u2026 '+pct+'% of its blocks scanned. The map fills in as it goes.';
   mapTimer=setTimeout(()=>{if(panel==='map')loadMap();},6000);
  }else{
   $('map-status').textContent='Top '+d.holders.length+' holders. A line means these wallets have sent this token to each other. That is a pattern to look at, not proof of one owner: an exchange or a router leaves the same trace.';
  }
  drawMap(d);
 }catch(e){
  if(e.name==='AbortError')return;
  $('map-status').textContent='Holder map unavailable right now.';
 }
}

// A small force layout: linked wallets pull together, everything pushes apart, the frame keeps them in.
function layout(nodes,edges,width,height){
 const index=new Map(nodes.map((n,i)=>[n.id,i]));
 nodes.forEach((n,i)=>{const a=i*2.399963;const r=Math.min(width,height)*.36*Math.sqrt(i/Math.max(1,nodes.length));
  n.x=width/2+Math.cos(a)*r;n.y=height/2+Math.sin(a)*r;n.vx=0;n.vy=0;});
 for(let step=0;step<220;step++){
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i],b=nodes[j];let dx=b.x-a.x,dy=b.y-a.y;let d=Math.hypot(dx,dy)||.01;
   const want=a.r+b.r+10,push=(d<want?(want-d)*.5:0)+320/(d*d);
   dx/=d;dy/=d;a.vx-=dx*push;a.vy-=dy*push;b.vx+=dx*push;b.vy+=dy*push;
  }
  for(const e of edges){
   const a=nodes[index.get(e.from)],b=nodes[index.get(e.to)];
   if(!a||!b)continue;
   const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.01,pull=(d-(a.r+b.r+34))*.03;
   a.vx+=dx/d*pull;a.vy+=dy/d*pull;b.vx-=dx/d*pull;b.vy-=dy/d*pull;
  }
  for(const n of nodes){
   n.vx+=(width/2-n.x)*.004;n.vy+=(height/2-n.y)*.004;
   n.x+=n.vx*.5;n.y+=n.vy*.5;n.vx*=.82;n.vy*=.82;
   n.x=Math.max(n.r+2,Math.min(width-n.r-2,n.x));n.y=Math.max(n.r+2,Math.min(height-n.r-2,n.y));
  }
 }
 return nodes;
}

const CLUSTER_COLOURS=['#39dbaa','#7caaff','#d98cf0','#f0b357','#6fd2e8','#ef7f8d','#9ee87a','#c0a3ff'];

function drawMap(d){
 const width=760,height=420;
 const cluster=new Map();
 d.clusters.forEach((c,i)=>c.members.forEach(m=>cluster.set(m,i)));
 const max=Math.max(...d.holders.map(h=>Number(h.share)||0),.0001);
 const nodes=d.holders.map(h=>({id:h.address,share:Number(h.share)||0,label:h.label,contract:h.contract,
  r:6+Math.sqrt((Number(h.share)||0)/max)*26,group:cluster.has(h.address)?cluster.get(h.address):null}));
 layout(nodes,d.edges,width,height);
 const at=new Map(nodes.map(n=>[n.id,n]));
 const lines=d.edges.map(e=>{const a=at.get(e.from),b=at.get(e.to);return a&&b?'<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="#3d5b86" stroke-width="'+Math.min(3,1+Math.log10(e.count||1))+'"/>':'';}).join('');
 const bubbles=nodes.map(n=>{
  const colour=n.group==null?(n.contract?'#41536d':'#43608c'):CLUSTER_COLOURS[n.group%CLUSTER_COLOURS.length];
  return '<a href="https://arc-scan.org/address/'+esc(n.id)+'" target="_blank" rel="noopener"><circle cx="'+n.x.toFixed(1)+'" cy="'+n.y.toFixed(1)+'" r="'+n.r.toFixed(1)+'" fill="'+colour+'" fill-opacity="'+(n.group==null?.45:.75)+'" stroke="'+colour+'"><title>'+esc(short(n.id))+(n.label?' \u00b7 '+esc(n.label):'')+(n.contract?' \u00b7 contract':'')+' \u00b7 '+n.share.toFixed(2)+'%</title></circle></a>';
 }).join('');
 $('map-canvas').innerHTML='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Holder map">'+lines+bubbles+'</svg>';
 $('map-clusters').innerHTML='<h3>Clusters</h3>'+(d.clusters.length?d.clusters.map((c,i)=>'<div class="cluster"><div class="cluster-head"><span class="cluster-dot" style="background:'+CLUSTER_COLOURS[i%CLUSTER_COLOURS.length]+'"></span><b>Cluster '+(i+1)+'</b><span class="muted">'+c.members.length+' wallets</span><span class="cluster-share">'+c.share.toFixed(2)+'%</span></div>'+c.members.map(m=>'<a class="cluster-wallet" href="https://arc-scan.org/address/'+esc(m)+'" target="_blank" rel="noopener">'+esc(short(m))+' \u2197</a>').join('')+'</div>').join(''):'<p class="side-note">No two of these wallets have moved this token between them.</p>');
}

// Tokens trading under the same ticker. A symbol is not unique on chain, so the list is there to let the
// reader check they are looking at the contract they meant, not to suggest any of them is the real one.
let sameFor=null,sameController;
async function loadSame(){
 if(!currentDetail||sameFor===address)return;
 const symbol=String(currentDetail.market?.symbol||'').trim();
 if(!symbol){$('same').innerHTML='<tr><td colspan="6" class="empty">This token has no symbol to match.</td></tr>';return;}
 sameFor=address;sameController?.abort();sameController=new AbortController();
 try{
  const d=await api('/api/markets?mode=all&limit=100&q='+encodeURIComponent(symbol),sameController);
  const matching=d.rows.filter(r=>String(r.symbol||'').toLowerCase()===symbol.toLowerCase());
  const dated=matching.filter(r=>valid(r.createdAt)).sort((a,b)=>a.createdAt-b.createdAt);
  // Only an outright oldest earns the mark; a shared earliest date leaves it off.
  const oldest=dated.length&&!(dated[1]&&dated[1].createdAt===dated[0].createdAt)?dated[0].address:null;
  const rows=matching.filter(r=>r.address!==address);
  if(panel==='same')$('trade-count').textContent=rows.length?count(rows.length)+' other'+(rows.length===1?'':'s'):'';
  if(!rows.length){
   sameFor=null;
   $('same').innerHTML='<tr><td colspan="6" class="empty">No other token is trading under this ticker.</td></tr>';return;
  }
  $('same').innerHTML=rows.map(r=>'<tr class="same-row"><td><a class="token-cell" href="/token/'+esc(r.address)+'">'+icon(r)+'<span><strong>'+esc(r.symbol||'?')+(r.address===oldest?'<span class="og-tag" title="The oldest contract we have indexed under this ticker">OG</span>':'')+'</strong><small class="muted">'+esc(short(r.address))+'</small></span></a></td><td class="muted">'+esc(sourceName(r.source))+'</td><td>'+price(r.price)+'</td><td>'+usd(r.marketCap)+'</td><td>'+usd(r.volume)+'</td><td>'+age(r.createdAt)+'</td></tr>').join('');
 }catch(e){
  if(e.name==='AbortError')return;
  sameFor=null;
  $('same').innerHTML='<tr><td colspan="6" class="empty">Ticker search unavailable right now.</td></tr>';
 }
}
async function loadHolders(){
 if(!currentDetail||holdersFor===address)return;
 holdersFor=address;holdersController?.abort();holdersController=new AbortController();
 try{
  const d=await api('/api/holders/'+encodeURIComponent(address)+'?source='+encodeURIComponent(currentDetail.market?.source||'')+'&pool='+encodeURIComponent(currentDetail.market?.pool||''),holdersController);
  if(panel!=='holders'&&holdersFor!==address)return;
  $('trade-count').textContent='';
  if(!d.holders.length){
   holdersFor=null;   // a failed read should be retried when the tab is opened again
   $('holders').innerHTML='<tr><td colspan="4" class="empty">Holder list unavailable for this token right now.</td></tr>';return;
  }
  if(valid(d.count)&&panel==='holders')$('trade-count').textContent=count(d.count)+' holders';
  $('holders').innerHTML=d.holders.map((h,i)=>'<tr><td>'+(i+1)+'</td><td><a href="https://arc-scan.org/address/'+esc(h.address)+'" target="_blank" rel="noopener">'+esc(short(h.address))+' \u2197</a>'+(h.label?'<span class="holder-tag">'+esc(h.label)+'</span>':'')+'</td><td>'+count(h.balance)+'</td><td>'+(valid(h.share)?Number(h.share).toFixed(2)+'%':'\u2014')+'</td></tr>').join('');
 }catch(e){
  if(e.name==='AbortError')return;
  holdersFor=null;
  $('holders').innerHTML='<tr><td colspan="4" class="empty">Holder list unavailable right now.</td></tr>';
 }
}
async function loadDetail(){
 const seq=++detailSeq;detailController?.abort();detailController=new AbortController();
 try{const d=await api('/api/market/'+encodeURIComponent(address)+'?tf='+tf,detailController);if(seq!==detailSeq)return;currentDetail=d;paintDetail(d);}
 catch(e){if(e.name==='AbortError')return;$('chart-error').textContent=e.message;if(!currentDetail){$('chart-empty').textContent='Token data is unavailable.';$('detail-metrics').textContent=e.message;}}
}
if(address){detailShell();loadDetail();
 app.addEventListener('click',e=>{const b=e.target.closest('[data-panel]');if(b)showPanel(b.dataset.panel);});
}else{listShell();loadList();}
setInterval(()=>{if(!document.hidden){if(address)loadDetail();else loadList();}},15000);
setInterval(()=>{if(!document.hidden&&address&&currentDetail?.cache?.pending)loadDetail();},3000);
