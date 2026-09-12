import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:3478';
const get=async path=>{const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
const frames={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400};
const cases=['radardex','tolly','sharc','dyor','circlewarp','archemist','pools-trade','noxa','argus','uniswap','uniswap-v4','dyorswap-v2'];
const failures=[];
for(const source of cases){
 try{
  const filter=source==='uniswap-v4'?'source=uniswap&venue=uniswap-v4':(source==='dyorswap-v2'?'venue=':'source=')+source;
  const list=await get('/api/markets?'+filter+'&limit=10');
  assert.ok(list.rows.length,source+' has no markets');const token=list.rows[0];
  const sizes=[];
  for(const [tf,seconds] of Object.entries(frames)){
   let d;
   for(let attempt=0;attempt<60;attempt++){
    d=await get('/api/market/'+token.address+'?tf='+tf);
    if(!d.cache?.pending)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   assert.equal(d.timeframe,tf);assert.ok(d.candles.length,source+'/'+tf+' has no candles '+JSON.stringify(d.errors));
   let previous=-1;
   for(const c of d.candles){assert.ok(c.bucket>previous&&c.bucket%seconds===0);previous=c.bucket;
    assert.ok([c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0));assert.ok(c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
    assert.ok(c.volume===null||Number.isFinite(c.volume)&&c.volume>=0);
   }
   sizes.push(tf+':'+d.candles.length);
  }
  console.log('PASS',source,token.symbol,token.address,sizes.join(' '));
 }catch(e){failures.push(source+': '+e.message);console.log('FAIL',source,e.message);}
}
console.log(JSON.stringify({cases:cases.length,failures}));if(failures.length)process.exitCode=1;
