const USDC='0x3600000000000000000000000000000000000000';
export const nonUsdQuote=q=>typeof q==='string'&&q.length>0&&q.toLowerCase()!==USDC&&q.toLowerCase()!=='usdc';
export const crossQuote=m=>nonUsdQuote(m?.quote_token)||((m?.quote_pending||!m?.quote_token)&&Array.isArray(m?.quote_assets)&&m.quote_assets.some(nonUsdQuote));
export function usdQuoteRow(row,detail){
 if(!detail||detail.address?.toLowerCase()!==row.address?.toLowerCase()||!Number.isFinite(Number(detail.price))||!(Number(detail.price)>0))return {...row,price:null,priceUsd:null,mcap:null,marketCap:null,fdv:null,spark:[],quotePending:true};
 return {...row,price:Number(detail.price),mcap:detail.mcap??null,fdv:detail.fdv??null,
  totalSupply:detail.totalSupply??row.totalSupply,decimals:detail.decimals??row.decimals,
  quoteToken:detail.quoteToken,usdDetail:true,quotePending:false,
  // The list spark is denominated in the quote asset; do not label it USD.
  spark:[],change5m:detail.change5m??null,change1h:detail.change1h??null,
  change6h:detail.change6h??null,change24h:detail.change24h??null,change24:detail.change24h??null};
}
export async function enrichQuoteRows(payload,read){
 if(!Array.isArray(payload?.tokens))return payload;
 const tokens=payload.tokens.slice(),indices=tokens.map((t,i)=>Array.isArray(t.quotes)&&t.quotes.some(nonUsdQuote)?i:-1).filter(i=>i>=0);
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,indices.length)},async()=>{
  while(cursor<indices.length){const i=indices[cursor++],row=tokens[i];
   try{if(!/^0x[0-9a-f]{40}$/i.test(row.address))throw Error('Invalid address');tokens[i]=usdQuoteRow(row,await read(row.address));}catch{tokens[i]=usdQuoteRow(row,null);}
  }
 }));return {...payload,tokens};
}
