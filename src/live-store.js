import {q} from './db.js';
import {marketEvents} from './market-events.js';
let ready;
export const initLiveStore=()=>ready??=q(`CREATE TABLE IF NOT EXISTS live_packets(
 token TEXT PRIMARY KEY,payload JSONB,updated BIGINT NOT NULL DEFAULT 0,
 watched_until BIGINT NOT NULL DEFAULT 0,next_at BIGINT NOT NULL DEFAULT 0,
 lease_until BIGINT NOT NULL DEFAULT 0,error TEXT);`);
export async function requestLive(token){
 await initLiveStore();
 await q(`INSERT INTO live_packets(token,watched_until) VALUES($1,$2)
 ON CONFLICT(token) DO UPDATE SET watched_until=GREATEST(live_packets.watched_until,excluded.watched_until)`,[token,Date.now()+90000]);
}
export async function readLivePacket(token){
 await initLiveStore();
 const row=(await q('SELECT payload,updated,error FROM live_packets WHERE token=$1',[token]))[0];
 if(!row?.payload)return null;
 return {...row.payload,packetAt:Number(row.updated),stale:!!row.error||Date.now()-Number(row.updated)>15000||!!row.payload.stale};
}
export async function claimLive(){
 await initLiveStore();const now=Date.now();
 return (await q(`UPDATE live_packets SET lease_until=$2 WHERE token IN (
 SELECT token FROM live_packets WHERE watched_until>$1 AND next_at<=$1 AND lease_until<$1
 ORDER BY next_at,token LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING token`,[now,now+60000]))[0];
}
export async function finishLive(token,payload,error){
 await initLiveStore();
 if(error||!payload)await q('UPDATE live_packets SET lease_until=0,next_at=$2,error=$3 WHERE token=$1',[token,Date.now()+10000,error||'No live data']);
 else {
  const old=await readLivePacket(token);
  await q('UPDATE live_packets SET payload=$2::jsonb,updated=$3,lease_until=0,next_at=$4,error=NULL WHERE token=$1',[token,JSON.stringify(payload),Date.now(),Date.now()+3000]);
  if(old?.market?.price!==payload.market?.price||old?.lastTradeAt!==payload.lastTradeAt)marketEvents.emit('changed',{token,live:true});
 }
}
export async function seedLive(){
 await initLiveStore();
 await q(`INSERT INTO live_packets(token,watched_until)
 SELECT address,$1 FROM tokens WHERE metadata->>'feed_schema'='2'
 ORDER BY COALESCE((metadata->>'volume24h')::numeric,0) DESC LIMIT 32
 ON CONFLICT(token) DO UPDATE SET watched_until=GREATEST(live_packets.watched_until,excluded.watched_until)`,[Date.now()+90000]);
}
export async function liveStoreStatus(){
 await initLiveStore();
 return (await q(`SELECT COUNT(*)::int AS tracked,COUNT(*) FILTER(WHERE watched_until>$1)::int AS active,
 COUNT(*) FILTER(WHERE lease_until>$1)::int AS running,COUNT(*) FILTER(WHERE error IS NOT NULL)::int AS errors,
 COUNT(*) FILTER(WHERE payload IS NOT NULL)::int AS packets,MAX(updated) AS lastUpdated FROM live_packets`,[Date.now()]))[0];
}
