// Both HTTP fallback and SSE consume one computation per token per process.
export function sharedLive(read,{ttl=1000,maxEntries=500,maxFlights=16,now=Date.now}={}){
 const cache=new Map(),flights=new Map();
 return async key=>{
  const saved=cache.get(key);
  if(saved&&saved.until>now())return saved.value;
  if(flights.has(key))return flights.get(key);
  if(flights.size>=maxFlights)throw Error('Live readers busy; retry shortly');
  const job=Promise.resolve().then(()=>read(key)).then(value=>{
   if(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
   cache.set(key,{value,until:now()+ttl});return value;
  }).finally(()=>flights.delete(key));
  flights.set(key,job);return job;
 };
}
