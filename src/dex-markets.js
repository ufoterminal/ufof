import {cachedJson,normalizeDirect} from './direct.js';
const pads={radar:'radardex',radardex:'radardex',tolly:'tolly',sharc:'sharc',dyor:'dyor',warp:'circlewarp',circlewarp:'circlewarp',archemist:'archemist',poolstrade:'pools-trade',noxa:'noxa',argus:'argus'};
export function dexVenues(t){return [...(t.versions?.includes('v3')?['uniswap-v3']:[]),...(t.versions?.includes('v4')?['uniswap-v4']:[]),...(t.versions?.includes('v2')&&t.v2Dexes?.includes('dyor')?['dyorswap-v2']:[])];}
export function normalizeDex(payload){
 const rows=[];
 for(const t of payload.tokens||[]){
  const venues=dexVenues(t);if(!venues.length)continue;
  const tag=String(t.launchpad||(t.launched===true?'radar':'')).toLowerCase();
  // An unknown launchpad is not evidence of an independent Uniswap launch.
  if(tag&&!pads[tag])continue;
  const source=pads[tag]||(venues.includes('dyorswap-v2')?'dyorswap-v2':'uniswap');
  const [r]=normalizeDirect('pools-trade',{tokens:[{...t,launchpad:'poolstrade'}]});if(!r)continue;
  rows.push({...r,launchpad_id:source,metadata:{...r.metadata,source,venues,dex_fallback:true,
   chart_provider:'indexed-market',dex_primary:t.topVersion==='v2'&&t.topDex==='dyor',upstream_launchpad:tag||null,launchpad_origin:pads[tag]||null}});
 }
 return rows;
}
export async function dexMarkets(query){
 if(query)return normalizeDex(await cachedJson('https://api.radardex.pro/tokens?q='+encodeURIComponent(query)+'&sort=volume24&dir=desc&window=24h&limit=100',30000));
 const pages=await Promise.all(['v3','v4','v2'].map(version=>cachedJson('https://api.radardex.pro/tokens?version='+version+'&sort=volume24&dir=desc&window=24h&limit=500',60000)));
 return normalizeDex({tokens:[...new Map(pages.flatMap(p=>p.tokens||[]).map(t=>[t.address,t])).values()]});
}
