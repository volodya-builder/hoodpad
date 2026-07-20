import React, { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

// Профессиональный свечной график на TradingView Lightweight Charts.
// Свечи строятся из сделок кривой (points: mcap после каждой сделки).
// График создаётся ОДИН раз и обновляется данными — зум/скролл пользователя
// не сбрасываются при фоновом обновлении.
const INTERVALS = [
  ["1м", 60], ["5м", 300], ["15м", 900], ["1ч", 3600], ["4ч", 14400], ["1д", 86400],
];

// объём в долларах: маленькие суммы с центами, большие — компактно ($3.1k)
const volUsd = (x) => (x >= 1000 ? usd(x) : "$" + (x || 0).toFixed(2));

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

export default function CandleChart({ points, trades, rate, marks, lines }) {
  const { t } = useLang();
  const ref = useRef(null);
  const chartRef = useRef(null); // { chart, cs, vs, priceLines, fitted, volByTime, volTotal }
  const legendRef = useRef(null);
  const [iv, setIv] = useState(300);
  const [logScale, setLogScale] = useState(false);
  const [fs, setFs] = useState(false); // полноэкранный режим
  const [showLines, setShowLines] = useState(true); // уровни заявок на графике
  const linesRef = useRef([]); // для autoscale

  // создание графика — только при смене интервала/шкалы/полноэкрана
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const styles = getComputedStyle(document.documentElement);
    const dim = styles.getPropertyValue("--text-dim").trim() || "#9a9b90";
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: dim, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#80808018" }, horzLines: { color: "#80808018" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#80808030", rightOffset: 3, minBarSpacing: 0.5 },
      rightPriceScale: { borderColor: "#80808030", mode: logScale ? 1 : 0 },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (v) => usd(v) },
    });
    const cs = chart.addCandlestickSeries({
      upColor: "#c8f42b", downColor: "#e06a4a",
      wickUpColor: "#c8f42b", wickDownColor: "#e06a4a",
      borderVisible: false,
      priceFormat: { type: "custom", formatter: (v) => usd(v), minMove: 0.000001 },
      // автомасштаб учитывает уровни заявок, чтобы пунктирные линии были видны
      autoscaleInfoProvider: (original) => {
        const r = original();
        const vals = (linesRef.current || []).map((l) => l.value).filter((v) => v > 0);
        if (!r || !r.priceRange || vals.length === 0) return r;
        return {
          priceRange: {
            minValue: Math.min(r.priceRange.minValue, ...vals),
            maxValue: Math.max(r.priceRange.maxValue, ...vals),
          },
          margins: r.margins,
        };
      },
    });
    const vs = chart.addHistogramSeries({
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = { chart, cs, vs, priceLines: [], fitted: false, volByTime: new Map(), volTotal: 0, dirByTime: new Map() };

    // объём в левом верхнем углу: всего, а при наведении — объём свечи
    chart.subscribeCrosshairMove((param) => {
      const c = chartRef.current, el = legendRef.current;
      if (!c || !el) return;
      const v = param && param.time != null ? c.volByTime.get(param.time) : undefined;
      if (v != null) {
        // цвет цифр — по направлению свечи
        const up = c.dirByTime.get(param.time);
        el.innerHTML = `Volume: <span style="color:${up ? "var(--leaf, #7ac74f)" : "var(--red, #e06a4a)"}">${volUsd(v * (c.rate || 0))}</span>`;
      } else {
        el.textContent = `Volume: ${volUsd(c.volTotal * (c.rate || 0))}`;
      }
    });

    return () => { chart.remove(); chartRef.current = null; };
  }, [iv, logScale, fs]);

  // обновление данных — без пересоздания и без сброса зума
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const shown = showLines ? (lines || []).filter((l) => l.value > 0) : [];
    linesRef.current = shown; // до setData — autoscale учтёт уровни
    const { candles, volumes } = buildCandles(points, trades, rate, iv);
    c.cs.setData(candles);
    c.vs.setData(volumes);
    c.volByTime = new Map(volumes.map((v) => [v.time, v.value]));
    c.volTotal = volumes.reduce((s, v) => s + v.value, 0);
    c.dirByTime = new Map(candles.map((x) => [x.time, x.close >= x.open]));
    c.rate = rate;
    if (legendRef.current) legendRef.current.textContent = `Volume: ${volUsd(c.volTotal * rate)}`;

    // отметки казны: выкупы и сжигания
    const times = new Set(candles.map((x) => x.time));
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
    c.cs.setMarkers(markers);

    // пунктирные уровни активных заявок
    for (const pl of c.priceLines) { try { c.cs.removePriceLine(pl); } catch (e) { /* ignore */ } }
    c.priceLines = shown.map((l) => c.cs.createPriceLine({
      price: l.value, color: l.color, lineWidth: 1,
      lineStyle: 2 /* dashed */, axisLabelVisible: true, title: l.title,
    }));

    if (!c.fitted && candles.length > 0) {
      const ts = c.chart.timeScale();
      ts.fitContent();
      // мало свечей → fitContent раздувает бары на весь экран; ограничиваем ширину
      try {
        if (ts.options().barSpacing > 40) ts.applyOptions({ barSpacing: 28, rightOffset: 6 });
      } catch (e) { /* ignore */ }
      c.fitted = true;
    }
  }, [points, trades, rate, marks, lines, iv, logScale, fs, showLines]);

  useEffect(() => {
    if (!fs) return;
    const onKey = (e) => { if (e.key === "Escape") setFs(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [fs]);

  return (
    <div className={`chart-wrap ${fs ? "fs" : ""}`}>
      <div className="candle-ivs">
        {INTERVALS.map(([lbl, sec]) => (
          <div key={sec} className={`fpill ${iv === sec ? "on" : ""}`} onClick={() => setIv(sec)}>
            {t(lbl)}
          </div>
        ))}
        {(lines || []).length > 0 && (
          <label className="lines-toggle" style={{ marginLeft: "auto" }}
                 title={t("Показывать уровни заявок на графике")}>
            <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
            {t("Заявки")}
          </label>
        )}
        <div className="fpill" style={(lines || []).length > 0 ? {} : { marginLeft: "auto" }}
             onClick={() => setFs(!fs)}
             title={fs ? t("Свернуть") : t("На весь экран")}>
          {fs ? "✕" : "⛶"}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <div ref={ref} className="chart-resize"
             title={t("Потяните за правый нижний угол, чтобы изменить размер")} />
        <div ref={legendRef} className="chart-legend" />
        <div className={`chart-log-btn ${logScale ? "on" : ""}`}
             onClick={() => setLogScale(!logScale)}
             title={t("Логарифмическая шкала цены")}>
          LOG
        </div>
      </div>
    </div>
  );
}
