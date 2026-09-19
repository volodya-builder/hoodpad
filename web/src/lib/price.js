import { useEffect, useState } from "react";
import { fmtEth } from "./web3.js";

// ETH/USD: несколько источников + память в localStorage.
// Зашитый фолбэк используется ТОЛЬКО при самом первом запуске без сети —
// как только получен живой курс, он запоминается и прыжков больше нет.
const LS_KEY = "hood_ethusd_v1";
const FALLBACK = 1850;

let cached = { v: null, t: 0 };
try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
  if (saved?.v) cached = { v: saved.v, t: 0 }; // t=0 → обновится в фоне
} catch (e) { /* ignore */ }

// Источники курса ETH. Coingecko убран: с сайта он режется CORS-ом
// (каждый запрос падал и засорял консоль, курс шёл со второго источника
// с задержкой). Binance и Coinbase отдают CORS-заголовки.
const SOURCES = [
  async () => {
    const j = await (await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
      { signal: AbortSignal.timeout(5000) }
    )).json();
    return parseFloat(j?.price);
  },
  async () => {
    const j = await (await fetch(
      "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      { signal: AbortSignal.timeout(5000) }
    )).json();
    return parseFloat(j?.data?.amount);
  },
  // Binance и Coinbase у части операторов (особенно мобильных) закрыты —
  // 19.09.2026 телефон показывал капитализацию по зашитым $1850. Ещё два
  // источника с CORS и, в самом конце, курс прямо из сети: пул WETH/USDG.
  async () => {
    const j = await (await fetch(
      "https://api.kraken.com/0/public/Ticker?pair=ETHUSD",
      { signal: AbortSignal.timeout(5000) }
    )).json();
    const k = Object.keys(j?.result || {})[0];
    return parseFloat(j?.result?.[k]?.c?.[0]);
  },
  async () => {
    const j = await (await fetch(
      "https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD",
      { signal: AbortSignal.timeout(5000) }
    )).json();
    return parseFloat(j?.USD);
  },
  async () => ethUsdOnChain(),
];

/** Курс ETH из самого глубокого пула WETH/USDG в сети Robinhood Chain —
 *  работает везде, где работает сам сайт (нужен только RPC). */
async function ethUsdOnChain() {
  const { publicClient } = await import("./web3.js");
  const { parseAbi } = await import("viem");
  const v3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
  const poolAbi = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"]);
  const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const rd = (address, abi, functionName, args = []) => publicClient.readContract({ address, abi, functionName, args });
  const pools = (await Promise.all(V3_FEES.map((fee) => rd(V3_FACTORY, v3Abi, "getPool", [WETH_ADDR, USDG_ADDR, fee]).catch(() => ZERO_ADDR)))).filter((p) => p && p !== ZERO_ADDR);
  if (!pools.length) return 0;
  const bals = await Promise.all(pools.map((p) => rd(USDG_ADDR, erc20, "balanceOf", [p]).catch(() => 0n)));
  let bi = 0; for (let i = 1; i < pools.length; i++) if (bals[i] > bals[bi]) bi = i;
  if (bals[bi] < 1000n * 10n ** 6n) return 0; // пул пустой — не верим
  const [s0, t0] = await Promise.all([rd(pools[bi], poolAbi, "slot0"), rd(pools[bi], poolAbi, "token0")]);
  const sq = Number(s0[0]) / 2 ** 96; const p = sq * sq; // token1 за token0 в сырых единицах
  // WETH 18 знаков, USDG 6: цена в долларах за ETH
  return t0.toLowerCase() === WETH_ADDR ? p * 10 ** (18 - 6) : (1 / p) * 10 ** (18 - 6);
}

let _pending = null;

/** Последний известный курс без ожидания сети (для расчётов, где ждать нельзя). */
export function ethUsdCached() { return cached.v || FALLBACK; }

export async function ethUsd() {
  if (cached.v && Date.now() - cached.t < 60_000) return cached.v;
  if (_pending) return _pending;
  _pending = (async () => {
    // Все источники разом, берём первый живой ответ. Раньше шли по очереди,
    // и там, где Binance/Coinbase закрыты, курс ждал 5 с × число источников —
    // сайт «долго грузился» с телефонов.
    try {
      const v = await Promise.any(SOURCES.map(async (src) => {
        const x = await src();
        if (x && isFinite(x) && x > 0) return x;
        throw new Error("bad rate");
      }));
      cached = { v, t: Date.now() };
      try { localStorage.setItem(LS_KEY, JSON.stringify({ v })); } catch (e) { /* ignore */ }
      return v;
    } catch (e) { /* все легли */ }
    // все источники легли — держим последний известный курс, не прыгаем
    if (!cached.v) cached = { v: FALLBACK, t: Date.now() };
    else cached.t = Date.now(); // не долбим API каждый рендер
    return cached.v;
  })();
  try { return await _pending; } finally { _pending = null; }
}

export function useEthUsd() {
  const [rate, setRate] = useState(cached.v ?? FALLBACK);
  useEffect(() => {
    let alive = true;
    ethUsd().then((v) => alive && setRate(v));
    const id = setInterval(() => ethUsd().then((v) => alive && setRate(v)), 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return rate;
}

/**
 * Деньги на сайте — в ETH и долларах, у монет за акции тоже (решение
 * владельца 15.09.2026): покупают и продают за ETH через зап, акция остаётся
 * под капотом, и сумма «0.0088 AAPL» человеку ничего не говорит.
 * units — сумма в валюте кривой (у ETH-монеты это уже ETH: quoteUsd = ethUsd).
 * Курса ещё нет — «…», а не акции под видом эфира.
 */
export function moneyEth(units, quoteUsd, ethUsd) {
  const n = Number(units);
  if (!isFinite(n)) return "…";
  if (n === 0) return "0 ETH";
  if (!(quoteUsd > 0) || !(ethUsd > 0)) return "…";
  const e = (n * quoteUsd) / ethUsd;
  return `${fmtEth(e)} ETH (${usdFine(e * ethUsd)})`;
}

/** Только ETH-часть той же суммы; null — курса нет. */
export function ethOf(units, quoteUsd, ethUsd) {
  const n = Number(units);
  if (!isFinite(n)) return null;
  if (!(quoteUsd > 0) || !(ethUsd > 0)) return null;
  return (n * quoteUsd) / ethUsd;
}

/** Доллары для сумм: мелочь не округляем в «$0.00». */
export function usdFine(v) {
  const a = Math.abs(Number(v) || 0);
  if (a === 0) return "$0";
  if (a < 0.01) return "<$0.01";
  return (v < 0 ? "-" : "") + (a >= 1e3 ? usd(a) : "$" + a.toFixed(2));
}

export function usd(n) {
  if (!isFinite(n)) return "$0";
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
}

// ---------------------------------------------------------------- валюты курвы
// Курс любого ERC20 сети в долларах — у обозревателя (Blockscout), он же
// отдаёт каталог валют для формы запуска. Кэш на минуту, как у ETH.
const QUOTE_LS = "hood_quoteusd_v1";
let quoteCache = {};
try { quoteCache = JSON.parse(localStorage.getItem(QUOTE_LS) || "{}") || {}; } catch (e) { /* ignore */ }
const _qPending = new Map();

// Курс валюты курвы прямо из пулов Uniswap V3 сети (самый глубокий пул
// против WETH или USDG). Обозреватель для части валют отдаёт мусор
// (cbBTC показывал $217 вместо $75k — аудит 16.09.2026), а пул — то, по чему
// реально торгуют. Обозреватель остаётся запасным источником.
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const USDG_ADDR = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const WETH_ADDR = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const V3_FEES = [100, 500, 3000, 10000];
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
async function quoteUsdOnChain(a) {
  const { publicClient } = await import("./web3.js");
  const { parseAbi, formatUnits } = await import("viem");
  const v3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
  const poolAbi = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"]);
  const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);
  const rd = (address, abi, functionName, args = []) => publicClient.readContract({ address, abi, functionName, args });
  if (a === USDG_ADDR) return 1; // стейбл — сам себе мера
  const dec = Number(await rd(a, erc20, "decimals").catch(() => 18));
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
  const [u, w] = await Promise.all([best(USDG_ADDR, 6), best(WETH_ADDR, 18)]);
  const eth = await ethUsd();
  const uDepth = u ? u.bal : 0, wDepth = w ? w.bal * eth : 0;
  if (uDepth <= 0 && wDepth <= 0) return 0;
  if (a === WETH_ADDR) return eth;
  return wDepth > uDepth ? (await priceOf(w.p, 18)) * eth : await priceOf(u.p, 6);
}

export async function quoteUsd(addr) {
  const a = String(addr || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return 0;
  const c = quoteCache[a];
  if (c && Date.now() - c.t < 60_000) return c.v;
  if (_qPending.has(a)) return _qPending.get(a);
  const p = (async () => {
    const keep = (v) => {
      quoteCache[a] = { v, t: Date.now() };
      try { localStorage.setItem(QUOTE_LS, JSON.stringify(quoteCache)); } catch (e) { /* ignore */ }
      return v;
    };
    try {
      const v = await quoteUsdOnChain(a);
      if (v > 0 && isFinite(v)) return keep(v);
    } catch (e) { /* нет пула/RPC — спросим обозреватель */ }
    try {
      const { EXPLORER } = await import("./config.js");
      const j = await (await fetch(`${EXPLORER}/api/v2/tokens/${a}`, { signal: AbortSignal.timeout(5000) })).json();
      const v = parseFloat(j?.exchange_rate);
      if (v > 0) return keep(v);
    } catch (e) { /* нет курса — покажем в валюте */ }
    return c?.v ?? 0;
  })();
  _qPending.set(a, p);
  try { return await p; } finally { _qPending.delete(a); }
}

export function useQuoteUsd(addr) {
  const a = String(addr || "").toLowerCase();
  const [rate, setRate] = useState(quoteCache[a]?.v ?? 0);
  useEffect(() => {
    // при смене адреса не держим курс прошлой валюты: кэш или 0 («…»)
    setRate(quoteCache[a]?.v ?? 0);
    if (!a) return;
    let alive = true;
    quoteUsd(a).then((v) => alive && setRate(v));
    return () => { alive = false; };
  }, [a]);
  return a ? rate : 0;
}
