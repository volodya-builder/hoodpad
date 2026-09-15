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

const SOURCES = [
  async () => {
    const j = await (await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    )).json();
    return j?.ethereum?.usd;
  },
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
];

let _pending = null;

/** Последний известный курс без ожидания сети (для расчётов, где ждать нельзя). */
export function ethUsdCached() { return cached.v || FALLBACK; }

export async function ethUsd() {
  if (cached.v && Date.now() - cached.t < 60_000) return cached.v;
  if (_pending) return _pending;
  _pending = (async () => {
    for (const src of SOURCES) {
      try {
        const v = await src();
        if (v && isFinite(v) && v > 0) {
          cached = { v, t: Date.now() };
          try { localStorage.setItem(LS_KEY, JSON.stringify({ v })); } catch (e) { /* ignore */ }
          return v;
        }
      } catch (e) { /* следующий источник */ }
    }
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

export async function quoteUsd(addr) {
  const a = String(addr || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return 0;
  const c = quoteCache[a];
  if (c && Date.now() - c.t < 60_000) return c.v;
  if (_qPending.has(a)) return _qPending.get(a);
  const p = (async () => {
    try {
      const { EXPLORER } = await import("./config.js");
      const j = await (await fetch(`${EXPLORER}/api/v2/tokens/${a}`, { signal: AbortSignal.timeout(5000) })).json();
      const v = parseFloat(j?.exchange_rate);
      if (v > 0) {
        quoteCache[a] = { v, t: Date.now() };
        try { localStorage.setItem(QUOTE_LS, JSON.stringify(quoteCache)); } catch (e) { /* ignore */ }
        return v;
      }
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
    if (!a) return;
    let alive = true;
    quoteUsd(a).then((v) => alive && setRate(v));
    return () => { alive = false; };
  }, [a]);
  return a ? rate : 0;
}
