import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
const url=process.env.DATABASE_URL||''; const embedded=!url;
let local=null;
export const storage=embedded?'pglite':'postgres';
export const pool=embedded?{query:async(sql,params=[])=>{local??=new PGlite(process.env.DATA_DIR||'./data');await local.waitReady;return params.length?local.query(sql,params):local.exec(sql).then(x=>x.at(-1)||{rows:[]})},end:()=>local?.close()}:new pg.Pool({connectionString:url,max:10});
export async function q(sql,params=[]){return (await pool.query(sql,params)).rows;}
export async function init(){await q(`
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS launchpads(id TEXT PRIMARY KEY,label TEXT NOT NULL,status TEXT NOT NULL,website TEXT,api_url TEXT,chain_id INTEGER NOT NULL DEFAULT 5042,verified_at BIGINT);
CREATE TABLE IF NOT EXISTS tokens(address TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',symbol TEXT NOT NULL DEFAULT '',decimals INTEGER,total_supply NUMERIC,creation_block BIGINT,creation_at BIGINT,metadata JSONB NOT NULL DEFAULT '{}');
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS holder_count INTEGER;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS holder_at BIGINT;
CREATE TABLE IF NOT EXISTS launches(token TEXT PRIMARY KEY REFERENCES tokens(address),launchpad_id TEXT, factory TEXT, event_name TEXT, block BIGINT, at BIGINT, tx TEXT, confidence TEXT NOT NULL DEFAULT 'verified');
CREATE TABLE IF NOT EXISTS pools(address TEXT PRIMARY KEY,token TEXT NOT NULL REFERENCES tokens(address),quote TEXT NOT NULL,token_is_token0 BOOLEAN NOT NULL DEFAULT false, dex TEXT, factory TEXT, version INTEGER, created_block BIGINT, created_at BIGINT, liquidity NUMERIC, liquidity_at BIGINT);
CREATE TABLE IF NOT EXISTS swaps(pool TEXT NOT NULL REFERENCES pools(address),block BIGINT NOT NULL,log_index INTEGER NOT NULL,at BIGINT NOT NULL,tx TEXT NOT NULL,trader TEXT,price NUMERIC,usd_volume NUMERIC,buy BOOLEAN,token_amount NUMERIC,PRIMARY KEY(pool,block,log_index));
CREATE TABLE IF NOT EXISTS candles(token TEXT NOT NULL,timeframe TEXT NOT NULL,bucket BIGINT NOT NULL,open NUMERIC,high NUMERIC,low NUMERIC,close NUMERIC,volume NUMERIC,trades INTEGER,PRIMARY KEY(token,timeframe,bucket));
CREATE TABLE IF NOT EXISTS blocks(number BIGINT PRIMARY KEY,at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS swaps_at ON swaps(at); CREATE INDEX IF NOT EXISTS pools_token ON pools(token);
`);}
export async function metaGet(k){const r=await q('SELECT v FROM meta WHERE k=$1',[k]);return r.length?JSON.parse(r[0].v):null}
export async function metaSet(k,v){await q('INSERT INTO meta(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=excluded.v',[k,JSON.stringify(v)])}
