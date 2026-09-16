export const CHAIN_ID=5042;
export const USDC='0x3600000000000000000000000000000000000000';
export const RPC_HTTP=(process.env.RPC_HTTP||'https://rpc.mainnet.arc.io,https://rpc.arc-scan.org,https://5042.rpc.thirdweb.com,https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8').split(',').map(x=>x.trim()).filter(Boolean);
export const HISTORY_DAYS=Math.max(1,Number(process.env.HISTORY_DAYS||2));
export const ADDR=/^0x[0-9a-fA-F]{40}$/;
export const DEX_FACTORIES=['0xf0db7b58379503491d857db50ac9ece64c653918','0x874dc9d64cd0af61146a68036e9afca7dadd736a'];
export const ARCSCAN_API=process.env.ARCSCAN_API||'https://api.arc-scan.org';
