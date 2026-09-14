// Keep history and DOM nodes intact while live data changes at the head.
const history=new WeakMap();
export function burnPercent(value){
 if(value==null||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)return '—';
 const n=Number(value);
 return n>0&&n<0.01?'%<0,01':'%'+n.toLocaleString('tr-TR',{maximumFractionDigits:2});
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
