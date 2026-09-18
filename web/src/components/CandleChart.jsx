import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createChart } from "lightweight-charts";
import { usd } from "../lib/price.js";
import { EXPLORER } from "../lib/config.js";
import { useLang } from "../lib/i18n.jsx";

// Профессиональный свечной график на TradingView Lightweight Charts.
// Свечи строятся из сделок кривой (points: mcap после каждой сделки).
// График создаётся ОДИН раз и обновляется данными — зум/скролл пользователя
// не сбрасываются при фоновом обновлении.
const INTERVALS = [
  ["1м", 60], ["5м", 300], ["15м", 900], ["1ч", 3600], ["4ч", 14400], ["1д", 86400],
];

// число токенов компактно: 334.9K, 1.2M
const compactNum = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(2));

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
    color: c.close >= c.open ? "#4caf6d55" : "#e06a4a55",
  }));
  return { candles, volumes };
}

export default function CandleChart({ points, trades, rate, marks, lines, defaultIv = 300, unit, ethUsd = 0 }) {
  const { t } = useLang();
  const ref = useRef(null);
  const chartRef = useRef(null); // { chart, cs, vs, priceLines, fitted, volByTime, volTotal, dirByTime, times, rate }
  const legendRef = useRef(null);
  const [iv, setIv] = useState(defaultIv);
  const [logScale, setLogScale] = useState(false);
  const [fs, setFs] = useState(false); // полноэкранный режим
  const [showLines, setShowLines] = useState(true); // уровни заявок на графике
  // точки выкупов казны — можно выключить, выбор запоминаем
  const [showMarks, setShowMarks] = useState(() => { try { return localStorage.getItem("hood_chart_marks") === "1"; } catch (e) { return false; } });
  const [dots, setDots] = useState([]); // точки выкупов поверх графика (HTML, чтобы ловить наведение и клик)
  const dotsRef = useRef([]); // [{ time, price, m }]
  const toggleMarks = (v) => { setShowMarks(v); try { localStorage.setItem("hood_chart_marks", v ? "1" : "0"); } catch (e) { /* ignore */ } };
  const hasMarks = (marks || []).some((m) => m.kind === "buyback");
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
      rightPriceScale: { borderColor: "#80808030", mode: logScale ? 1 : 0,
        // воздух сверху/снизу, чтобы свеча не занимала всю высоту
        scaleMargins: { top: 0.25, bottom: 0.2 } },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (v) => usd(v) },
    });
    const cs = chart.addCandlestickSeries({
      upColor: "#4caf6d", downColor: "#e06a4a",
      wickUpColor: "#4caf6d", wickDownColor: "#e06a4a",
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
    chartRef.current = { chart, cs, vs, priceLines: [], fitted: false, volByTime: new Map(), volTotal: 0, dirByTime: new Map(), times: [], rate: 0 };

    // объём в левом верхнем углу: последний бар, при наведении — бар под курсором
    chart.subscribeCrosshairMove((param) => {
      const c = chartRef.current, el2 = legendRef.current;
      if (!c || !el2) return;
      let tkey = param && param.time != null ? param.time : null;
      if (tkey == null && param && param.point && param.logical != null && c.times && c.times.length) {
        const idx = Math.min(Math.max(Math.round(param.logical), 0), c.times.length - 1);
        tkey = c.times[idx];
      }
      if (tkey == null && c.times && c.times.length) tkey = c.times[c.times.length - 1];
      el2.innerHTML = volLegendHtml(c, tkey);
    });

    // точки выкупов: пересчитываем позиции при скролле/зуме и смене размера
    const place = () => {
      const c = chartRef.current;
      if (!c) return;
      const ts = c.chart.timeScale();
      const out = [];
      for (const d of dotsRef.current) {
        const x = ts.timeToCoordinate(d.time);
        const y = c.cs.priceToCoordinate(d.price);
        if (x == null || y == null) continue;
        out.push({ x, y, m: d.m });
      }
      setDots(out);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    const ro = new ResizeObserver(() => setTimeout(place, 0));
    ro.observe(el);
    chartRef.current.place = place;

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
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

    // выкупы казны: маленькая точка под свечой (HTML поверх графика — с
    // карточкой при наведении и ссылкой на сделку); сжигание идёт в той же
    // транзакции, отдельно не отмечаем. Переключатель над графиком.
    const lowByTime = new Map(candles.map((x) => [x.time, x.low]));
    const seen = new Set();
    dotsRef.current = showMarks ? (marks || [])
      .filter((m) => m.kind === "buyback")
      .map((m) => {
        const tb = Math.floor(m.ts / 1000 / iv) * iv;
        if (!lowByTime.has(tb) || seen.has(tb)) return null;
        seen.add(tb);
        return { time: tb, price: lowByTime.get(tb), m };
      })
      .filter(Boolean) : [];
    if (c.place) setTimeout(c.place, 0);

    // пунктирные уровни активных заявок
    for (const pl of c.priceLines) { try { c.cs.removePriceLine(pl); } catch (e) { /* ignore */ } }
    c.priceLines = shown.map((l) => c.cs.createPriceLine({
      price: l.value, color: l.color, lineWidth: 1,
      lineStyle: 2 /* dashed */, axisLabelVisible: true, title: l.title,
    }));

    if (!c.fitted && candles.length > 0) {
      const ts = c.chart.timeScale();
      // фиксированный компактный масштаб + одинаковый воздух слева и справа,
      // чтобы даже 1-2 свечи стояли ПО ЦЕНТРУ и виднелись «издалека»
      try {
        ts.applyOptions({ barSpacing: 8 });
        const n = candles.length;
        const pad = Math.max(8, Math.round(n * 0.6));
        ts.setVisibleLogicalRange({ from: -pad, to: n + pad });
      } catch (e) { try { c.chart.timeScale().fitContent(); } catch (e2) {} }
      c.fitted = true;
    }
  }, [points, trades, rate, marks, lines, iv, logScale, fs, showLines, showMarks]);

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
      <div className="candle-ivs">
        {INTERVALS.map(([lbl, sec]) => (
          <div key={sec} className={`fpill ${iv === sec ? "on" : ""}`} onClick={() => setIv(sec)}>
            {t(lbl)}
          </div>
        ))}
        {hasMarks && (
          <label className="lines-toggle marks-toggle" style={{ marginLeft: "auto" }}
                 title={t("Показывать выкупы казны на графике")}>
            <input type="checkbox" checked={showMarks} onChange={(e) => toggleMarks(e.target.checked)} />
            <i className="mk-dot" />{t("Выкуп")}
          </label>
        )}
        {(lines || []).length > 0 && (
          <label className="lines-toggle" style={hasMarks ? {} : { marginLeft: "auto" }}
                 title={t("Показывать уровни заявок на графике")}>
            <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
            {t("Заявки")}
          </label>
        )}
        <div className="fpill" style={(lines || []).length > 0 || hasMarks ? {} : { marginLeft: "auto" }}
             onClick={() => setFs(!fs)}
             title={fs ? t("Свернуть") : t("На весь экран")}>
          {fs ? "✕" : "⛶"}
        </div>
      </div>
      <div className="chart-area" style={{ position: "relative" }}>
        <div ref={ref} className="chart-resize" />
        <div ref={legendRef} className="chart-legend" />
        {dots.map((d, i) => (
          <a key={i} className="mk-pt" style={{ left: d.x, top: d.y + 10 }}
             href={d.m.tx ? `${EXPLORER}/tx/${d.m.tx}` : undefined} target="_blank" rel="noreferrer">
            <span className="mk-card">
              <b>{t("Выкуп казны")}</b>
              <span>{d.m.eth != null ? `${d.m.eth.toFixed(4)} ETH` : ""}{d.m.eth != null && ethUsd ? ` (${usd(d.m.eth * ethUsd)})` : ""}</span>
              {d.m.tokens != null && <span>{compactNum(d.m.tokens)} {unit || ""}</span>}
              <span>{new Date(d.m.ts).toLocaleString()}</span>
              {d.m.tx && <em>{t("Открыть в обозревателе")}</em>}
            </span>
          </a>
        ))}
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
