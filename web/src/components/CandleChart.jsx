import React, { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

// Профессиональный свечной график на TradingView Lightweight Charts.
// Свечи строятся из сделок кривой (points: mcap после каждой сделки).
const INTERVALS = [
  ["1м", 60], ["5м", 300], ["15м", 900], ["1ч", 3600], ["4ч", 14400], ["1д", 86400],
];

function buildCandles(points, trades, rate, ivSec) {
  const pts = points.filter((p) => p.ts).sort((a, b) => a.ts - b.ts);
  const buckets = new Map();
  for (const p of pts) {
    const tb = Math.floor(p.ts / 1000 / ivSec) * ivSec;
    const v = p.mcap * rate;
    const c = buckets.get(tb);
    if (!c) buckets.set(tb, { time: tb, open: v, high: v, low: v, close: v });
    else { c.high = Math.max(c.high, v); c.low = Math.min(c.low, v); c.close = v; }
  }
  const candles = [...buckets.values()].sort((a, b) => a.time - b.time);
  // непрерывность: open свечи = close предыдущей
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close, c = candles[i];
    c.open = prev; c.high = Math.max(c.high, prev); c.low = Math.min(c.low, prev);
  }
  const volMap = new Map();
  for (const tr of trades || []) {
    if (!tr.ts) continue;
    const tb = Math.floor(tr.ts / 1000 / ivSec) * ivSec;
    volMap.set(tb, (volMap.get(tb) || 0) + tr.eth);
  }
  const volumes = candles.map((c) => ({
    time: c.time, value: volMap.get(c.time) || 0,
    color: c.close >= c.open ? "#c8f42b55" : "#e06a4a55",
  }));
  return { candles, volumes };
}

export default function CandleChart({ points, trades, rate, marks }) {
  const { t } = useLang();
  const ref = useRef(null);
  const [iv, setIv] = useState(300);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const styles = getComputedStyle(document.documentElement);
    const dim = styles.getPropertyValue("--text-dim").trim() || "#9a9b90";
    const chart = createChart(el, {
      height: 330, autoSize: true,
      layout: { background: { color: "transparent" }, textColor: dim, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#80808018" }, horzLines: { color: "#80808018" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#80808030" },
      rightPriceScale: { borderColor: "#80808030" },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (v) => usd(v) },
    });
    const cs = chart.addCandlestickSeries({
      upColor: "#c8f42b", downColor: "#e06a4a",
      wickUpColor: "#c8f42b", wickDownColor: "#e06a4a",
      borderVisible: false,
      priceFormat: { type: "custom", formatter: (v) => usd(v), minMove: 0.000001 },
    });
    const vs = chart.addHistogramSeries({
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const { candles, volumes } = buildCandles(points, trades, rate, iv);
    cs.setData(candles);
    vs.setData(volumes);

    // отметки казны: выкупы и сжигания
    const times = new Set(candles.map((c) => c.time));
    const markers = (marks || [])
      .map((m) => {
        const tb = Math.floor(m.ts / 1000 / iv) * iv;
        if (!times.has(tb)) return null;
        const burn = m.kind === "burned";
        return {
          time: tb, position: burn ? "aboveBar" : "belowBar",
          color: burn ? "#e06a4a" : "#c8f42b",
          shape: burn ? "arrowDown" : "arrowUp",
          text: burn ? "BRN" : "BUY",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
    if (markers.length) cs.setMarkers(markers);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, trades, rate, iv, marks]);

  return (
    <div>
      <div className="candle-ivs">
        {INTERVALS.map(([lbl, sec]) => (
          <div key={sec} className={`fpill ${iv === sec ? "on" : ""}`} onClick={() => setIv(sec)}>
            {t(lbl)}
          </div>
        ))}
      </div>
      <div ref={ref} style={{ width: "100%", marginTop: 8 }} />
    </div>
  );
}
