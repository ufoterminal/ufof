// A token's picture and its links, taken from the chain where the chain has them.
//
// Some pads put a metadata URI in the launch event itself: long.supply's event carries an ipfs:// link to
// a document holding the name, description, image and social links. That is the token's own metadata, so
// it is preferred over anything a third party says about it, and it keeps working when that third party
// does not.
//
// Where a pad records nothing on chain, this finds nothing and the caller falls back to whatever the pad's
// own API provides. Nothing here is invented: a token with no metadata simply has none.
import {createPublicClient,fallback,http,numberToHex} from 'viem';
import {q} from './db.js';
import {RPC_HTTP} from './config.js';
import {PAD_REGISTRIES} from './pad-registry.js';

const GATEWAYS=(process.env.IPFS_GATEWAYS||'https://ipfs.io/ipfs/,https://gateway.pinata.cloud/ipfs/').split(',').map(s=>s.trim()).filter(Boolean);
const BATCH=Math.max(1,Math.min(100,Number(process.env.METADATA_PER_PASS||15)));

let client;
const rpc=()=>client??=createPublicClient({transport:fallback(
 RPC_HTTP.map(url=>http(url,{batch:false,timeout:12000,retryCount:0})),
 {rank:{interval:60000,sampleCount:3,timeout:2000}})});

let ready;
const init=()=>ready??=q(`
CREATE TABLE IF NOT EXISTS token_metadata(
 token TEXT PRIMARY KEY,uri TEXT,logo TEXT,website TEXT,twitter TEXT,telegram TEXT,description TEXT,
 read_at BIGINT,missing BOOLEAN NOT NULL DEFAULT false);`);

// ABI-encoded strings inside a log's data, pulled out without needing the event's signature.
export function stringsInData(data){
 const hex=String(data||'0x').slice(2);
 const out=[];
 for(let i=0;i<hex.length;i+=64){
  const length=parseInt(hex.slice(i+56,i+64),16);
  if(!Number.isFinite(length)||length<3||length>512)continue;
  const body=hex.slice(i+64,i+64+Math.ceil(length/32)*64);
  if(body.length<length*2)continue;
  const text=Buffer.from(body.slice(0,length*2),'hex').toString('utf8');
  if(/^[\x20-\x7e]+$/.test(text))out.push(text);
 }
 return out;
}

export const metadataUri=strings=>strings.find(s=>/^(ipfs:\/\/|https?:\/\/)/i.test(s)&&!/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(s))||null;

// ipfs:// is not something a browser can load, so links are rewritten to a gateway. An http link is left
// exactly as the token published it.
export const resolveUri=(uri,gateway=GATEWAYS[0])=>{
 const value=String(uri||'');
 if(!value)return null;
 if(value.startsWith('ipfs://'))return gateway+value.slice(7).replace(/^ipfs\//,'');
 return /^https?:\/\//i.test(value)?value:null;
};

export function shapeMetadata(json,uri){
 if(!json||typeof json!=='object')return null;
 const link=x=>{const v=String(x||'').trim();return /^https?:\/\/|^ipfs:\/\//i.test(v)?v:null;};
 return {
  uri,
  logo:resolveUri(json.image||json.logo||json.image_url||json.icon),
  website:link(json.external_url||json.website||json.site),
  twitter:link(json.twitter||json.x||json.twitter_url),
  telegram:link(json.telegram||json.telegram_url),
  description:typeof json.description==='string'&&json.description.trim()?json.description.trim().slice(0,500):null
 };
}

async function fetchMetadata(uri){
 const candidates=uri.startsWith('ipfs://')?GATEWAYS.map(g=>resolveUri(uri,g)):[resolveUri(uri)];
 for(const url of candidates.filter(Boolean)){
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});
   if(!r.ok)continue;
   return shapeMetadata(await r.json(),uri);
  }catch{/* try the next gateway */}
 }
 return null;
}

// The launch log for one token, read back from the block the registry recorded.
async function launchUri(pad,token,block){
 const config=PAD_REGISTRIES[pad];
 if(!config||block==null)return null;
 for(const factory of config.factories){
  const logs=await rpc().request({method:'eth_getLogs',params:[{address:factory,topics:[config.topic],
   fromBlock:numberToHex(Number(block)),toBlock:numberToHex(Number(block))}]}).catch(()=>null);
  if(!logs)continue;
  for(const log of logs){
   const subject='0x'+String(log.topics?.[1]||'').slice(26).toLowerCase();
   if(subject!==token)continue;
   const uri=metadataUri(stringsInData(log.data));
   if(uri)return uri;
  }
 }
 return null;
}

// One pass: take a few launches we have not looked at yet and record what their metadata says.
export async function readPadMetadata(limit=BATCH){
 await init();
 const pending=await q(`SELECT l.pad,l.token,l.block FROM pad_launches l
  LEFT JOIN token_metadata m ON m.token=l.token
  WHERE m.token IS NULL ORDER BY l.block DESC LIMIT $1`,[limit]);
 if(!pending.length)return 0;
 const now=Math.floor(Date.now()/1000);
 const rows=await Promise.all(pending.map(async entry=>{
  const uri=await launchUri(entry.pad,entry.token,entry.block).catch(()=>null);
  const meta=uri?await fetchMetadata(uri).catch(()=>null):null;
  return {token:entry.token,uri:uri||null,...(meta||{logo:null,website:null,twitter:null,telegram:null,description:null}),
   read_at:now,missing:!meta};
 }));
 await q(`INSERT INTO token_metadata(token,uri,logo,website,twitter,telegram,description,read_at,missing)
  SELECT token,uri,logo,website,twitter,telegram,description,read_at,missing FROM jsonb_to_recordset($1::jsonb)
  AS x(token text,uri text,logo text,website text,twitter text,telegram text,description text,read_at bigint,missing boolean)
  ON CONFLICT(token) DO UPDATE SET uri=excluded.uri,logo=excluded.logo,website=excluded.website,
   twitter=excluded.twitter,telegram=excluded.telegram,description=excluded.description,
   read_at=excluded.read_at,missing=excluded.missing`,[JSON.stringify(rows)]);
 return rows.filter(r=>!r.missing).length;
}

export async function chainMetadata(){
 await init();
 const rows=await q('SELECT token,logo,website,twitter,telegram,description FROM token_metadata WHERE missing=false');
 return new Map(rows.map(r=>[r.token,r]));
}

export async function metadataStatus(){
 await init();
 const [counts]=await q(`SELECT COUNT(*)::int AS looked_at,
  COUNT(*) FILTER (WHERE missing=false)::int AS with_metadata,
  COUNT(*) FILTER (WHERE logo IS NOT NULL)::int AS with_logo FROM token_metadata`);
 return counts;
}
