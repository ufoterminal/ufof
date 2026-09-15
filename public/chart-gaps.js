// Carry the last execution through inactive buckets; never invent trades or volume.
export function fillChartGaps(candles,seconds,now=Date.now()/1000,limit=500){
 if(!candles?.length||!(seconds>0))return candles||[];
 const ordered=[...candles].sort((a,b)=>a.bucket-b.bucket);
 const end=Math.floor(now/seconds)*seconds,start=Math.max(ordered[0].bucket,end-(limit-1)*seconds);
 const byTime=new Map(ordered.map(c=>[c.bucket,c]));
 let previous=ordered.filter(c=>c.bucket<start).at(-1)?.close,result=[];
 for(let bucket=start;bucket<=end;bucket+=seconds){
  const c=byTime.get(bucket);
  if(c){result.push(c);previous=c.close;}
  else if(Number.isFinite(previous)&&previous>0)result.push({bucket,open:previous,high:previous,low:previous,close:previous,volume:0,trades:0,empty:true});
 }
 return result;
}
