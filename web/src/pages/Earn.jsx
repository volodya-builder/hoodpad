import React, { useEffect, useState } from "react";
import { fmtEth, short } from "../lib/web3.js";
import { timeAgo } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { REF_RATE, refStats, loadAllReferrals } from "../lib/referral.js";

export default function Earn({ wallet, onConnect }) {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [board, setBoard] = useState(null);
  const [cp, setCp] = useState(false);

  const pct = Math.round(REF_RATE * 100);
  const link = wallet
    ? `${location.origin}${location.pathname}#/r/${wallet.account.toLowerCase()}`
    : "";

  useEffect(() => {
    if (!wallet) { setStats(null); return; }
    let alive = true;
    refStats(wallet.account)
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats({ rows: [], accrued: 0, paid: 0, pending: 0 }));
    return () => { alive = false; };
  }, [wallet && wallet.account]);

  useEffect(() => {
    let alive = true;
    loadAllReferrals().then((all) => {
      if (!alive) return;
      const cnt = {};
      for (const v of Object.values(all)) {
        if (v && v.ref) cnt[v.ref] = (cnt[v.ref] || 0) + 1;
      }
      setBoard(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 20));
    }).catch(() => alive && setBoard([]));
    return () => { alive = false; };
  }, []);

  const copy = () => {
    try { navigator.clipboard.writeText(link); } catch (e) { /* ignore */ }
    setCp(true); setTimeout(() => setCp(false), 1200);
  };

  return (
    <div className="about-page">
      <div className="page-title">{t("Заработать")}</div>
      <div className="page-sub" style={{ maxWidth: 640 }}>
        {t("Приглашайте трейдеров — получайте {pct}% каждой их комиссии. Навсегда.").replace("{pct}", pct)}
      </div>

      {!wallet ? (
        <div className="panel" style={{ marginTop: 24, maxWidth: 560 }}>
          <div className="page-sub" style={{ margin: 0 }}>{t("Подключите кошелёк, чтобы получить ссылку.")}</div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onConnect}>
            {t("Подключить кошелёк")}
          </button>
        </div>
      ) : (
        <>
          <div className="ref-link-box">
            <span className="mono ref-link">{link}</span>
            <button className="btn btn-primary" onClick={copy}>{cp ? t("Скопировано!") : t("Скопировать")}</button>
          </div>

          <div className="stats-grid" style={{ marginTop: 18, maxWidth: 760 }}>
            <div className="stat-card">
              <div className="k">{t("Приведено кошельков")}</div>
              <div className="v">{stats ? stats.rows.length : "…"}</div>
            </div>
            <div className="stat-card">
              <div className="k">{t("Начислено")}</div>
              <div className="v" style={{ color: "var(--gold)" }}>
                {stats ? `${fmtEth(stats.accrued)} ETH` : "…"}
              </div>
            </div>
            <div className="stat-card">
              <div className="k">{t("Выплачено")}</div>
              <div className="v">{stats ? `${fmtEth(stats.paid)} ETH` : "…"}</div>
            </div>
            <div className="stat-card">
              <div className="k">{t("К выплате")}</div>
              <div className="v" style={{ color: "var(--gold)" }}>
                {stats ? `${fmtEth(stats.pending)} ETH` : "…"}
              </div>
            </div>
          </div>

          <h2 className="sec-h2" style={{ marginTop: 34 }}>{t("Ваши рефералы")}</h2>
          <div className="panel" style={{ marginTop: 14, padding: 0, maxWidth: 760 }}>
            {!stats ? (
              <div className="ref-row dim">{t("Загружаю…")}</div>
            ) : stats.rows.length === 0 ? (
              <div className="ref-row dim">{t("Пока никого — поделитесь ссылкой.")}</div>
            ) : (
              stats.rows.map((r) => (
                <div className="ref-row" key={r.trader}>
                  <span className="mono">{short(r.trader)}</span>
                  <span className="dim">{r.trades} {t("сделок")}</span>
                  <span className="dim">{timeAgo(r.ts)}</span>
                  <span style={{ color: "var(--gold)", fontWeight: 700 }}>+{fmtEth(r.accrued)} ETH</span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Как это работает")}</h2>
      <div className="ana-grid" style={{ margin: "18px 0 8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {[
          [t("Поделитесь ссылкой"), t("Человек переходит по ней и торгует на hood.")],
          [t("Привязка навсегда"), t("Первая сделка закрепляет трейдера за вами. Дальше учитывается каждая его комиссия.")],
          [t("Получайте ETH"), t("{pct}% каждой комиссии ваших трейдеров — выплаты раз в неделю на ваш кошелёк.").replace("{pct}", pct)],
        ].map(([title, text], i) => (
          <div className="ana-card step-card" key={i}>
            <div className="step-num">{i + 1}</div>
            <div className="fact-title">{title}</div>
            <div className="s" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</div>
          </div>
        ))}
      </div>
      <div className="page-sub" style={{ margin: "4px 0 0", maxWidth: 680 }}>
        {t("Доля реферера берётся из командной части комиссии — казна выкупа и доход создателей не уменьшаются.")}
      </div>

      {board && board.length > 0 && (
        <>
          <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Топ рефереров")}</h2>
          <div className="panel" style={{ marginTop: 14, padding: 0, maxWidth: 560 }}>
            {board.map(([addr, n], i) => (
              <div className="ref-row" key={addr}>
                <span className="dim">#{i + 1}</span>
                <span className="mono">{short(addr)}</span>
                <span>{n} {t("кошельков")}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
