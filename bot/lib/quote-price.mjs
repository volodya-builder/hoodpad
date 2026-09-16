// ============================================================================
//  Курс валюты курвы (USDG, акции, крипта) в долларах — для ботов.
//
//  Тот же источник, что у сайта (web/src/lib/price.js → quoteUsdOnChain):
//  самый глубокий пул Uniswap V3 сети против WETH или USDG. Обозреватель —
//  запасной вариант: он для части валют отдаёт мусор и бывает недоступен
//  (Cloudflare). Без курса сделка монеты за валюту считалась бы с нулём —
//  и монета выпадала бы из арены.
// ============================================================================
import { parseAbi, formatUnits } from "viem";

const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const USDG_ADDR = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH_ADDR = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const V3_FEES = [100, 500, 3000, 10000];
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const EXPLORER_API = process.env.EXPLORER_API || "https://robinhoodchain.blockscout.com/api/v2";

const v3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

/** Курс ETH в долларах: биржи по очереди, запасной — пул WETH/USDG сети
 *  (передай pub). 0 — курса нет нигде. */
export async function ethUsdRate(pub = null) {
  const srcs = [
    async () => (await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")).json()).ethereum.usd,
    async () => parseFloat((await (await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT")).json()).price),
    async () => parseFloat((await (await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")).json()).data.amount),
  ];
  for (const s of srcs) { try { const v = await s(); if (v > 0) return v; } catch (e) { /* дальше */ } }
  if (pub) { try { const v = await ethUsdOnChain(pub); if (v > 0) return v; } catch (e) { /* нет пула */ } }
  return 0;
}

async function ethUsdOnChain(pub) {
  const rd = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const pools = (await Promise.all(V3_FEES.map((fee) => rd(V3_FACTORY, v3Abi, "getPool", [WETH_ADDR, USDG_ADDR, fee]).catch(() => ZERO_ADDR)))).filter((p) => p && p !== ZERO_ADDR);
  if (!pools.length) return 0;
  const bals = await Promise.all(pools.map((p) => rd(USDG_ADDR, erc20, "balanceOf", [p]).catch(() => 0n)));
  let bi = 0; for (let i = 1; i < pools.length; i++) if (bals[i] > bals[bi]) bi = i;
  const [s0, t0] = await Promise.all([rd(pools[bi], poolAbi, "slot0"), rd(pools[bi], poolAbi, "token0")]);
  const sq = Number(s0[0]) / 2 ** 96; const p = sq * sq;
  // цена token1 за token0; WETH 18 знаков, USDG 6
  return t0.toLowerCase() === WETH_ADDR ? p * 10 ** (18 - 6) : (1 / p) * 10 ** (18 - 6);
}

const cache = new Map();

/** Курс валюты в долларах (число) и её знаки. 0 — курса нет. */
export async function quoteUsd(pub, addr, ethUsd = null) {
  const a = String(addr || "").toLowerCase();
  if (cache.has(a)) return cache.get(a);
  const rd = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const dec = Number(await rd(a, erc20, "decimals").catch(() => 18));
  let usd = 0;
  try {
    if (a === USDG_ADDR) usd = 1;
    else {
      const eth = ethUsd ?? await ethUsdRate(pub);
      const best = async (b, bDec) => {
        const pools = (await Promise.all(V3_FEES.map((fee) => rd(V3_FACTORY, v3Abi, "getPool", [a, b, fee]).catch(() => ZERO_ADDR)))).filter((p) => p && p !== ZERO_ADDR);
        if (!pools.length) return null;
        const bals = await Promise.all(pools.map((p) => rd(b, erc20, "balanceOf", [p]).catch(() => 0n)));
        let bi = 0; for (let i = 1; i < pools.length; i++) if (bals[i] > bals[bi]) bi = i;
        return { p: pools[bi], bal: Number(formatUnits(bals[bi], bDec)) };
      };
      const priceOf = async (pool, bDec) => {
        const [s0, t0] = await Promise.all([rd(pool, poolAbi, "slot0"), rd(pool, poolAbi, "token0")]);
        const sq = Number(s0[0]) / 2 ** 96; const p = sq * sq;
        return t0.toLowerCase() === a ? p * 10 ** (dec - bDec) : (1 / p) * 10 ** (dec - bDec);
      };
      if (a === WETH_ADDR) usd = eth;
      else {
        const [u, w] = await Promise.all([best(USDG_ADDR, 6), best(WETH_ADDR, 18)]);
        const uDepth = u ? u.bal : 0, wDepth = w ? w.bal * eth : 0;
        if (wDepth > 0 || uDepth > 0) usd = wDepth > uDepth ? (await priceOf(w.p, 18)) * eth : await priceOf(u.p, 6);
      }
    }
  } catch (e) { usd = 0; }
  if (!(usd > 0) || !isFinite(usd)) {
    try {
      const j = await (await fetch(`${EXPLORER_API}/tokens/${a}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) })).json();
      const v = parseFloat(j?.exchange_rate); if (v > 0) usd = v;
    } catch (e) { /* нет курса */ }
  }
  const out = { usd: usd > 0 && isFinite(usd) ? usd : 0, dec };
  cache.set(a, out);
  return out;
}
