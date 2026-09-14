// Keep history and DOM nodes intact while live data changes at the head.
const history=new WeakMap();
export function burnPercent(value){
 if(value==null||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)return '—';
 const n=Number(value);
 return n>0&&n<0.01?'%<0,01':'%'+n.toLocaleString('tr-TR',{maximumFractionDigits:2});
}
// The burn reads as how much supply is gone and what share of it that is. Either half alone is still
// worth showing: an amount without a supply to measure it against, or a share whose amount is dust.
export function burnParts(market,count){
 const amount=Number.isFinite(Number(market.burned))&&Number(market.burned)>0?count(market.burned):null;
 const share=burnPercent(market.burnedPercent??market.deadBurnedPercent);
 return {amount,share:share==='—'?null:share,unknown:market.burnLoading?'Reading…':'—'};
}
export function burnText(market,count){
 const {amount,share,unknown}=burnParts(market,count);
 return amount&&share?amount+' · '+share:amount||share||unknown;
}
// A feed that fails one round keeps its last data and the chain keeps pricing its tokens, so that alone is
// not worth a warning: with eleven upstream feeds one of them failed most rounds and the notice never went
// away. Only a list that has actually stopped refreshing is flagged.
export function syncNotice(status,generatedAt,hasRows){
 if(status?.lastSync)return generatedAt-status.lastSync>300?'Market data has not refreshed for a few minutes. Showing the last received data.':'';
 if(status?.syncing)return hasRows?'':'Connecting to source feeds…';
 return status?.lastError?'Market data could not be refreshed. Retrying automatically.':'';
}
export function updateSeries(series,rows,reset=false){
 const old=history.get(series);
 let appendOnly=!reset&&old&&rows.length>=old.length&&old.length>0;
 if(appendOnly)for(let i=0;i<old.length-1;i++)if(JSON.stringify(old[i])!==JSON.stringify(rows[i])){appendOnly=false;break;}
 if(appendOnly&&rows[old.length-1]?.time!==old.at(-1).time)appendOnly=false;
 if(!appendOnly)series.setData(rows);
 else for(let i=old.length-1;i<rows.length;i++)if(JSON.stringify(old[i])!==JSON.stringify(rows[i]))series.update(rows[i]);
 history.set(series,rows);
}
export function tradeKey(s){
 return String(s.id??JSON.stringify([s.tx,s.logIndex??s.log_index,s.at,s.price,s.usd_volume,s.buy,s.trader]));
}
export function reconcileTrades(body,trades,render,empty){
 const scroll=body.closest('.table-scroll'),top=scroll?.scrollTop||0;
 const anchor=top>0?[...body.children].find(n=>n.offsetTop+n.offsetHeight>=top):null;
 const offset=anchor?anchor.offsetTop-top:0;
 const existing=new Map([...body.children].filter(n=>n.dataset.tradeKey).map(n=>[n.dataset.tradeKey,n]));
 const initial=existing.size===0,seen=new Set();let position=0;
 for(const s of trades.slice(0,100)){
  const key=tradeKey(s);if(seen.has(key))continue;seen.add(key);
  let node=existing.get(key);const html=render(s);
  if(!node){node=body.ownerDocument.createElement('tr');node.dataset.tradeKey=key;if(!initial)node.className='trade-arrival';}
  if(node.innerHTML!==html)node.innerHTML=html;
  const at=body.children[position++];if(at!==node)body.insertBefore(node,at||null);
 }
 for(const node of [...body.children])if(!seen.has(node.dataset.tradeKey))node.remove();
 if(!seen.size)body.innerHTML=empty;
 if(scroll&&anchor?.isConnected)scroll.scrollTop=anchor.offsetTop-offset;
}
