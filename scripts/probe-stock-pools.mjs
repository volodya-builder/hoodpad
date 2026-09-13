const RPC = "https://rpc.mainnet.chain.robinhood.com";
const PM   = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const STOCKS = {
  NVDA:"0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  AAPL:"0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  TSLA:"0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  SPY :"0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
  MSFT:"0xe93237C50D904957Cf27E7B1133b510C669c2e74",
};
let id=1;
async function call(to,data){
  const r = await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:id++,method:"eth_call",params:[{to,data},"latest"]})});
  const j = await r.json();
  if(j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const pad = a => a.toLowerCase().replace("0x","").padStart(64,"0");
const padN = n => n.toString(16).padStart(64,"0");

const factory = "0x" + (await call(PM,"0xc45a0155")).slice(26);
console.log("Uniswap V3 Factory:", factory);

for (const [sym, addr] of Object.entries(STOCKS)) {
  for (const [qn, quote] of [["WETH",WETH],["USDG",USDG]]) {
    for (const fee of [500, 3000, 10000]) {
      const pool = "0x" + (await call(factory, "0x1698ee82"+pad(addr)+pad(quote)+padN(fee))).slice(26);
      if (/^0x0+$/.test(pool)) continue;
      const liq = BigInt(await call(pool, "0x1a686502")); // liquidity()
      console.log(`${sym}/${qn} fee=${fee}  pool=${pool}  liquidity=${liq}`);
    }
  }
}
