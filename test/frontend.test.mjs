import test from 'node:test';
import assert from 'node:assert/strict';
import {price,percent,color,esc,safeUrl,age,since,icon} from '../public/ui-utils.js';
test('sub-cent prices retain significant digits',()=>{
 assert.equal(price(.0000001234567),'$0.000000123457');
 assert.equal(price(null),'—');assert.equal(price(0),'$0');
});
test('missing numbers and timestamps stay unknown',()=>{
 assert.equal(percent(null),'—');assert.equal(color(null),'muted');
 assert.equal(age(null),'—');assert.equal(since(null),'—');assert.equal(percent(0),'0.00%');
});
test('token text is escaped and executable URLs rejected',()=>{
 assert.equal(esc('<img>'),'&lt;img&gt;');
 assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('data:text/html,test'),null);
 assert.ok(!icon({symbol:'X',logo:'javascript:alert(1)'}).includes('<img'));
});

// The detail panel switches between transactions and holders, and informational chart notes are not
// shown as warnings. These read the shipped files so a regression in either is caught.
import {readFileSync} from 'node:fs';
const terminal=readFileSync(new URL('../public/terminal.js',import.meta.url),'utf8');
test('the holders tab exists alongside transactions',()=>{
 assert.ok(terminal.includes('data-panel="holders"'),'holders tab is rendered');
 assert.ok(terminal.includes("id=\"holders-table\""),'holders table is rendered');
 assert.ok(terminal.includes('/api/holders/'),'holders are fetched from our own endpoint');
});
test('only a real chart failure is shown as a warning',()=>{
 const line=terminal.split('\n').find(l=>l.includes("$('chart-error').textContent=d."));
 assert.ok(line&&!line.includes('chartNotice'),'the assembly notice is not surfaced');
 assert.ok(line&&!line.includes('background refresh is pending'),'a pending refresh is not a warning');
 assert.ok(line&&line.includes('errors?.chart'),'a failed chart refresh is still reported');
});

test('burned supply has a place in the market overview',()=>{
 assert.ok(terminal.includes("<span>Burned</span>"),'the figure is rendered');
 assert.ok(terminal.includes('burnParts(t,count)'),'the amount taken out of supply and its share are both shown');
});

test('the chart can be shown as price or as market cap',()=>{
 assert.ok(terminal.includes('data-scale="price"')&&terminal.includes('data-scale="mc"'),'both buttons exist');
 assert.ok(terminal.includes('t.marketCap/t.price'),'supply comes from the row itself, so the chart agrees with the overview');
});

test('the side panel no longer carries the source health list or the archive prompt',()=>{
 assert.ok(!terminal.includes('Connected sources'),'source health section removed');
 assert.ok(!terminal.includes('LOOKING BACK'),'archive prompt removed');
 assert.ok(!terminal.includes("$('source-health')")&&!terminal.includes("$('source-count')"),'nothing writes to the removed nodes');
 assert.ok(terminal.includes('Market pulse'),'the pulse section stays');
});

test('a same ticker tab lists other tokens under the symbol and links to them',()=>{
 assert.ok(terminal.includes('data-panel="same"'),'the tab exists');
 assert.ok(terminal.includes("id=\"same-table\""),'its table is rendered');
 assert.ok(terminal.includes("String(r.symbol||'').toLowerCase()===symbol.toLowerCase()"),'only an exact symbol match counts');
 assert.ok(terminal.includes("r.address!==address"),'the token being viewed is not listed against itself');
});

test('the site is branded UFO Screener with an animated craft',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/terminal.css',import.meta.url),'utf8');
 assert.ok(html.includes('<b>UFO</b>')&&html.includes('<small>SCREENER</small>'),'the word mark reads UFO over SCREENER');
 assert.ok(html.includes('UFO Screener \u00b7 Arc token markets'),'the page title carries the name');
 assert.ok(!/ARC\s*RADAR/i.test(html),'the old name is gone');
 assert.ok(css.includes('@keyframes ufo-hover'),'the craft moves');
 assert.ok(css.includes('prefers-reduced-motion'),'motion is dropped when the system asks for less');
});

test('the holder map has a tab, a canvas and a cluster list',()=>{
 assert.ok(terminal.includes('data-panel="map"'),'the tab exists');
 assert.ok(terminal.includes('id="map-canvas"')&&terminal.includes('id="map-clusters"'),'both halves are rendered');
 assert.ok(terminal.includes('/api/holder-map/'),'it reads our own endpoint');
 assert.ok(terminal.includes('not proof of one owner'),'the picture states what it does not prove');
});

test('the market row is trimmed to fit a laptop screen without sideways scrolling',()=>{
 const css=readFileSync(new URL('../public/terminal.css',import.meta.url),'utf8');
 assert.ok(css.includes('.market-table .token-cell{max-width:170px}'),'the name column is capped');
 assert.ok(css.includes('text-overflow:ellipsis'),'a long name is clipped rather than widening the row');
 assert.ok(/\.market-table th,\.market-table td\{padding-left:8px/.test(css),'the number columns give up a little padding');
});

test('launchpad labels use provenance, not the market data source',()=>{
 assert.ok(terminal.includes('launchpadId(t.launchpad)'));
 assert.ok(terminal.includes('launchpad-filter'));
 assert.ok(terminal.includes("paintPadBadges($('market-rows'),d.rows)"));
 assert.ok(terminal.includes("paintPadBadges($('search-results'),d.rows)"));
});

test('an address that is not a listed token is offered as a wallet',()=>{
 assert.ok(terminal.includes("href=\"/wallet/"),'search can lead to a wallet page');
 assert.ok(terminal.includes("!d.rows.some(t=>t.address===query.toLowerCase())"),'a token address still shows the token first');
 assert.ok(terminal.includes("id=\"wallet-rows\""),'the wallet page renders holdings');
});

test('USDC carries its own mark on a wallet page',()=>{
 assert.ok(terminal.includes('function usdcMark()'),'the mark is drawn inline');
 assert.ok(terminal.includes('usdcMark()'),'and used for the gas token row');
 assert.ok(!/token-icon">\$</.test(terminal),'the bare dollar sign is gone');
});

test('search results are ranked by what a token is worth, not its unit price',()=>{
 const line=terminal.split('\n').find(l=>l.includes("search-results').innerHTML=asWallet"));
 assert.ok(line.includes('valid(t.marketCap)?usd(t.marketCap)'),'market cap is shown');
 assert.ok(!line.includes('price(t.price)'),'the unit price is not');
});

test('the open candle carries the price the header shows',()=>{
 assert.ok(terminal.includes('function withLivePrice('),'the helper exists');
 assert.ok(terminal.includes('withLivePrice(d.candles,t.price,TIMEFRAME_SECONDS[tf])'),'it is applied per timeframe');
 assert.ok(terminal.includes('updateSeries(candleSeries,(closing?[]:live)'),'the chart incrementally draws the adjusted series');
});

test('chart colours are deep enough for the axis label to read white',()=>{
 assert.ok(terminal.includes("upColor:'#17a97f'")&&terminal.includes("downColor:'#e03b53'"),'candles use the deeper pair');
 assert.ok(!terminal.includes("upColor:'#39dbaa'"),'the bright pair that produced dark label text is gone');
});
