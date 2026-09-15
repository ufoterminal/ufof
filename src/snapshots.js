import {q} from './db.js';
import {marketEvents} from './market-events.js';
export const frames=['1m','5m','15m','1h','4h','1d'];
let ready;
export const initSnapshots=()=>ready??=q(`CREATE TABLE IF NOT EXISTS market_snapshots_v3(
 token TEXT NOT NULL,tf TEXT NOT NULL,payload JSONB NOT NULL,updated BIGINT NOT NULL,PRIMARY KEY(token,tf));
 CREATE TABLE IF NOT EXISTS market_jobs_v3(token TEXT NOT NULL,tf TEXT NOT NULL,next_at BIGINT NOT NULL DEFAULT 0,
 priority INTEGER NOT NULL DEFAULT 0,lease_until BIGINT NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,error TEXT,
 PRIMARY KEY(token,tf)); CREATE INDEX IF NOT EXISTS market_jobs_due ON market_jobs_v3(next_at,lease_until);`);
export async function requestSnapshot(token,tf,priority=0){
 await initSnapshots();
 await q(`INSERT INTO market_jobs_v3(token,tf,priority) VALUES($1,$2,$3)
 ON CONFLICT(token,tf) DO UPDATE SET priority=GREATEST(market_jobs_v3.priority,excluded.priority),
 next_at=CASE WHEN excluded.priority>0 THEN LEAST(market_jobs_v3.next_at,$4) ELSE market_jobs_v3.next_at END`,[token,tf,priority,Date.now()+15000]);
}
export async function readSnapshot(token,tf){
 await initSnapshots();return (await q('SELECT payload,updated FROM market_snapshots_v3 WHERE token=$1 AND tf=$2',[token,tf]))[0]||null;
}
export async function publishSnapshot(token,tf,payload){
 await initSnapshots();
 // An upstream outage must never replace a useful chart with an empty result.
 if(!payload?.candles?.length)throw Error(payload?.errors?.detail||payload?.errors?.chart||'No validated candles available');
 await q(`INSERT INTO market_snapshots_v3(token,tf,payload,updated) VALUES($1,$2,$3::jsonb,$4)
 ON CONFLICT(token,tf) DO UPDATE SET payload=excluded.payload,updated=excluded.updated`,[token,tf,JSON.stringify(payload),Date.now()]);
 marketEvents.emit('changed',{token,tf});
}
export async function claimJob(){
 await initSnapshots();const now=Date.now();
 return (await q(`UPDATE market_jobs_v3 SET lease_until=$1 WHERE (token,tf) IN (
 SELECT token,tf FROM market_jobs_v3 WHERE next_at<=$2 AND lease_until<$2
 ORDER BY priority DESC,next_at ASC,token,tf LIMIT 1 FOR UPDATE SKIP LOCKED)
 RETURNING *`,[now+180000,now]))[0];
}
export async function publishFrameSet(token,tf,payload){
 const {frameCandles,...base}=payload||{};
 if(!frameCandles)return publishSnapshot(token,tf,base);
 const rows=frames.map(frame=>({tf:frame,candles:frameCandles[frame]}));
 if(rows.some(r=>!r.candles?.length))throw Error('Incomplete timeframe set');
 await initSnapshots();const updated=Date.now();
 const records=rows.map(r=>({tf:r.tf,payload:{...base,timeframe:r.tf,candles:r.candles,closes:r.candles.map(c=>({bucket:c.bucket,value:c.close,volume:c.volume})),generation:updated}}));
 // One statement publishes all six frames from one tape, never six mixed generations.
 await q(`INSERT INTO market_snapshots_v3(token,tf,payload,updated)
 SELECT $1,x.tf,x.payload,$3 FROM jsonb_to_recordset($2::jsonb) AS x(tf text,payload jsonb)
 ON CONFLICT(token,tf) DO UPDATE SET payload=excluded.payload,updated=excluded.updated`,[token,JSON.stringify(records),updated]);
 await q('UPDATE market_jobs_v3 SET next_at=$2,priority=0 WHERE token=$1 AND lease_until<$3',[token,updated+15000,updated]);
 for(const frame of frames)marketEvents.emit('changed',{token,tf:frame});
}
export async function finishJob(job,error){
 const delay=error?Math.min(300000,15000*2**Math.min(job.failures,4)):job.priority>0?15000:120000;
 await q(`UPDATE market_jobs_v3 SET lease_until=0,next_at=$3,priority=0,failures=$4,error=$5 WHERE token=$1 AND tf=$2`,[job.token,job.tf,Date.now()+delay,error?job.failures+1:0,error||null]);
}
export async function snapshotStatus(){
 await initSnapshots();return (await q(`SELECT COUNT(*) AS jobs,COUNT(*) FILTER(WHERE lease_until>$1) AS running,
 COUNT(*) FILTER(WHERE error IS NOT NULL) AS errors,(SELECT COUNT(*) FROM market_snapshots_v3) AS snapshots FROM market_jobs_v3`,[Date.now()]))[0];
}
