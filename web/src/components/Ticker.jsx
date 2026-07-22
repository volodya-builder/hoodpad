import React from "react";
import { formatEther } from "viem";
import { fmtEth } from "../lib/web3.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useArena, grandArena } from "../lib/arena.js";
import { useSupport } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

// Бегущая строка событий: арена, крупные сделки, новые токены, казна,
// голосование, Гранд-Арена. Данные — из общих SWR-кэшей, лишних запросов нет.
export default function Ticker() {
  const { t } = useLang();
  const rate = useEthUsd();
  const st = useArena();
  const support = useSupport();
  if (!st || st.participants.length === 0) return null;

  const D = (e) => {
    const v = e * rate;
    return v >= 1000 ? usd(v) : "$" + v.toFixed(2);
  };
  const items = [];

  // арена
  if (st.alive.length > 1 && st.nextCheckpoint) {
    const s = Math.max(0, Math.floor((st.nextCheckpoint - Date.now()) / 1000));
    items.push(<>⚔️ {t("Арена")}: {t("лидер")} <b>${st.alive[0].symbol}</b> · {t("выбывание через")} <b>{Math.floor(s / 3600)}{t("ч")} {Math.floor((s % 3600) / 60)}{t("м")}</b></>);
  }
  if (st.champion && st.alive.length === 1) {
    items.push(<>👑 {t("Чемпион дня")}: <b>${st.champion.symbol}</b></>);
  }

  // крупнейшая сделка за час
  const hourAgo = Date.now() - 3600_000;
  const recent = st.trades.filter((tr) => tr.ts >= hourAgo);
  if (recent.length) {
    const top = recent.reduce((m, tr) => (tr.eth > m.eth ? tr : m));
    const tk = st.tokens.find((x) => (x.pool || "").toLowerCase() === top.pool);
    if (tk) items.push(<>{top.side === "buy" ? "🟢" : "🔴"} {t("Крупнейшая сделка часа")}: <b className={top.side === "buy" ? "side-buy" : "side-sell"}>{D(top.eth)}</b> ${tk.symbol}</>);
  }

  // свежий токен
  const newest = [...st.tokens].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  if (newest && Date.now() - (newest.createdAt || 0) < 24 * 3600_000) {
    const m = Math.floor((Date.now() - newest.createdAt) / 60000);
    items.push(<>🚀 {t("Новый токен")}: <b>${newest.symbol}</b> · {m < 60 ? `${m}${t("м")}` : `${Math.floor(m / 60)}${t("ч")}`} {t("назад")}</>);
  }

  // казна
  items.push(<>🏦 {t("Накоплено на выкупы")}: <b>{D(support.totalEth || treasuryFromTrades(st))}</b></>);

  // голосование: до конца недельного раунда
  const EP = 7 * 86400;
  const left = EP - (Math.floor(Date.now() / 1000) % EP);
  items.push(<>🗳 {t("Голосование")}: {t("до выкупа")} <b>{Math.floor(left / 86400)}{t("д")} {Math.floor((left % 86400) / 3600)}{t("ч")}</b></>);

  // гранд-арена
  const ga = grandArena(st.tokens, st.trades);
  if (ga.table.length) {
    items.push(<>👑 {t("Гранд-Арена")}: {t("лидер")} <b>${ga.table[0].token.symbol}</b> · {"⭐".repeat(Math.min(ga.table[0].wins, 5))}</>);
  }

  // токенов запущено
  items.push(<>🏹 <b>{st.tokens.length}</b> {t("токенов запущено на hood")}</>);

  const row = items.map((it, i) => (
    <span className="tick-item" key={i}>{it}<span className="tick-dot">◆</span></span>
  ));

  return (
    <div className="ticker" aria-hidden>
      <div className="ticker-track">
        {row}
        {items.map((it, i) => (
          <span className="tick-item" key={"b" + i}>{it}<span className="tick-dot">◆</span></span>
        ))}
      </div>
    </div>
  );
}

// казна из кэша арены, если support ещё не загрузился
function treasuryFromTrades(st) {
  return st.trades.reduce((s, tr) => s + tr.fee, 0) * 0.3;
}
