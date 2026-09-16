import React, { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits } from "viem";
import Icon from "./Icon.jsx";
import Who from "./Who.jsx";
import { usd, quoteUsd } from "../lib/price.js";
import { timeAgo, prefetchToken } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

// ============================================================================
//  Вкладка «Dev-токены» на странице монеты (как у GMGN, 16.09.2026):
//  все монеты того же создателя — время запуска, градация, комиссии, ATH и
//  текущая капа, объём; справа — сводка по создателю и кольцо «% градаций».
//
//  Данные уже есть в памяти страницы: список монет платформы (tokensList)
//  и все сделки платформы (allTrades — для ATH, объёма и комиссий).
//  Ничего дополнительного с цепи не читаем — вкладка открывается мгновенно.
// ============================================================================

const dollars = (v) => {
  if (!(v > 0)) return "—";
  return v >= 1000 ? usd(v) : "$" + v.toFixed(2);
};

/** Кольцо «доля градаций» — SVG, без библиотек. */
function Ring({ pct, label }) {
  const r = 44, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="dev-ring">
      <svg viewBox="0 0 110 110" width="118" height="118">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--gold)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} transform="rotate(-90 55 55)"
                style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="dev-ring-txt">
        <b>{Math.round(p)}%</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function DevTokens({ creator, tokens, trades, rate, current }) {
  const { t } = useLang();
  const cre = (creator || "").toLowerCase();
  const mine = useMemo(
    () => (tokens || []).filter((x) => (x.creator || "").toLowerCase() === cre)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [tokens, cre],
  );

  // курсы валют монет за акции/крипту — для капы в долларах
  const [qRates, setQRates] = useState({});
  useEffect(() => {
    const addrs = [...new Set(mine.filter((x) => x.q).map((x) => x.q.addr))];
    if (!addrs.length) return;
    let alive = true;
    Promise.all(addrs.map((a) => quoteUsd(a).then((v) => [a, v]).catch(() => [a, 0])))
      .then((rows) => { if (alive) setQRates(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [mine]);

  const mcapUsd = (tk) => tk.q
    ? Number(formatUnits(tk.price, tk.q.dec)) * 1e9 * (qRates[tk.q.addr] || 0)
    : Number(formatEther(tk.price)) * 1e9 * (rate || 0);

  // По сделкам платформы: объём, комиссии и ATH-капа каждой монеты.
  // Доллары — зафиксированные индексатором на момент сделки, если есть.
  const byPool = useMemo(() => {
    const m = {};
    for (const tr of trades || []) {
      const k = (tr.pool || "").toLowerCase();
      const x = m[k] || (m[k] = { vol: 0, fees: 0, athPx: 0 });
      x.vol += tr.usd != null ? tr.usd : (tr.eth + tr.fee) * (rate || 0);
      x.fees += tr.feeUsd != null ? tr.feeUsd : tr.fee * (rate || 0);
      if (tr.tokens > 0 && tr.eth > 0) x.athPx = Math.max(x.athPx, tr.eth / tr.tokens); // ETH-эквивалент за токен
    }
    return m;
  }, [trades, rate]);

  const rows = mine.map((tk) => {
    const st = byPool[(tk.pool || "").toLowerCase()] || { vol: 0, fees: 0, athPx: 0 };
    const cur = mcapUsd(tk);
    const ath = Math.max(cur, st.athPx * 1e9 * (rate || 0));
    return { tk, cur, ath, vol: st.vol, fees: st.fees };
  });

  const grads = mine.filter((x) => x.graduated).length;
  const best = rows.length ? rows.reduce((b, r) => (r.ath > b.ath ? r : b), rows[0]) : null;
  const last = mine[0];

  if (!mine.length) return <div className="dim" style={{ padding: "14px 0" }}>{t("Читаю события…")}</div>;

  return (
    <div className="dev-wrap">
      <div className="dev-table">
        <div className="dev-row hdr">
          <span>{t("Токен")}</span>
          <span>{t("Время")}</span>
          <span>{t("Градация")}</span>
          <span>{t("Комиссии")}</span>
          <span>{t("ATH капа")}</span>
          <span>{t("Капа")}</span>
          <span>{t("Объём")}</span>
        </div>
        {rows.map(({ tk, cur, ath, vol, fees }) => {
          const isCur = (tk.token || "").toLowerCase() === (current || "").toLowerCase();
          return (
            <a className={`dev-row ${isCur ? "cur" : ""}`} key={tk.token} href={`#/token/${tk.token}`}
               onMouseEnter={() => prefetchToken(tk.token)}>
              <span className="dev-coin">
                {tk.meta?.image ? <img src={tk.meta.image} alt="" /> : <span className="ts-ph"><Icon name="image" style={{ margin: 0 }} /></span>}
                <b>${tk.symbol}</b>
                {isCur && <em className="dev-this">{t("эта")}</em>}
              </span>
              <span className="dim">{tk.createdAt ? timeAgo(tk.createdAt) : "—"}</span>
              <span>{tk.graduated
                ? <i className="dev-ok"><Icon name="target" size={12} style={{ margin: 0 }} /> {t("да")}</i>
                : <i className="dim">{t("на кривой")}</i>}</span>
              <span>{dollars(fees)}</span>
              <span className="dev-ath">{dollars(ath)}</span>
              <span>{dollars(cur)}</span>
              <span>{dollars(vol)}</span>
            </a>
          );
        })}
      </div>

      <div className="dev-side">
        <div className="dev-side-main">
          <div className="dev-k">{t("Создатель")}</div>
          <div className="dev-v"><Who addr={creator} title={t("Открыть профиль трейдера")} style={{ color: "var(--gold)" }} /></div>
          <div className="dev-stats">
            <div><span>{t("Всего монет")}</span><b>{mine.length}</b></div>
            <div><span><i className="dev-dot on" />{t("Градуировали")}</span><b>{grads}</b></div>
            <div><span><i className="dev-dot" />{t("Ещё на кривой")}</span><b>{mine.length - grads}</b></div>
          </div>
          {best && (
            <div className="dev-line">
              <span className="dim">{t("Лучшая монета")}</span>{" "}
              <a href={`#/token/${best.tk.token}`}><b>${best.tk.symbol}</b></a>{" "}
              <span className="dim">(ATH {dollars(best.ath)})</span>
            </div>
          )}
          {last && (
            <div className="dev-line">
              <span className="dim">{t("Последний запуск")}</span>{" "}
              <b>{last.createdAt ? timeAgo(last.createdAt) : "—"}</b>
            </div>
          )}
        </div>
        <Ring pct={mine.length ? (grads / mine.length) * 100 : 0} label={t("градаций")} />
      </div>
    </div>
  );
}
