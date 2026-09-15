// One live read per watched token per process, not per connected browser.
export function createEventStream(readLive,events,{interval=1500,maxClients=250,maxTopics=64}={}){
 const clients=new Set(),topics=new Map();let timer=null,closed=false,running=false;
 const send=(client,event,data)=>{
  if(client.res.destroyed||client.res.writableEnded)return;
  if(!client.res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'))client.res.destroy();
 };
 const changed=({token,tf}={})=>{
  for(const c of clients){if(!c.token)send(c,'markets',{});else if(token===c.token)send(c,'chart',{tf});}
 };
 events.on('changed',changed);
 async function tick(){
  if(running||closed)return;running=true;
  const entries=[...topics.entries()];let i=0;
  await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
   while(i<entries.length){const [token,state]=entries[i++];
    try{
     const data=await readLive(token);if(closed||topics.get(token)!==state)continue;
     // Transport timestamps alone are not new market data.
     const hash=JSON.stringify(data&&{...data,receivedAt:null,packetAt:null});
     if(hash!==state.hash){state.hash=hash;state.data=data;for(const c of clients)if(c.token===token)send(c,'live',data);}
    }catch{for(const c of clients)if(c.token===token)send(c,'feed-error',{});}
   }
  }));
  running=false;if(!closed&&clients.size)timer=setTimeout(tick,interval);else timer=null;
 }
 function handler(req,res){
  const token=String(req.query.token||'').toLowerCase();
  if(token&&!/^0x[0-9a-f]{40}$/.test(token))return res.status(400).end();
  if(closed||clients.size>=maxClients||(token&&!topics.has(token)&&topics.size>=maxTopics))return res.status(503).end();
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});
  res.flushHeaders();res.write('retry: 3000\n\n');
  const c={res,token};clients.add(c);
  if(token){if(!topics.has(token))topics.set(token,{hash:null,data:null,count:0});const state=topics.get(token);state.count++;if(state.data)send(c,'live',state.data);}
  send(c,'ready',{});
  const heartbeat=setInterval(()=>{if(!res.write(': heartbeat\n\n'))res.destroy();},15000);heartbeat.unref?.();
  res.on('close',()=>{clearInterval(heartbeat);clients.delete(c);if(token){const state=topics.get(token);if(state&&!--state.count)topics.delete(token);}if(!clients.size&&timer){clearTimeout(timer);timer=null;}});
  if(!timer&&!running){timer=setTimeout(tick,0);}
 }
 return {handler,close(){closed=true;clearTimeout(timer);events.off('changed',changed);for(const c of clients)c.res.end();clients.clear();topics.clear();}};
}
