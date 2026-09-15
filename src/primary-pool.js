export function primaryPool(candidates=[],fallback=null){
 const ranked=candidates.map(p=>({p,value:p.liquidityUsdc??p.liquidity})).filter(x=>x.p.pool&&x.value!=null&&Number.isFinite(Number(x.value))&&Number(x.value)>0).sort((a,b)=>Number(b.value)-Number(a.value));
 if(!ranked.length)return fallback;
 const current=ranked.find(x=>x.p.pool.toLowerCase()===fallback?.toLowerCase());
 // Avoid switching between near-equal pools every refresh.
 return current&&Number(current.value)>=Number(ranked[0].value)*.9?current.p.pool:ranked[0].p.pool;
}
