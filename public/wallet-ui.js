export function walletAmount(t){
 return t.balance==null?(t.balanceRaw+' raw units (decimals unknown)'):Number(t.balance).toLocaleString('en-US',{maximumSignificantDigits:8});
}
export function walletNotice(d){
 if(d.pending)return 'Loading balances · '+(d.pages||0)+' pages read · results appear as they arrive';
 if(d.errors?.tokens)return 'Explorer unavailable or incomplete · showing the balances received · retrying';
 if(d.stale)return 'Some balances are delayed · showing the last successful readings';
 if(d.totals?.partial)return 'Known value only · unpriced tokens or USDC balance remain unknown';
 return 'Explorer scan complete · valued with site prices';
}
