// Shared source capabilities: new integrations use the same chart engine.
export const SOURCES={
 radardex:{label:'RadarDEX'},tolly:{label:'Tolly'},sharc:{label:'Sharc',history:'sharc'},
circlewarp:{label:'CircleWarp',history:'circlewarp'},
 archemist:{label:'Archemist'},'pools-trade':{label:'pools.trade'},noxa:{label:'Noxa'},argus:{label:'ArgusPad'},long:{label:'Long'},o1:{label:'o1'},dyor:{label:'DYOR'},
 uniswap:{label:'Uniswap',kind:'dex'},
 // Sources we no longer read. Rows saved under them keep a proper name instead of showing a raw id, but
 // they are not offered as a filter, because picking one would only ever return what is already stored.
 'dyorswap-v2':{label:'DYORSwap V2',kind:'dex',retired:true},
 // Rows saved before our discovery was named after the venue it reads.
 onchain:{label:'Uniswap',kind:'dex',retired:true}
};
export const VENUES={'uniswap-v3':'Uniswap V3','uniswap-v4':'Uniswap V4','dyorswap-v2':'DYORSwap V2'};
export const LAUNCHPADS=Object.fromEntries(Object.entries(SOURCES).filter(([,v])=>v.kind!=='dex'&&!v.retired));
export function launchpadId(value){return Object.hasOwn(LAUNCHPADS,value)?value:null;}
