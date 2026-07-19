import { useEffect, useState } from "react";

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

export function usd(n) {
  if (!isFinite(n)) return "$0";
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(2);
}
