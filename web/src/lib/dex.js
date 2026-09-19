// ============================================================================
//  Монета после градации: торговля и данные с Uniswap V3 (18.09.2026).
//
//  Кривая закрыта, ликвидность в пуле Uniswap V3 (комиссия 0,3%). Отсюда:
//    · цена и капитализация — из slot0 пула;
//    · сделки и график — из событий Swap пула (с блока запуска площадки);
//    · покупка/продажа — через SwapRouter02 (ETH ↔ монета одной транзакцией;
//      у монет за валюту — по маршруту запа: ETH → [mid] → валюта → монета).
//  Платят и получают всегда ETH — как на кривой.
// ============================================================================
import { parseAbi, encodePacked, encodeFunctionData, formatEther, formatUnits } from "viem";
import { publicClient, getLogsSafe } from "./web3.js";
import { WETH_ADDRESS, ZAP_ADDRESS, FACTORY_START_BLOCK } from "./config.js";
import { zapAbi } from "./abi.js";

// Uniswap V3 на Robinhood Chain (github.com/Uniswap/contracts/deployments/4663.md)
export const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
export const SWAP_ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2"; // SwapRouter02
export const QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
export const POOL_FEE = 3000; // мигратор создаёт пул 0,3%
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002"; // получатель = роутер (для unwrap)
const ZERO = "0x0000000000000000000000000000000000000000";

const factoryAbi = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
export const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const lower = (a) => String(a || "").toLowerCase();
const Q96 = 2n ** 96n;

// ---------------------------------------------------------------- пул
const _pools = new Map(); // token:quote → address
/** Пул Uniswap монеты: против WETH (ETH-монета) или против валюты кривой. */
export async function dexPoolOf(token, quoteAddr = null) {
  const other = quoteAddr || WETH_ADDRESS;
  const key = `${lower(token)}:${lower(other)}`;
  if (_pools.has(key)) return _pools.get(key);
  const p = await publicClient.readContract({ address: V3_FACTORY, abi: factoryAbi, functionName: "getPool", args: [token, other, POOL_FEE] });
  const res = lower(p) === ZERO ? null : p;
  if (res) _pools.set(key, res);
  return res;
}

/** Цена монеты в единицах второй монеты пула (wei на 1e18 монеты), как spotPrice кривой. */
function priceFromSqrt(sqrtPriceX96, tokenIsToken0, otherDec) {
  // price1per0 = (sqrt/2^96)^2 → сколько token1 за 1 token0 (в сырых единицах)
  const s = BigInt(sqrtPriceX96);
  const num = s * s; // /2^192
  const scale = 10n ** 18n; // цена за 1e18 монеты
  let raw;
  if (tokenIsToken0) raw = (num * scale) / (Q96 * Q96);            // other за монету
  else raw = (Q96 * Q96 * scale) / (num === 0n ? 1n : num);          // монета — token1: инвертируем
  // spotPrice кривой — в wei валюты за 1e18 монеты; у валюты с другими знаками — в её единицах
  return raw;
}

/** Состояние пула: цена (как spotPrice), ликвидность, резервы. */
export async function dexState(pool, token, otherDec = 18) {
  const [s0, liq, t0, balT, balO] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [pool] }).catch(() => 0n),
    Promise.resolve(0n),
  ]);
  const tokenIsToken0 = lower(t0) === lower(token);
  const other = tokenIsToken0
    ? await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token1" })
    : t0;
  const reserveOther = await publicClient.readContract({ address: other, abi: erc20Abi, functionName: "balanceOf", args: [pool] }).catch(() => 0n);
  return {
    pool, tokenIsToken0, other,
    price: priceFromSqrt(s0[0], tokenIsToken0, otherDec),
    liquidity: liq, reserveToken: balT, reserveOther: reserveOther || balO,
  };
}

/** Текущая цена градуировавшей монеты на Uniswap — в тех же единицах, что
 *  spotPrice кривой (wei валюты за 1e18 монеты); null — пула нет. Память 20 с:
 *  список монет обновляется часто, а цена пула — один вызов на монету. */
const _dexPx = new Map();
const DEXPX_LS = "hood_dexpx_v1_";
export async function dexPriceOf(token, quoteAddr = null, otherDec = 18) {
  const key = `${lower(token)}:${lower(quoteAddr || WETH_ADDRESS)}`;
  const c = _dexPx.get(key);
  if (c && Date.now() - c.t < 20_000) return c.v;
  // Три попытки: если узел молчит, главная показывала замёрзшую цену кривой
  // ($66k вместо $2k — 19.09.2026). Не вышло — последняя известная цена DEX
  // из памяти браузера; её нет — null (вызывающий оставит цену кривой).
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pool = await dexPoolOf(token, quoteAddr);
      if (!pool) return null;
      const st = await dexState(pool, token, otherDec);
      _dexPx.set(key, { v: st.price, t: Date.now() });
      try { localStorage.setItem(DEXPX_LS + key, st.price.toString()); } catch (e) { /* ignore */ }
      return st.price;
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
  }
  if (c) return c.v;
  try { const v = localStorage.getItem(DEXPX_LS + key); if (v) return BigInt(v); } catch (e) { /* ignore */ }
  throw lastErr;
}

// ---------------------------------------------------------------- сделки
// Роутеры и зап: если получатель — один из них, настоящий трейдер — отправитель tx.
const ROUTERS = new Set([lower(SWAP_ROUTER), lower(ZAP_ADDRESS), "0x8876789976decbfcbbbe364623c63652db8c0904", ADDRESS_THIS]);
const _txFrom = new Map();
async function txFrom(hash) {
  if (_txFrom.has(hash)) return _txFrom.get(hash);
  const p = publicClient.getTransaction({ hash }).then((tx) => lower(tx.from)).catch(() => null);
  _txFrom.set(hash, p);
  return p;
}

/**
 * Сделки на Uniswap в формате сделок кривой: { side, addr, eth, tokens, fee,
 * block, tx, ts, dex: true } (eth — в единицах второй монеты пула: ETH или
 * валюта) и точки графика { i, mcap, ts } (mcap — в тех же единицах × 1e9).
 */
export async function dexTrades(pool, token, { otherDec = 18, fromBlock = FACTORY_START_BLOCK, startIndex = 0 } = {}) {
  const t0 = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: "token0" });
  const tokenIsToken0 = lower(t0) === lower(token);
  const logs = await getLogsSafe({ address: pool, event: poolAbi[4], fromBlock, toBlock: "latest" });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? Number(a.logIndex - b.logIndex) : Number(a.blockNumber - b.blockNumber)));
  // время: интерполяция по блокам (2 вызова), как у кривой
  let ts0 = 0, avg = 0, minB = 0;
  if (logs.length) {
    minB = Number(logs[0].blockNumber);
    const [latest, oldest] = await Promise.all([publicClient.getBlock(), publicClient.getBlock({ blockNumber: BigInt(minB) })]);
    const span = Number(latest.number) - minB;
    avg = span > 0 ? (Number(latest.timestamp) - Number(oldest.timestamp)) / span : 0;
    ts0 = Number(oldest.timestamp);
  }
  // кто торговал: последние 60 сделок — точно (по tx), остальные — по получателю
  const recent = new Set(logs.slice(-60).map((l) => l.transactionHash));
  const froms = new Map();
  await Promise.all([...recent].map(async (h) => froms.set(h, await txFrom(h))));
  const D = 10 ** otherDec;
  const trades = [], points = [];
  let i = startIndex;
  for (const l of logs) {
    const a0 = l.args.amount0, a1 = l.args.amount1;
    const tokAmt = tokenIsToken0 ? a0 : a1;
    const othAmt = tokenIsToken0 ? a1 : a0;
    const side = tokAmt < 0n ? "buy" : "sell"; // пул отдал монету → покупка
    const rec = lower(l.args.recipient);
    const addr = froms.get(l.transactionHash) || (ROUTERS.has(rec) ? lower(l.args.sender) : rec);
    const ts = (ts0 + (Number(l.blockNumber) - minB) * avg) * 1000;
    const price = Number(formatUnits(priceFromSqrt(l.args.sqrtPriceX96, tokenIsToken0, otherDec), otherDec));
    trades.push({
      side, addr, dex: true, price,
      eth: Math.abs(Number(othAmt)) / D, tokens: Math.abs(Number(tokAmt)) / 1e18, fee: 0,
      block: l.blockNumber, tx: l.transactionHash, ts,
    });
    i += 1;
    points.push({ i, mcap: price * 1e9, ts });
  }
  return { trades: trades.reverse(), points, now: Date.now() };
}

// ---------------------------------------------------------------- маршрут и обмен
/** Маршрут ETH → монета: для ETH-монеты один хоп, для монеты за валюту — по запу. */
async function pathTo(token, quoteAddr) {
  if (!quoteAddr) return { hops: [[WETH_ADDRESS, POOL_FEE, token]] };
  const [mid, fee1, fee2] = await publicClient.readContract({ address: ZAP_ADDRESS, abi: zapAbi, functionName: "routeOf", args: [quoteAddr] });
  const hops = lower(mid) === ZERO
    ? [[WETH_ADDRESS, fee1, quoteAddr]]
    : [[WETH_ADDRESS, fee1, mid], [mid, fee2, quoteAddr]];
  hops.push([quoteAddr, POOL_FEE, token]);
  return { hops };
}
function encodePath(hops) {
  const types = [], vals = [];
  hops.forEach(([a, fee, b], k) => {
    if (k === 0) { types.push("address"); vals.push(a); }
    types.push("uint24", "address"); vals.push(fee, b);
  });
  return encodePacked(types, vals);
}
const reverseHops = (hops) => [...hops].reverse().map(([a, fee, b]) => [b, fee, a]);

/** Оценка: сколько монет за ethIn (buy) или сколько ETH за tokensIn (sell). */
export async function dexQuote(token, quoteAddr, side, amountIn, account = null) {
  const { hops } = await pathTo(token, quoteAddr);
  const path = encodePath(side === "buy" ? hops : reverseHops(hops));
  const acct = account || "0x0000000000000000000000000000000000000001";
  const { result } = await publicClient.simulateContract({
    account: acct, address: QUOTER_V2, abi: quoterAbi, functionName: "quoteExactInput", args: [path, amountIn],
  });
  return result[0];
}

/** Покупка за ETH: одна транзакция роутера, монеты — на кошелёк. */
export async function dexBuy(walletClient, account, token, quoteAddr, ethIn, minOut) {
  const { hops } = await pathTo(token, quoteAddr);
  if (hops.length === 1) {
    return walletClient.writeContract({
      address: SWAP_ROUTER, abi: routerAbi, functionName: "exactInputSingle",
      args: [{ tokenIn: WETH_ADDRESS, tokenOut: token, fee: POOL_FEE, recipient: account, amountIn: ethIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      value: ethIn,
    });
  }
  return walletClient.writeContract({
    address: SWAP_ROUTER, abi: routerAbi, functionName: "exactInput",
    args: [{ path: encodePath(hops), recipient: account, amountIn: ethIn, amountOutMinimum: minOut }],
    value: ethIn,
  });
}

/** Продажа за ETH: обмен в WETH на роутер + unwrap на кошелёк, одним multicall. Нужен approve роутеру. */
export async function dexSell(walletClient, account, token, quoteAddr, tokensIn, minEth) {
  const { hops } = await pathTo(token, quoteAddr);
  const rev = reverseHops(hops);
  const swap = rev.length === 1
    ? encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: token, tokenOut: WETH_ADDRESS, fee: POOL_FEE, recipient: ADDRESS_THIS, amountIn: tokensIn, amountOutMinimum: minEth, sqrtPriceLimitX96: 0n }] })
    : encodeFunctionData({ abi: routerAbi, functionName: "exactInput", args: [{ path: encodePath(rev), recipient: ADDRESS_THIS, amountIn: tokensIn, amountOutMinimum: minEth }] });
  const unwrap = encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minEth, account] });
  return walletClient.writeContract({ address: SWAP_ROUTER, abi: routerAbi, functionName: "multicall", args: [[swap, unwrap]] });
}

export const fmtDexEth = (v) => formatEther(v);

// ---------------------------------------------------------------- для арены
// Сделки Uniswap градуировавших монет в формате allTrades(): pool — адрес
// КРИВОЙ (по нему арена группирует), quote/ethRaw — чтобы монеты за валюту
// пересчитались в ETH тем же кодом, price — цена после сделки (ETH или валюта
// за монету) для роста капитализации. Кэш 60 с.
let _arenaDex = { v: null, t: 0, p: null };
// Память по монете: если сеть не ответила (лимит RPC, обрыв), берём прошлый
// удачный ответ — иначе объём то есть, то нет (владелец, 19.09.2026).
const _dexByTok = new Map(); // tokenLower -> rows
const DEX_LS = "hood_dex_tr_v1_";
function readDexLs(tok) {
  try { const c = JSON.parse(localStorage.getItem(DEX_LS + tok) || "null"); return Array.isArray(c) ? c.map((r) => ({ ...r, block: BigInt(r.block || 0) })) : null; } catch (e) { return null; }
}
function writeDexLs(tok, rows) {
  try { localStorage.setItem(DEX_LS + tok, JSON.stringify(rows.slice(0, 600).map((r) => ({ ...r, block: String(r.block) })))); } catch (e) { /* нет места */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function dexRowsOf(t) {
  const tok = lower(t.token);
  const dec = t.q ? t.q.dec : 18;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dp = await dexPoolOf(t.token, t.q ? t.q.addr : null);
      if (!dp) return [];
      const d = await dexTrades(dp, t.token, { otherDec: dec });
      const rows = d.trades.map((tr) => ({
        pool: String(t.pool).toLowerCase(), side: tr.side, addr: tr.addr,
        eth: tr.eth, tokens: tr.tokens, fee: 0, ts: tr.ts, block: tr.block, tx: tr.tx,
        quote: t.q ? String(t.q.addr).toLowerCase() : null,
        ethRaw: String(BigInt(Math.round(tr.eth * 10 ** dec))), feeRaw: "0",
        dex: true, price: tr.price,
      }));
      _dexByTok.set(tok, rows);
      writeDexLs(tok, rows);
      return rows;
    } catch (e) { lastErr = e; await sleep(400 * (attempt + 1)); }
  }
  const prev = _dexByTok.get(tok) || readDexLs(tok);
  if (prev) return prev;
  throw lastErr || new Error("dex trades failed");
}
export async function dexTradesForArena(tokens) {
  if (_arenaDex.v && Date.now() - _arenaDex.t < 60_000) return _arenaDex.v;
  if (_arenaDex.p) return _arenaDex.p;
  _arenaDex.p = (async () => {
    const grads = (tokens || []).filter((t) => t.graduated && t.pool);
    const out = [];
    let failed = false;
    await Promise.all(grads.map(async (t) => {
      try { out.push(...(await dexRowsOf(t))); } catch (e) { failed = true; }
    }));
    // если какая-то монета так и не прочиталась — кэш короткий, попробуем скоро снова
    _arenaDex = { v: out, t: failed ? Date.now() - 45_000 : Date.now(), p: null };
    return out;
  })().catch((e) => { _arenaDex.p = null; throw e; });
  return _arenaDex.p;
}
