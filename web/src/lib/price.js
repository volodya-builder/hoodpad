import { useEffect, useState } from "react";
import { fmtEth } from "./web3.js";
import { formatUnits } from "viem";

// ETH/USD: несколько источников + память в localStorage.
// Зашитый фолбэк используется ТОЛЬКО при самом первом запуске без сети —
// как только получен живой курс, он запоминается и прыжков больше нет.
const LS_KEY = "hood_ethusd_v1";
const FALLBACK = 2600; // только до первого живого курса (обновлено 19.09.2026)

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
  const d = await deepestPool(WETH_ADDR, USDG_ADDR, 6);
  if (!d || d.depth < 1000) return 0; // пул пустой — не верим
  // WETH 18 знаков, USDG 6: цена в долларах за ETH
  return d.priceOf(18);
}

// ---------------------------------------------------------------- пулы Uniswap
// Самый глубокий пул пары a/b: адреса пулов помним час (они не исчезают),
// балансы/цены всех кандидатов читаем ОДНИМ заходом (один multicall) —
// раньше это было 3–4 круга до узла, и курс приходил последним.
const POOLS_LS = "hood_v3pools_v1";
const _poolsMem = new Map();
async function poolsOf(a, b) {
  const key = `${a}:${b}`;
  const m = _poolsMem.get(key);
  if (m && Date.now() - m.t < 3600_000) return m.v;
  try {
    const c = JSON.parse(localStorage.getItem(POOLS_LS) || "{}")[key];
    if (c && Date.now() - c.t < 3600_000 && Array.isArray(c.v)) { _poolsMem.set(key, c); return c.v; }
  } catch (e) { /* ignore */ }
  const { publicClient } = await import("./web3.js");
  const { parseAbi } = await import("viem");
  const v3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
  const found = await Promise.all(V3_FEES.map((fee) => publicClient.readContract({ address: V3_FACTORY, abi: v3Abi, functionName: "getPool", args: [a, b, fee] })));
  const v = found.filter((p) => p && p !== ZERO_ADDR).map((p) => String(p).toLowerCase());
  _poolsMem.set(key, { v, t: Date.now() });
  try { const all = JSON.parse(localStorage.getItem(POOLS_LS) || "{}"); all[key] = { v, t: Date.now() }; localStorage.setItem(POOLS_LS, JSON.stringify(all)); } catch (e) { /* ignore */ }
  return v;
}
/** { pool, depth (в единицах b), priceOf(aDec) — цена a в единицах b } или null, если пулов нет.
 *  Сбой чтения — ошибка (не «пусто»): снаружи повторы и последнее известное. */
async function deepestPool(a, b, bDec) {
  const pools = await poolsOf(a, b);
  if (!pools.length) return null;
  const { publicClient } = await import("./web3.js");
  const { parseAbi, formatUnits } = await import("viem");
  const poolAbi = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"]);
  const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const rd = (address, abi, functionName, args = []) => publicClient.readContract({ address, abi, functionName, args });
  const rows = await Promise.all(pools.map(async (p) => {
    const [bal, s0, t0] = await Promise.all([rd(b, erc20, "balanceOf", [p]), rd(p, poolAbi, "slot0"), rd(p, poolAbi, "token0")]);
    return { p, bal, s0, t0 };
  }));
  let bi = 0; for (let i = 1; i < rows.length; i++) if (rows[i].bal > rows[bi].bal) bi = i;
  const r = rows[bi];
  const sq = Number(r.s0[0]) / 2 ** 96; const px = sq * sq; // token1 за token0 в сырых единицах
  return {
    pool: r.p, depth: Number(formatUnits(r.bal, bDec)),
    priceOf: (aDec) => (String(r.t0).toLowerCase() === a ? px * 10 ** (aDec - bDec) : (1 / px) * 10 ** (aDec - bDec)),
  };
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

// ---------------------------------------------------------------- цена и капа монеты
/** Цена монеты в единицах валюты кривой за одну монету (число, точная).
 *  У монет за валюту с малым числом знаков (USDG — 6) spotPrice контракта
 *  режет дробную часть сырых единиц (2,5 → 2: DOGE показывал $2k вместо
 *  $2,5k, аудит 19.09.2026), поэтому список и страница считают точную цену
 *  сами и кладут её в priceF; price (BigInt) остаётся для контрактов. */
export function priceUnitsOf(tok) {
  if (!tok) return 0;
  if (tok.priceF != null && isFinite(tok.priceF)) return tok.priceF;
  const dec = tok.q ? (tok.q.dec ?? 18) : 18;
  try { return Number(formatUnits(tok.price ?? 0n, dec)); } catch (e) { return 0; }
}
/** Капитализация в долларах: null — курса ещё нет (показать «…», не выдумку).
 *  quoteUsd — число или функция addr → курс валюты. */
export function mcapUsdOf(tok, ethUsd, quoteUsd) {
  const mc = priceUnitsOf(tok) * 1e9;
  if (tok?.q) {
    const r = typeof quoteUsd === "function" ? quoteUsd(tok.q.addr) : quoteUsd;
    return r > 0 ? mc * r : null;
  }
  return ethUsd > 0 ? mc * ethUsd : null;
}
/** Собрано в кривой — в долларах (для сортировки «недавние покупки»). */
export function raisedUsdOf(tok, ethUsd, quoteUsd) {
  const dec = tok?.q ? (tok.q.dec ?? 18) : 18;
  let units = 0; try { units = Number(formatUnits(tok?.reserve ?? 0n, dec)); } catch (e) { units = 0; }
  if (tok?.q) { const r = typeof quoteUsd === "function" ? quoteUsd(tok.q.addr) : quoteUsd; return r > 0 ? units * r : 0; }
  return units * (ethUsd || 0);
}
/** Курсы валют всех монет списка: { addrLower: usd }. Обновляется раз в минуту. */
export function useQuoteRates(tokens) {
  const key = [...new Set((tokens || []).filter((x) => x?.q?.addr).map((x) => String(x.q.addr).toLowerCase()))].sort().join(",");
  const [rates, setRates] = useState(() => {
    const out = {}; for (const a of key ? key.split(",") : []) if (quoteCache[a]?.v > 0) out[a] = quoteCache[a].v; return out;
  });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const pull = () => Promise.all(key.split(",").map((a) => quoteUsd(a).then((v) => [a, v]).catch(() => [a, 0])))
      .then((rows) => { if (alive) setRates((prev) => { const n = { ...prev }; for (const [a, v] of rows) if (v > 0) n[a] = v; return n; }); });
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [key]);
  return rates;
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
  if (a >= 1e5) return "$" + (n / 1e3).toFixed(0) + "k"; // $300k, не $300.0k (ось графика)
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
}

// ---------------------------------------------------------------- валюты курвы
// Курс любого ERC20 сети в долларах — у обозревателя (Blockscout), он же
// отдаёт каталог валют для формы запуска. Кэш на минуту, как у ETH.
const QUOTE_LS = "hood_quoteusd_v2"; // v2: в v1 могли осесть курсы из обозревателя (19.09.2026)
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
  if (a === USDG_ADDR) return 1; // стейбл — сам себе мера
  const eth = await ethUsd();
  if (a === WETH_ADDR) return eth;
  const dec = await tokenDecimals(a);
  // Аудит 19.09.2026: сбой чтения баланса молча давал 0 — глубокий пул
  // «пустел», выбирался пыльный пул (0.000003 USDG, цена 1e12) и META на
  // боковой панели показывала «$3652B». Теперь сбой = ошибка (снаружи 3
  // попытки, потом последнее известное), а пул мельче $50 не считается.
  const [u, w] = await Promise.all([deepestPool(a, USDG_ADDR, 6), deepestPool(a, WETH_ADDR, 18)]);
  const MIN_DEPTH = 50; // долларов в пуле — меньше это пыль, не цена
  const uDepth = u ? u.depth : 0, wDepth = w ? w.depth * eth : 0;
  if (uDepth < MIN_DEPTH && wDepth < MIN_DEPTH) return 0;
  const v = wDepth > uDepth ? w.priceOf(dec) * eth : u.priceOf(dec);
  if (!isFinite(v) || v <= 0) throw new Error("quote price: bad pool state");
  return v;
}
// знаки валюты не меняются — помним навсегда
const DEC_LS = "hood_decimals_v1";
async function tokenDecimals(a) {
  try { const c = JSON.parse(localStorage.getItem(DEC_LS) || "{}")[a]; if (Number.isInteger(c)) return c; } catch (e) { /* ignore */ }
  const { publicClient } = await import("./web3.js");
  const { parseAbi } = await import("viem");
  const dec = Number(await publicClient.readContract({ address: a, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" }).catch(() => 18));
  try { const all = JSON.parse(localStorage.getItem(DEC_LS) || "{}"); all[a] = dec; localStorage.setItem(DEC_LS, JSON.stringify(all)); } catch (e) { /* ignore */ }
  return dec;
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
    // Пулы сети — единственный надёжный источник (19.09.2026: при икоте узла
    // курс GME уезжал в обозреватель и давал $94 и $0.81 вместо $22.5 —
    // капа одной монеты в трёх местах показывала три разных числа).
    // Три попытки; не вышло — последний известный курс любой давности;
    // обозреватель — только если курса не было никогда.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const v = await quoteUsdOnChain(a);
        if (v > 0 && isFinite(v)) return keep(v);
        break; // пула нет — повторять бессмысленно
      } catch (e) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
    }
    if (c?.v > 0) return c.v;
    try {
      const { EXPLORER } = await import("./config.js");
      const j = await (await fetch(`${EXPLORER}/api/v2/tokens/${a}`, { signal: AbortSignal.timeout(5000) })).json();
      const v = parseFloat(j?.exchange_rate);
      if (v > 0) return keep(v);
    } catch (e) { /* нет курса — покажем в валюте */ }
    return 0;
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
