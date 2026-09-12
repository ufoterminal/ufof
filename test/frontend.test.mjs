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
 assert.ok(terminal.includes("'Burned supply'"),'the metric is rendered');
 assert.ok(terminal.includes('t.burnedPercent'),'its share of supply is shown when known');
});

test('the chart can be shown as price or as market cap',()=>{
 assert.ok(terminal.includes('data-scale="price"')&&terminal.includes('data-scale="mc"'),'both buttons exist');
 assert.ok(terminal.includes('t.marketCap/t.price'),'supply comes from the row itself, so the chart agrees with the overview');
});
