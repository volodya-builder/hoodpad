import { useEffect, useState } from "react";

// ETH/USD с публичного API, кэш 60с, фолбэк если API недоступен
let cached = { v: null, t: 0 };
const FALLBACK = 3800;

export async function ethUsd() {
  if (cached.v && Date.now() - cached.t < 60_000) return cached.v;
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const j = await r.json();
    if (j?.ethereum?.usd) cached = { v: j.ethereum.usd, t: Date.now() };
  } catch (e) { /* keep cache/fallback */ }
  if (!cached.v) cached = { v: FALLBACK, t: Date.now() };
  return cached.v;
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
