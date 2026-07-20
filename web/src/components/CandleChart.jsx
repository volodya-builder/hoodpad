import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

// текст легенды объёма для конкретного бара (цвет — по направлению свечи)
function volLegendHtml(c, tkey) {
  const v = tkey != null ? c.volByTime.get(tkey) : null;
  if (v == null) return `Volume: ${volUsd((c.volTotal || 0) * (c.rate || 0))}`;
  const up = c.dirByTime.get(tkey);
  return `Volume: <span style="color:${up ? "var(--leaf, #7ac74f)" : "var(--red, #e06a4a)"}">${volUsd(v * (c.rate || 0))}</span>`;
}

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

export default function CandleChart({ points, trades, rate, marks, lines, drawKey = "" }) {
  const { t } = useLang();
  const ref = useRef(null);
  const chartRef = useRef(null); // { chart, cs, vs, priceLines, fitted, volByTime, volTotal }
  const legendRef = useRef(null);
  const [iv, setIv] = useState(300);
  const [logScale, setLogScale] = useState(false);
  const [fs, setFs] = useState(false); // полноэкранный режим
  const [showLines, setShowLines] = useState(true); // уровни заявок на графике
  const linesRef = useRef([]); // для autoscale

  // ---- инструменты рисования (тренд, уровень, линейка) ----
  const [tool, setTool] = useState(null); // null | "trend" | "hline" | "ruler"
  const toolRef = useRef(null);
  toolRef.current = tool;
  const drawCvRef = useRef(null);
  const drawingsRef = useRef([]);
  const tempRef = useRef(null);
  const storeKey = () => `hood_draw_${drawKey}_${iv}`;
  const persistDraw = () => {
    try { localStorage.setItem(storeKey(), JSON.stringify(drawingsRef.current)); } catch (e) { /* ignore */ }
  };
  const redrawRef = useRef(() => {});
  redrawRef.current = () => {
    const c = chartRef.current, cv = drawCvRef.current, host = ref.current;
    if (!c || !cv || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth, h = host.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + "px"; cv.style.height = h + "px";
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X = (lg) => c.chart.timeScale().logicalToCoordinate(lg);
    const Y = (p) => c.cs.priceToCoordinate(p);
    const all = tempRef.current ? [...drawingsRef.current, tempRef.current] : drawingsRef.current;
    for (const d of all) {
      ctx.strokeStyle = d.type === "ruler" ? "#e2ff5c" : "var(--gold)";
      ctx.strokeStyle = d.type === "ruler" ? "#e2ff5c" : "#d3b136";
      ctx.lineWidth = 1.5;
      if (d.type === "hline") {
        const y = Y(d.price);
        if (y == null) continue;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillStyle = "#d3b136"; ctx.font = "10px monospace";
        ctx.fillText(usd(d.price), 6, y - 4);
      } else {
        const x1 = X(d.p1.lg), y1 = Y(d.p1.price), x2 = X(d.p2.lg), y2 = Y(d.p2.price);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        ctx.setLineDash(d.type === "ruler" ? [5, 4] : []);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);
        for (const [px, py] of [[x1, y1], [x2, y2]]) {
          ctx.fillStyle = "#0b0b0b"; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();
          ctx.strokeStyle = "#d3b136"; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.stroke();
        }
        if (d.type === "ruler") {
          const pct = d.p1.price !== 0 ? ((d.p2.price - d.p1.price) / d.p1.price) * 100 : 0;
          const label = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
          ctx.font = "600 12px sans-serif";
          const tw = ctx.measureText(label).width + 12;
          const lx = Math.min(x1, x2) + Math.abs(x2 - x1) / 2 - tw / 2;
          const ly = Math.min(y1, y2) - 22;
          ctx.fillStyle = pct >= 0 ? "#7ac74f" : "#e06a4a";
          ctx.beginPath(); ctx.roundRect(lx, ly, tw, 17, 5); ctx.fill();
          ctx.fillStyle = "#0b0b0b";
          ctx.fillText(label, lx + 6, ly + 12.5);
        }
      }
    }
  };

  // загрузка рисунков при смене монеты/интервала
  useEffect(() => {
    try { drawingsRef.current = JSON.parse(localStorage.getItem(storeKey())) || []; }
    catch (e) { drawingsRef.current = []; }
    redrawRef.current();
  }, [drawKey, iv]); // eslint-disable-line

  const cvPoint = (e) => {
    const c = chartRef.current, cv = drawCvRef.current;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { lg: c.chart.timeScale().coordinateToLogical(x), price: c.cs.coordinateToPrice(y), x, y };
  };
  const onDrawDown = (e) => {
    if (!toolRef.current || !chartRef.current) return;
    const p = cvPoint(e);
    if (p.lg == null || p.price == null) return;
    if (toolRef.current === "hline") {
      drawingsRef.current.push({ type: "hline", price: p.price });
      persistDraw(); setTool(null); redrawRef.current();
      return;
    }
    tempRef.current = { type: toolRef.current, p1: { lg: p.lg, price: p.price }, p2: { lg: p.lg, price: p.price } };
    redrawRef.current();
  };
  const onDrawMove = (e) => {
    if (!tempRef.current) return;
    const p = cvPoint(e);
    if (p.lg == null || p.price == null) return;
    tempRef.current.p2 = { lg: p.lg, price: p.price };
    redrawRef.current();
  };
  const onDrawUp = () => {
    const tmp = tempRef.current;
    tempRef.current = null;
    if (tmp && tmp.type === "trend") { drawingsRef.current.push(tmp); persistDraw(); }
    setTool(null);
    redrawRef.current();
  };
  const clearDraw = () => { drawingsRef.current = []; persistDraw(); redrawRef.current(); };

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
    // рисунки следуют за скроллом/зумом
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawRef.current());
    const ro = new ResizeObserver(() => redrawRef.current());
    ro.observe(el);
    chartRef.current.ro = ro;

    // объём в левом верхнем углу: всего, а при наведении — объём свечи
    chart.subscribeCrosshairMove((param) => {
      const c = chartRef.current, el = legendRef.current;
      if (!c || !el) return;
      // курсор не на баре — ближайший бар; курсор вне графика — последний бар
      let tkey = param && param.time != null ? param.time : null;
      if (tkey == null && param && param.point && param.logical != null && c.times && c.times.length) {
        const idx = Math.min(Math.max(Math.round(param.logical), 0), c.times.length - 1);
        tkey = c.times[idx];
      }
      if (tkey == null && c.times && c.times.length) tkey = c.times[c.times.length - 1];
      el.innerHTML = volLegendHtml(c, tkey);
    });

    return () => { try { ro.disconnect(); } catch (e) { /* ignore */ } chart.remove(); chartRef.current = null; };
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
    c.times = candles.map((x) => x.time);
    c.rate = rate;
    if (legendRef.current) {
      legendRef.current.innerHTML = volLegendHtml(c, c.times.length ? c.times[c.times.length - 1] : null);
    }

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

    redrawRef.current();
    if (!c.fitted && candles.length > 0) {
      const ts = c.chart.timeScale();
      ts.fitContent();
      // стартовый зум всегда умеренно отдалённый: бары компактные, вокруг воздух
      try {
        if (ts.options().barSpacing > 12) ts.applyOptions({ barSpacing: 10, rightOffset: 10 });
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

  // в полноэкранном режиме — портал в body: внутри трансформированных блоков
  // сетки position:fixed привязывается к блоку, а не к экрану
  const content = (
    <div className={`chart-wrap ${fs ? "fs" : ""}`}>
      <div className="chart-area" style={{ position: "relative" }}>
        <div ref={ref} className="chart-resize"
             title={t("Потяните за правый нижний угол, чтобы изменить размер")} />
        <canvas ref={drawCvRef} className="draw-canvas"
                style={{ pointerEvents: tool ? "auto" : "none", cursor: tool ? "crosshair" : "default" }}
                onMouseDown={onDrawDown} onMouseMove={onDrawMove} onMouseUp={onDrawUp} />
        <div className="draw-tools">
          <button className={`dt-btn ${tool === "trend" ? "on" : ""}`} title={t("Трендовая линия")}
                  onClick={() => setTool(tool === "trend" ? null : "trend")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="20" x2="20" y2="4" /><circle cx="4" cy="20" r="2.4" fill="currentColor" /><circle cx="20" cy="4" r="2.4" fill="currentColor" />
            </svg>
          </button>
          <button className={`dt-btn ${tool === "hline" ? "on" : ""}`} title={t("Горизонтальный уровень")}
                  onClick={() => setTool(tool === "hline" ? null : "hline")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12" /><circle cx="12" cy="12" r="2.4" fill="currentColor" />
            </svg>
          </button>
          <button className={`dt-btn ${tool === "ruler" ? "on" : ""}`} title={t("Линейка (изменение в %)")}
                  onClick={() => setTool(tool === "ruler" ? null : "ruler")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="10" width="18" height="6" rx="1" transform="rotate(-25 12 13)" />
              <line x1="8" y1="13" x2="8" y2="16" transform="rotate(-25 12 13)" />
              <line x1="13" y1="11" x2="13" y2="14" transform="rotate(-25 12 13)" />
            </svg>
          </button>
          <button className="dt-btn" title={t("Удалить все рисунки")} onClick={clearDraw}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="candle-ivs candle-ivs-overlay">
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
        <div ref={legendRef} className="chart-legend" />
        <div className={`chart-log-btn ${logScale ? "on" : ""}`}
             onClick={() => setLogScale(!logScale)}
             title={t("Логарифмическая шкала цены")}>
          LOG
        </div>
      </div>
    </div>
  );

  return fs ? createPortal(content, document.body) : content;
}
