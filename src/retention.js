// Keeping the trade tape from growing without end.
//
// The tape is what every figure on the site is computed from, so nothing is deleted before it has been
// summarised: each day of a token's trading is written as one row with its open, high, low, close, volume
// and count, and only then are the raw trades behind it removed. A day that has been summarised can still
// be drawn and still be counted; what is lost is the individual trade, which nobody reads a year later.
//
// This is switched off by default. It exists so that the day the tape becomes large, turning it on is a
// setting rather than a project, and so that the shape of what is kept is decided now rather than under
// pressure later.
import {q} from './db.js';

const on=()=>String(process.env.RETENTION_ENABLED||'').toLowerCase()==='true';
// How much raw detail each token keeps regardless of age, and how far back raw trades are kept at all.
const KEEP_PER_TOKEN=Math.max(50,Math.min(10000,Number(process.env.RETENTION_KEEP_PER_TOKEN||500)));
const KEEP_HOURS=Math.max(24,Math.min(24*365,Number(process.env.RETENTION_KEEP_HOURS||24*30)));
const BATCH=Math.max(100,Math.min(100000,Number(process.env.RETENTION_BATCH||20000)));

let ready;
const init=()=>ready??=q(`
CREATE TABLE IF NOT EXISTS trade_daily(
 token TEXT NOT NULL,day BIGINT NOT NULL,
 open NUMERIC,high NUMERIC,low NUMERIC,close NUMERIC,
 usd_volume NUMERIC,txns INTEGER,buys INTEGER,traders INTEGER,
 PRIMARY KEY(token,day));
CREATE INDEX IF NOT EXISTS trade_daily_token ON trade_daily(token,day);`);

export const settings=()=>({enabled:on(),keepPerToken:KEEP_PER_TOKEN,keepHours:KEEP_HOURS});

// One day of one token, as it will be remembered once the raw trades are gone.
export async function summariseDays(before){
 await init();
 const written=await q(`INSERT INTO trade_daily(token,day,open,high,low,close,usd_volume,txns,buys,traders)
  SELECT token,(at/86400)*86400 AS day,
   (ARRAY_AGG(price ORDER BY at ASC,block ASC,log_index ASC))[1] AS open,
   MAX(price) AS high,MIN(price) AS low,
   (ARRAY_AGG(price ORDER BY at DESC,block DESC,log_index DESC))[1] AS close,
   SUM(usd_volume) AS usd_volume,COUNT(*)::int AS txns,
   COUNT(*) FILTER (WHERE buy)::int AS buys,
   COUNT(DISTINCT trader)::int AS traders
  FROM onchain_trades WHERE at < $1
  GROUP BY token,(at/86400)*86400
  ON CONFLICT(token,day) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,
   close=excluded.close,usd_volume=excluded.usd_volume,txns=excluded.txns,buys=excluded.buys,
   traders=excluded.traders
  RETURNING token`,[before]);
 return written.length;
}

// Raw trades a token no longer needs: older than the window, and past the most recent ones it always keeps.
export async function pruneTrades({keepPerToken=KEEP_PER_TOKEN,keepHours=KEEP_HOURS,batch=BATCH}={}){
 await init();
 const before=Math.floor(Date.now()/1000)-keepHours*3600;
 const summarised=await summariseDays(before);
 const removed=await q(`WITH ranked AS (
   SELECT pool,block,log_index,at,
    ROW_NUMBER() OVER (PARTITION BY token ORDER BY at DESC,block DESC,log_index DESC) AS recency
   FROM onchain_trades)
  DELETE FROM onchain_trades t USING ranked r
  WHERE t.pool=r.pool AND t.block=r.block AND t.log_index=r.log_index
   AND r.at < $1 AND r.recency > $2
  RETURNING 1`,[before,keepPerToken]);
 return {summarised,removed:removed.length,before,keepPerToken,keepHours,batch};
}

// Runs only when switched on, and says plainly when it is not.
export async function runRetention(){
 if(!on())return {enabled:false};
 return {enabled:true,...await pruneTrades()};
}

export async function retentionStatus(){
 await init();
 const [counts]=await q(`SELECT (SELECT COUNT(*)::int FROM onchain_trades) AS raw_trades,
  (SELECT COUNT(*)::int FROM trade_daily) AS summarised_days,
  (SELECT MIN(at)::bigint FROM onchain_trades) AS oldest_raw`);
 return {...settings(),...counts};
}
