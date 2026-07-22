import React, { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { treasuryAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { useEthUsd, usd } from "../lib/price.js";
import { loadTokens, allTrades, loadSplit, loadSupport, useSplit } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import Leaderboard from "./Leaderboard.jsx";

const PERIODS = [
  ["24h", "24ч", 86400],
  ["week", "Неделя", 7 * 86400],
  ["month", "Месяц", 30 * 86400],
  ["all", "Всё время", 0],
];

const PERIOD_LABEL = {
  "24h": "за 24 часа", week: "за неделю", month: "за месяц", all: "за всё время",
};

/** Мини-гистограмма как на карточках аналитики.
 *  bins: [{ v, from, to }] — значение и границы корзины по времени. */
function Bars({ data, bins, fmtVal, axis }) {
  const max = Math.max(...data, 0);
  const [hover, setHover] = React.useState(null);
  const tf = (ts) => {
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return (
    <div className="ana-bars-wrap">
      {hover !== null && bins && bins[hover] && (
        <div className="ana-tip">
          <b>{fmtVal ? fmtVal(data[hover]) : data[hover]}</b>
          <span>{tf(bins[hover].from)} — {tf(bins[hover].to)}</span>
        </div>
      )}
      <div className="ana-bars" onMouseLeave={() => setHover(null)}>
      {data.map((v, i) => (
        <div
          key={i}
          className={`ana-bar ${v > 0 ? "on" : ""} ${hover === i ? "hl" : ""}`}
          onMouseEnter={() => setHover(i)}
          title={bins && bins[i] ? `${fmtVal ? fmtVal(v) : v} · ${tf(bins[i].from)} — ${tf(bins[i].to)}` : ""}
          style={{ height: max > 0 && v > 0 ? `${Math.max(6, (v / max) * 100)}%` : "3px" }}
        />
      ))}
      </div>
      {axis && (
        <div className="ana-axis">
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      )}
    </div>
  );
}

// Память вкладки между заходами (+ localStorage — мгновенно после перезагрузки)
let _anaRaw = null;
const ANA_LS = "hood_cache_analytics_v1";
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
  const [lbOpen, setLbOpen] = useState(true); // лидеры раскрыты по умолчанию, сворачиваются кликом

  useEffect(() => {
    let alive = true;
    (async () => {
      // Масштабируемая схема: 2 запроса к индексатору (токены + сделки),
      // казна — из кэша treasuryOps, и всего 3 RPC-вызова. Никаких циклов по пулам.
      const [tokens, trades, split2, sup] = await Promise.all([
        loadTokens(),
        allTrades(),
        loadSplit(),
        loadSupport().catch(() => ({ totalBought: 0, totalBurned: 0, buybackCount: null })),
      ]);
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
        trades, now: Date.now(),
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

  const stats = useMemo(() => {
    if (!raw) return null;
    const secs = PERIODS.find(([k]) => k === period)[2];
    const cutoff = secs > 0 ? raw.now - secs * 1000 : 0;
    const filtered = raw.trades.filter((tr) => !cutoff || (tr.ts ?? 0) >= cutoff);

    const volume = filtered.reduce((s, tr) => s + tr.eth + tr.fee, 0);
    const creatorPaid = filtered.reduce((s, tr) => s + tr.fee * (tr.shareBps / 10000), 0);

    // 14 корзин для мини-графиков.
    const N = 14;
    const t0 = cutoff || (filtered.length
      ? Math.min(...filtered.map((tr) => tr.ts ?? raw.now))
      : raw.now - 86400 * 1000);
    const w = Math.max(1, (raw.now - t0) / N);
    const volBars = Array(N).fill(0);
    const cntBars = Array(N).fill(0);
    const bins = Array.from({ length: N }, (_, i) => ({ from: t0 + i * w, to: t0 + (i + 1) * w }));
    for (const tr of filtered) {
      const i = Math.min(N - 1, Math.max(0, Math.floor(((tr.ts ?? raw.now) - t0) / w)));
      volBars[i] += tr.eth + tr.fee;
      cntBars[i] += 1;
    }
    return { volume, creatorPaid, count: filtered.length, volBars, cntBars, bins, t0, tEnd: raw.now };
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
      <div className="page-title">{t("Аналитика протокола")}</div>
      <div className="page-sub">{t("Все цифры читаются напрямую из контрактов hood в Robinhood Chain.")}</div>

      <div className="pill-group ana-tabs">
        {PERIODS.map(([k, lbl]) => (
          <div key={k} className={`fpill ${period === k ? "on" : ""}`} onClick={() => setPeriod(k)}>
            {t(lbl)}
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {!stats && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {stats && raw && (
        <div className="ana-grid">
          <div className="ana-card">
            <div className="k">{t("Объём торгов")}</div>
            <div className="pf-usd">{D(stats.volume)}</div>
            <div className="s">{fmtEth(stats.volume)} ETH · {stats.count} {t("сделок")} · {t(PERIOD_LABEL[period])}</div>
            <Bars data={stats.volBars} bins={stats.bins} fmtVal={(v) => `${D(v)} · ${fmtEth(v)} ETH`}
                  axis={axisLabels} />
          </div>
          <div className="ana-card">
            <div className="k">{t("Сделки")}</div>
            <div className="v">{stats.count}</div>
            <div className="s">{t(PERIOD_LABEL[period])}</div>
            <Bars data={stats.cntBars} bins={stats.bins}
                  fmtVal={(v) => `${v} ${t("сделок")}`} axis={axisLabels} />
          </div>
          <div className="ana-card">
            <div className="k">{t("Запуски токенов")}</div>
            <div className="v">{raw.launches}</div>
            <div className="s">
              {raw.grads} {t("градаций")} · {t("доля градаций")} {gradRate}%
            </div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Выплачено создателям")}</div>
            <div className="pf-usd" style={{ color: "var(--gold)" }}>{D(stats.creatorPaid)}</div>
            <div className="s">
              {fmtEth(stats.creatorPaid)} ETH · {split.creator}% {t("всех комиссий — с первого трейда")}
            </div>
          </div>
          {(() => {
            const bal = Number(formatEther(raw.treBal));
            const rec = Number(formatEther(raw.received));
            const spent = Number(formatEther(raw.spent));
            return (<>
              <div className="ana-card">
                <div className="k">{t("Казна выкупа")}</div>
                <div className="pf-usd" style={{ color: "var(--gold)" }}>{D(bal)}</div>
                <div className="s">
                  {fmtEth(bal)} ETH
                  {" · "}
                  <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
                    {t("контракт")}
                  </a>
                </div>
              </div>
              <div className="ana-card">
                <div className="k">{t("Выкуплено и сожжено")}</div>
                <div className="pf-usd">{D(spent)}</div>
                <div className="s">{fmtEth(spent)} ETH</div>
              </div>
            </>);
          })()}
        </div>
      )}

      {/* Лидеры — раскрывающаяся панель внутри аналитики */}
      <div className="bottom-card lb-fold" style={{ marginTop: 22 }}>
        <div className="lb-fold-head" onClick={() => setLbOpen(!lbOpen)}>
          <span>🏆 {t("Лидеры")}</span>
          <span className="dim" style={{ fontSize: 13 }}>
            {t("создатели и трейдеры")} {lbOpen ? "▲" : "▼"}
          </span>
        </div>
        {lbOpen && <Leaderboard embedded />}
      </div>

    </>
  );
}
