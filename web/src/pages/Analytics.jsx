import React, { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { formatEther } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { treasuryAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER, FEATURES } from "../lib/config.js";
import { useEthUsd, usd } from "../lib/price.js";
import { loadTokens, allTrades, loadSplit, loadSupport, useSplit, subgraphTreasuryOps } from "../lib/data.js";
import { loadArenaPayouts } from "../lib/arena.js";
import { useLang } from "../lib/i18n.jsx";
import Leaderboard from "./Leaderboard.jsx";

const PERIODS = [
  ["24h", "24ч", 86400],
  ["week", "Неделя", 7 * 86400],
  ["month", "Месяц", 30 * 86400],
  ["all", "Всё время", 0],
];

// окно графика в днях для каждого периода (как у Pons)
const CHART_DAYS = { "24h": 14, week: 56, month: 60, all: 60 };

const PERIOD_LABEL = {
  "24h": "за 24 часа", week: "за неделю", month: "за месяц", all: "за всё время",
};

/** Сравнение с предыдущим периодом такой же длины.
 *  Стрелка и подпись несут смысл сами по себе — цвет только усиливает,
 *  поэтому дальтоник прочитает карточку так же, как все. */
function Delta({ now, was, period }) {
  // Изменение к прошлому периоду той же длины: только число, цвет — усиление.
  if (was == null || period === "all") return null;
  if (was === 0) return now > 0 ? <span className="ana-delta up">{"new"}</span> : null;
  const pct = ((now - was) / was) * 100;
  if (!isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.5;
  return <span className={`ana-delta ${flat ? "flat" : pct > 0 ? "up" : "down"}`}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
}

/** Мини-гистограмма как на карточках аналитики.
 *  bins: [{ v, from, to }] — значение и границы корзины по времени. */
function Bars({ data, bins, fmtVal, hover, setHover, period }) {
  // Столбики как у Pons: скруглённые, спокойные; под мышью — яркий, остальные
  // приглушаются; последний (сейчас) — акцентный. Значение и дата корзины
  // показываются в шапке карточки, а не во всплывашке.
  const max = Math.max(...data, 0);
  const W = 1000, H = 300, PAD_R = 70, PAD_B = 26, TOP = 10;
  const n = data.length;
  const slot = (W - PAD_R) / n, gap = Math.max(3, Math.min(10, slot * 0.28)), bw = slot - gap;
  const grid = [0.25, 0.5, 0.75, 1];
  const fmtAxis = (ts) => {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][d.getMonth()]}`;
  };
  const yOf = (v) => TOP + (1 - (max > 0 ? v / max : 0)) * (H - PAD_B - TOP);
  return (
    <svg className="ana-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="anaBarGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e6e6e3" /><stop offset="1" stopColor="#7c7c79" /></linearGradient>
        <linearGradient id="anaBarHl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#c9c9c5" /></linearGradient>
        <linearGradient id="anaBarNow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c8f542" /><stop offset="1" stopColor="#a6d92e" /></linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g}>
          <line x1="0" x2={W - PAD_R - 6} y1={yOf(max * g)} y2={yOf(max * g)} className="ana-grid-line" />
          <text x={W - PAD_R + 4} y={yOf(max * g) + 4} className="ana-grid-lbl">{fmtVal ? fmtVal(max * g, true) : Math.round(max * g)}</text>
        </g>
      ))}
      {data.map((v, i) => {
        const h = max > 0 ? Math.max(4, (v / max) * (H - PAD_B - TOP)) : 4;
        const x = i * (bw + gap);
        const cls = `ana-svg-bar ${i === n - 1 ? "now" : ""} ${hover === i ? "hl" : hover !== null ? "dim" : ""}`;
        return (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x} y={TOP} width={bw} height={H - PAD_B - TOP} fill="transparent" />
            <rect x={x} y={H - PAD_B - h} width={bw} height={h} rx={Math.min(6, bw / 2)} className={cls} />
          </g>
        );
      })}
      {bins && bins.length > 1 && [0, Math.floor((n - 1) / 2), n - 1].map((i) => (
        <text key={i} x={i === 0 ? 0 : i === n - 1 ? (n - 1) * (bw + gap) + bw : i * (bw + gap) + bw / 2}
              y={H - 6} className="ana-axis-lbl" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
          {fmtAxis(bins[i].from)}
        </text>
      ))}
    </svg>
  );
}

// Память вкладки между заходами (+ localStorage — мгновенно после перезагрузки)
let _anaRaw = null;
const ANA_LS = "hood_cache_analytics_v2";
const _bigR = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v);
const _bigV = (k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v);
try {
  const s = localStorage.getItem(ANA_LS);
  if (s) _anaRaw = JSON.parse(s, _bigV);
} catch (e) { /* ignore */ }

export default function Analytics() {
  const { t } = useLang();
  const split = useSplit();
  const rate = useEthUsd();
  // ETH → доллары: крупная сумма на карточках
  const D = (e) => {
    const v = (e || 0) * rate;
    return v >= 1000 ? usd(v) : "$" + v.toFixed(2);
  };
  const [raw, setRaw] = useState(_anaRaw);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("all");
  const [chart, setChart] = useState("vol");
  const [hover, setHover] = useState(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [lbOpen, setLbOpen] = useState(true); // лидеры раскрыты по умолчанию, сворачиваются кликом

  useEffect(() => {
    let alive = true;
    (async () => {
      // Масштабируемая схема: 2 запроса к индексатору (токены + сделки),
      // казна — из кэша treasuryOps, и всего 3 RPC-вызова. Никаких циклов по пулам.
      const [tokens, trades, split2, sup, ops, arenaPays] = await Promise.all([
        loadTokens(),
        allTrades(),
        loadSplit(),
        loadSupport().catch(() => ({ totalBought: 0, totalBurned: 0, buybackCount: null })),
        subgraphTreasuryOps().catch(() => []),
        loadArenaPayouts().catch(() => []),
      ]);
      // выкупы по дням: старая казна (сабграф) + казна арены (события Buyback)
      const buybacks = [
        ...ops.filter((o) => o.kind === "buyback").map((o) => ({ ts: Number(o.timestamp) * 1000, eth: Number(o.ethAmount || 0) / 1e18 })),
        ...arenaPays.flatMap(({ day, rows }) => rows.map((r) => ({ ts: Date.parse(day + "T00:00:00Z") + 3600_000, eth: r.eth || 0 }))),
      ];
      const launchTs = tokens.map((tk) => Number(tk.createdAt || 0)).filter((x) => x > 0);
      const shareBps = (split2?.creator ?? 50) * 100;
      for (const tr of trades) tr.shareBps = shareBps;

      // Карта пул → токен (создатель, тикер)
      const byPool = {};
      for (const tk of tokens) byPool[(tk.pool || "").toLowerCase()] = tk;

      // Лидерборды: создатели по заработанным комиссиям, трейдеры по объёму
      const creatorsMap = {};
      const tradersMap = {};
      for (const tr of trades) {
        const tk = byPool[tr.pool];
        if (tk?.creator) {
          const key = tk.creator.toLowerCase();
          const c = creatorsMap[key] ?? { earned: 0, symbols: [] };
          c.earned += tr.fee * (shareBps / 10000);
          if (!c.symbols.includes(tk.symbol)) c.symbols.push(tk.symbol);
          creatorsMap[key] = c;
        }
        const k = tr.addr.toLowerCase();
        const x = tradersMap[k] ?? { volume: 0, count: 0 };
        x.volume += tr.eth + tr.fee;
        x.count += 1;
        tradersMap[k] = x;
      }
      const leaders = {
        creators: Object.entries(creatorsMap).sort((a, b) => b[1].earned - a[1].earned).slice(0, 10),
        traders: Object.entries(tradersMap).sort((a, b) => b[1].volume - a[1].volume).slice(0, 10),
      };

      // Казна: 3 лёгких вызова (баланс и два счётчика)
      const [treBal, received, spent] = await Promise.all([
        publicClient.getBalance({ address: TREASURY_ADDRESS }),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => 0n),
      ]);

      if (!alive) return;
      _anaRaw = {
        trades, now: Date.now(), launchTs, buybacks,
        launches: tokens.length,
        grads: tokens.filter((tk) => tk.graduated).length,
        treBal, received, spent,
        bought: sup.totalBought ?? 0, burned: sup.totalBurned ?? 0,
        buybackCount: sup.buybackCount ?? null, leaders,
      };
      try { localStorage.setItem(ANA_LS, JSON.stringify(_anaRaw, _bigR)); } catch (e) { /* ignore */ }
      setRaw(_anaRaw);
    })().catch((e) => { if (alive && !_anaRaw) setError(e.shortMessage || e.message); });
    return () => { alive = false; };
  }, []);

  // Закрытие выбора диапазона: клик мимо, Esc. Без этого меню
  // остаётся висеть, когда человек уходит мышкой в сторону.
  useEffect(() => {
    if (!rangeOpen) return;
    const close = () => setRangeOpen(false);
    const onKey = (e) => { if (e.key === "Escape") setRangeOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [rangeOpen]);

  const stats = useMemo(() => {
    if (!raw) return null;
    const secs = PERIODS.find(([k]) => k === period)[2];
    const cutoff = secs > 0 ? raw.now - secs * 1000 : 0;
    const filtered = raw.trades.filter((tr) => !cutoff || (tr.ts ?? 0) >= cutoff);

    const volume = filtered.reduce((s, tr) => s + tr.eth + tr.fee, 0);
    const creatorPaid = filtered.reduce((s, tr) => s + tr.fee * (tr.shareBps / 10000), 0);

    // График как у Pons: всегда по дням, окно шире выбранного периода —
    // 24ч → 14 дней, неделя → 56, месяц и всё время → 60. Последняя
    // корзина — сегодня (с полуночи до сейчас).
    const N = CHART_DAYS[period];
    const day0 = new Date(raw.now); day0.setHours(0, 0, 0, 0);
    const DAY = 86400 * 1000;
    const t0 = day0.getTime() - (N - 1) * DAY;
    const volBars = Array(N).fill(0);
    const cntBars = Array(N).fill(0);
    const lauBars = Array(N).fill(0);
    const buyBars = Array(N).fill(0);
    let chartLau = 0, chartBuy = 0;
    for (const ts of raw.launchTs || []) { if (ts < t0) continue; lauBars[Math.min(N - 1, Math.floor((ts - t0) / DAY))] += 1; chartLau += 1; }
    for (const b of raw.buybacks || []) { if (b.ts < t0) continue; buyBars[Math.min(N - 1, Math.floor((b.ts - t0) / DAY))] += b.eth; chartBuy += b.eth; }
    const bins = Array.from({ length: N }, (_, i) => ({ from: t0 + i * DAY, to: t0 + (i + 1) * DAY }));
    let chartVol = 0, chartCnt = 0;
    for (const tr of raw.trades) {
      const ts = tr.ts ?? raw.now;
      if (ts < t0) continue;
      const i = Math.min(N - 1, Math.max(0, Math.floor((ts - t0) / DAY)));
      volBars[i] += tr.eth + tr.fee;
      cntBars[i] += 1;
      chartVol += tr.eth + tr.fee; chartCnt += 1;
    }
    // Предыдущий период той же длины — чтобы показать, куда двинулось.
    // Для «всё время» сравнивать не с чем.
    let prev = null;
    if (secs > 0) {
      const from = cutoff - secs * 1000;
      const p = raw.trades.filter((tr) => (tr.ts ?? 0) >= from && (tr.ts ?? 0) < cutoff);
      prev = {
        volume: p.reduce((s2, tr) => s2 + tr.eth + tr.fee, 0),
        count: p.length,
        creatorPaid: p.reduce((s2, tr) => s2 + tr.fee * (tr.shareBps / 10000), 0),
      };
    }

    return { volume, creatorPaid, count: filtered.length, volBars, cntBars, bins, t0, tEnd: raw.now, prev, chartVol, chartCnt, chartDays: N, lauBars, buyBars, chartLau, chartBuy };
  }, [raw, period]);

  // подписи оси времени под мини-графиками
  const axisLabels = React.useMemo(() => {
    if (!stats) return null;
    const f = (ts) => {
      const d = new Date(ts);
      const p = (x) => String(x).padStart(2, "0");
      return period === "24h" ? `${p(d.getHours())}:${p(d.getMinutes())}`
        : `${p(d.getDate())}.${p(d.getMonth() + 1)}`;
    };
    return [f(stats.t0), f(stats.tEnd)];
  }, [stats, period]);

  const gradRate = raw && raw.launches > 0
    ? Math.round((raw.grads / raw.launches) * 100) : 0;

  return (
    <>
      <div className="ana-head">
        <div className="page-title" style={{ margin: 0 }}>{t("Аналитика")}</div>
        <div className="seg">
          {PERIODS.map(([k, lbl]) => (
            <button key={k} type="button" className={`seg-btn ${period === k ? "on" : ""}`} onClick={() => setPeriod(k)}>{t(lbl)}</button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!stats && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {stats && raw && (() => {
        const series = chart === "count" ? stats.cntBars : chart === "launch" ? stats.lauBars : chart === "buyback" ? stats.buyBars : stats.volBars;
        const isCount = chart === "count" || chart === "launch";
        const fmtVal = isCount ? (v, axis) => (axis ? String(Math.round(v)) : `${Math.round(v)}`) : (v, axis) => (axis ? usd(v * rate) : D(v));
        const chartTotal = chart === "count" ? stats.chartCnt : chart === "launch" ? stats.chartLau : chart === "buyback" ? D(stats.chartBuy) : D(stats.chartVol);
        const chartName = { vol: "Объём", count: "Сделки", launch: "Запуски", buyback: "Выкупы" }[chart];
        const hv = hover !== null && stats.bins[hover] ? { v: series[hover], from: stats.bins[hover].from, to: stats.bins[hover].to } : null;
        const d = (ts) => { const x = new Date(ts); return `${x.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][x.getMonth()]}`; };
        return (
        <>
        <div className="ana-strip">
          <div className="ana-stat">
            <div className="n">{D(stats.volume)}</div>
            <div className="l">{t("Объём")} <Delta now={stats.volume} was={stats.prev && stats.prev.volume} period={period} /></div>
          </div>
          <div className="ana-stat">
            <div className="n">{stats.count}</div>
            <div className="l">{t("Сделки")} <Delta now={stats.count} was={stats.prev && stats.prev.count} period={period} /></div>
          </div>
          <div className="ana-stat">
            <div className="n">{raw.launches}</div>
            <div className="l">{t("Запуски")} <span className="dim">· {raw.grads} {t("градаций")}</span></div>
          </div>
          <div className="ana-stat">
            <div className="n">{D(stats.creatorPaid)}</div>
            <div className="l">{t("Создателям")} <Delta now={stats.creatorPaid} was={stats.prev && stats.prev.creatorPaid} period={period} /></div>
          </div>
        </div>

        <div className="ana-panel">
          <div className="ana-panel-head">
            <div>
              <div className="ana-panel-val">{hv ? fmtVal(hv.v) : chartTotal}</div>
              <div className="ana-panel-sub">{hv ? d(hv.from) : `${t(chartName)}, ${stats.chartDays} ${t("дней")}`}</div>
            </div>
            <div className="seg">
              <button type="button" className={`seg-btn ${chart === "vol" ? "on" : ""}`} onClick={() => setChart("vol")}>{t("Объём")}</button>
              <button type="button" className={`seg-btn ${chart === "count" ? "on" : ""}`} onClick={() => setChart("count")}>{t("Сделки")}</button>
              <button type="button" className={`seg-btn ${chart === "launch" ? "on" : ""}`} onClick={() => setChart("launch")}>{t("Запуски")}</button>
              <button type="button" className={`seg-btn ${chart === "buyback" ? "on" : ""}`} onClick={() => setChart("buyback")}>{t("Выкупы")}</button>
            </div>
          </div>
          <Bars data={series} bins={stats.bins} fmtVal={fmtVal} hover={hover} setHover={setHover} period={period} />
        </div>
        </>);
      })()}

      {/* Лидеры — раскрывающаяся панель внутри аналитики (спрятана FEATURES.leaders) */}
      {FEATURES.leaders && <div className="bottom-card lb-fold" style={{ marginTop: 22 }}>
        <div className="lb-fold-head" onClick={() => setLbOpen(!lbOpen)}>
          <span><Icon name="trophy" /> {t("Лидеры")}</span>
          <span className="dim" style={{ fontSize: 13 }}>
            {t("создатели и трейдеры")} {lbOpen ? "▲" : "▼"}
          </span>
        </div>
        {lbOpen && <Leaderboard embedded />}
      </div>}

    </>
  );
}
