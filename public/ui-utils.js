import {SOURCES} from './sources.js';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const valid=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n));
export const price=n=>!valid(n)?'—':'$'+Number(n).toLocaleString('en-US',{maximumSignificantDigits:6});
export const usd=n=>!valid(n)?'—':'$'+Number(n).toLocaleString('en-US',{notation:Math.abs(n)>=10000?'compact':'standard',maximumFractionDigits:2});
export const count=n=>!valid(n)?'—':Number(n).toLocaleString('en-US',{notation:Math.abs(n)>=10000?'compact':'standard',maximumFractionDigits:1});
export const percent=n=>!valid(n)?'—':(n>0?'+':'')+Number(n).toFixed(2)+'%';
export const color=n=>!valid(n)||Number(n)===0?'muted':n>0?'up':'down';
export const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'—';
export function age(t){if(!valid(t)||Number(t)<=0)return '—';const d=Math.max(0,Date.now()/1000-t);return d<60?Math.floor(d)+'s':d<3600?Math.floor(d/60)+'m':d<86400?Math.floor(d/3600)+'h':Math.floor(d/86400)+'d';}
export const date=t=>valid(t)&&t>0?new Date(t*1000).toLocaleString():'Unknown';
export const since=t=>valid(t)&&t>0?age(t)+' ago':'—';
export function safeUrl(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export const sourceName=s=>SOURCES[s]?.label||s||'Unknown';
export function icon(t){const src=safeUrl(t.logo);return '<span class="token-icon">'+esc((t.symbol||'?').slice(0,2))+(src?'<img loading="lazy" referrerpolicy="no-referrer" src="'+esc(src)+'" alt="">':'')+'</span>';}
export function spark(values,change){const vs=(values||[]).filter(valid).map(Number);if(vs.length<2)return '<span class="muted">—</span>';const min=Math.min(...vs),span=Math.max(...vs)-min||1;const points=vs.map((v,i)=>(i/(vs.length-1)*88).toFixed(1)+','+(27-(v-min)/span*24).toFixed(1)).join(' ');return '<svg class="spark" viewBox="0 0 88 30" aria-label="Price trend"><polyline points="'+points+'" fill="none" stroke="'+(change<0?'#ff697c':'#39dbaa')+'" stroke-width="1.5" stroke-linejoin="round"/></svg>';}
