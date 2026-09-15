import test from 'node:test';
import assert from 'node:assert/strict';
import {walletAmount,walletNotice} from '../public/wallet-ui.js';
test('wallet display preserves tiny holdings and labels unknown units',()=>{
 assert.equal(walletAmount({balance:1e-18}),'0.000000000000000001');
 assert.match(walletAmount({balance:null,balanceRaw:'42'}),/42 raw units/);
});
test('partial and pending scans never appear complete',()=>{
 assert.match(walletNotice({pending:true,pages:2}),/Loading/);
 assert.match(walletNotice({errors:{tokens:'offline'}}),/incomplete/);
 assert.match(walletNotice({totals:{partial:true}}),/Known value only/);
});
