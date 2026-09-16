import React, { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { fmt, fmtEth } from "../lib/web3.js";
import { useEthUsd, useQuoteUsd, usd, usdFine } from "../lib/price.js";
import { formatUnits } from "viem";
import { useClock, timeAgo } from "../lib/data.js";
import { useArena, grandArena, hallOfFame, dayStart, useArenaPot, useArenaPayouts } from "../lib/arena.js";
import { useLang } from "../lib/i18n.jsx";
import { FEATURES, ARENA_LIVE, EXPLORER } from "../lib/config.js";
import Icon from "../components/Icon.jsx";
import Who from "../components/Who.jsx";

// Арена — суточный бой на выживание по честному объёму торгов.
// Экономика (решение владельца 15.09.2026): 20% каждой комиссии платформы
// копятся в казне арены (ArenaTreasury); утром следующего дня бот арены
// делит фонд между подиумом 70/20/10 — выкупает монеты-призёры с рынка и
// сжигает. Подиум и здесь, и у бота считает одно ядро (lib/arena-core.js).
//
// Оформление — по скриншоту новой версии Pons «Launches» (владелец, 15.09.2026):
// заголовок + одна кнопка, текстовые вкладки с подчёркиванием, полоса
// цифр и таблица-список: логотип, имя и тикер, создатель · возраст, тренд
// дня, капа, очки, статус. Никаких коробок, комментаторов и таймер-полос.

const SPLIT = [70, 20, 10];
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function useTick() {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
}
function clock(to) {
  const s = Math.max(0, Math.floor((to - Date.now()) / 1000));
  const p = (x) => String(x).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const Logo = ({ src }) => (
  <span className="lt-logo">
    {src ? <img src={src} alt="" loading="lazy" /> : <Icon name="image" size={16} style={{ margin: 0, opacity: .5 }} />}
  </span>
);

/** Тренд дня: цена по сделкам пула с начала дня. Зелёный — выше старта, красный — ниже. */
function Spark({ trades, pool, from }) {
  const pts = useMemo(() => {
    const p = (pool || "").toLowerCase();
    return trades
      .filter((tr) => tr.pool === p && (tr.ts ?? 0) >= from && tr.tokens > 0)
      .sort((a, b) => a.ts - b.ts)
      .map((tr) => tr.eth / tr.tokens);
  }, [trades, pool, from]);
  const W = 120, H = 34;
  if (pts.length < 2) return <svg className="lt-spark flat" viewBox={`0 0 ${W} ${H}`}><line x1="0" x2={W} y1={H / 2} y2={H / 2} /></svg>;
  const min = Math.min(...pts), max = Math.max(...pts);
  const y = (v) => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6));
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * W},${y(v)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return <svg className={`lt-spark ${up ? "up" : "down"}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><path d={d} /></svg>;
}

export default function Arena() {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(1000);
  useTick();
  const st = useArena();
  const pot = useArenaPot();           // фонд казны арены, ETH
  const payouts = useArenaPayouts();   // последние выкупы, по дням
  const [view, setView] = useState("day");

  const D = (eth) => (rate > 0 ? (eth * rate >= 1000 ? usd(eth * rate) : usdFine(eth * rate)) : "…");
  const E = (eth) => `${fmtEth(eth)} ETH`;
  const mcapOf = (p) => Number(formatEther(p.price)) * 1e9 * rate;
  const day0 = dayStart();
  const nextCp = st ? (st.nextCheckpoint ?? day0 + 86_400_000) : null;

  const tabs = [
    ["day", t("Бой дня")],
    ...(FEATURES.grandArena ? [["grand", t("Гранд-Арена")]] : []),
    ["hof", t("История побед")],
    ["rules", t("Правила")],
  ];

  const Row = ({ p, i, trend = true, right, sub, dim, podium }) => {
    // монета за валюту: капа через курс валюты, а не ETH
    const qPrice = useQuoteUsd(p.q?.addr);
    const mcap = p.q ? Number(formatUnits(p.price, p.q.dec)) * 1e9 * qPrice : mcapOf(p);
    return (
    <a className={`lt-row ${dim ? "dim" : ""} ${podium ? `podium podium-${podium}` : ""}`} href={`#/token/${p.token}`}>
      <span className="lt-rank">{i != null ? i + 1 : ""}</span>
      <Logo src={p.meta?.image} />
      <span className="lt-tok">
        <span className="lt-name">{p.name || p.symbol} <em>${p.symbol}</em></span>
        <span className="lt-sub">
          {p.creator && <Who addr={p.creator} size={14} />}
          {p.creator && p.createdAt ? " · " : ""}
          {p.createdAt ? timeAgo(p.createdAt) : ""}
          {sub}
        </span>
      </span>
      <span className="lt-trend">{trend && st ? <Spark trades={st.trades} pool={p.pool} from={day0} /> : null}</span>
      <span className="lt-num">{p.q && !(qPrice > 0) ? "…" : usd(mcap)}</span>
      <span className="lt-num">{D(p.score ?? p.dayVol ?? 0)}</span>
      <span className="lt-st">{right}</span>
    </a>
    );
  };

  return (
    <>
      <div className="ana-head">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t("Арена")}</h1>
          <div className="ana-panel-sub">{t("Суточный бой по честному объёму. 20% комиссий платформы — каждое утро выкуп и сжигание монет подиума.")}</div>
        </div>
        <a className="btn btn-primary" href="#/create">{t("Запустить монету")}</a>
      </div>

      <div className="ttabs">
        {tabs.map(([k, lbl]) => (
          <button key={k} type="button" className={`ttab ${view === k ? "on" : ""}`} onClick={() => setView(k)}>{lbl}</button>
        ))}
        {st && st.participants.length > 0 && view === "day" && (
          <span className="ttabs-right">
            {st.alive.length > 1 ? t("выбывание через") : t("финал через")} <span className="mono">{clock(nextCp)}</span>
          </span>
        )}
      </div>

      {!st && <div className="lt-empty">{t("Читаю блокчейн…")}</div>}

      {st && st.participants.length === 0 && view === "day" && (
        <div className="lt-empty">
          {t("Сегодня некому сражаться — запустите токен и откройте арену.")}{" "}
          <a href="#/create" style={{ color: "var(--gold)" }}>{t("Запустить токен →")}</a>
        </div>
      )}

      {view === "rules" && (
        <div className="rules-min">
          <div>
            <h3>{t("Как проходит день")}</h3>
            <p>{t("В 00:00 UTC в бой вступают все неградуировавшие токены. День делится на чекпоинты — по числу участников; на каждом выбывает токен с наименьшими очками боя. Последний выживший — чемпион дня. Выбывание — витрина: торговля не останавливается. Чемпион больше не участвует — одна корона на монету, у остальных честный шанс.")}</p>
          </div>
          <div>
            <h3>{t("Очки боя")}</h3>
            <p>{t("Очки боя = честный объём за день × (1 + рост капы за день).")}</p>
            <p>{t("Честный объём — покупки минус продажи по каждому кошельку; сделки создателя не считаются; вклад одного кошелька — не больше четверти общего потока. Гонять объём туда-сюда бесполезно, дамп цены режет собственные очки.")}</p>
          </div>
          <div>
            <h3>{t("Приз")}</h3>
            <p>{t("20% каждой торговой комиссии платформы уходят в казну арены — контракт без функции вывода: деньги оттуда могут только выкупать монеты платформы и сжигать их. Каждое утро (после 00:00 UTC) весь накопленный фонд делится между вчерашним подиумом: 70% первому месту, 20% второму, 10% третьему. Первое место — выживший чемпион, второе и третье — по итоговым очкам; нулевые очки не награждаются. Выкуп с рынка и сжигание: предложение падает, выигрывают все держатели. Исполняет бот, все транзакции — в эксплорере.")}</p>
          </div>
        </div>
      )}

      {st && view === "hof" && (() => {
        const hof = hallOfFame(st.tokens, st.trades, 31);
        if (hof.length === 0) return <div className="lt-empty">{t("Первый чемпион появится после финала дня.")}</div>;
        return (
          <div className="lt">
            <div className="lt-h"><span /><span /><span>{t("Токен")}</span><span /><span className="r">{t("Капа")}</span><span className="r">{t("Очки боя")}</span><span className="r">{t("День")}</span></div>
            {hof.map(({ day, champion: c }) => {
              const d = new Date(day);
              return <Row key={day} p={c} trend={false} right={<span className="dim">{d.getDate()} {t(MONTHS[d.getMonth()])}</span>} />;
            })}
          </div>
        );
      })()}

      {st && FEATURES.grandArena && view === "grand" && (() => {
        const ga = grandArena(st.tokens, st.trades);
        return (
          <div className="lt">
            <div className="lt-h"><span /><span /><span>{t("Токен")}</span><span /><span className="r">{t("Капа")}</span><span className="r">{t("Очки")}</span><span className="r">{t("Побед")}</span></div>
            {ga.table.map((row, i) => (
              <Row key={row.token.token} p={{ ...row.token, score: row.points + (row.pendingPoints || 0) }} i={i} trend={false} right={row.wins} />
            ))}
          </div>
        );
      })()}

      {st && st.participants.length > 0 && view === "day" && (
        <>
          <div className="ana-strip arena-strip">
            <div className="ana-stat">
              <div className="n">{ARENA_LIVE ? (pot === null ? "…" : D(pot)) : "—"}</div>
              <div className="l">{t("Призовой фонд")}{ARENA_LIVE && pot !== null && <span className="dim">· {E(pot)}</span>}</div>
            </div>
            {SPLIT.map((pct, i) => (
              <div className="ana-stat" key={pct}>
                <div className="n">{ARENA_LIVE ? (pot === null ? "…" : D(pot * pct / 100)) : "—"}</div>
                <div className="l">{i + 1} {t("место")} <span className="dim">· {pct}%</span></div>
              </div>
            ))}
          </div>

          <div className="lt">
            <div className="lt-h">
              <span /><span /><span>{t("Токен")}</span><span>{t("Тренд")}</span>
              <span className="r">{t("Капа")}</span><span className="r">{t("Очки боя")}</span><span className="r" />
            </div>
            {st.alive.map((p, i) => {
              const danger = st.alive.length > 1 && i === st.alive.length - 1;
              const champ = st.alive.length === 1;
              const right = champ
                ? <span className="lt-tag gold"><Icon name="crown" size={13} style={{ margin: 0 }} /> {t("Чемпион дня")}</span>
                : danger
                  ? <span className="lt-tag bad">{t("выбывает")} <span className="mono">{clock(nextCp)}</span></span>
                  : i === 0 ? <span className="lt-tag gold">{t("лидер")}</span> : null;
              return <Row key={p.token} p={p} i={i} right={right} podium={i < 3 ? i + 1 : 0} />;
            })}
            {st.eliminated.slice().reverse().map(({ token: p, at }) => (
              <Row key={p.token} p={p} dim
                   right={<span className="dim">{t("выбыл")} {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>} />
            ))}
          </div>

          {ARENA_LIVE && payouts && payouts.length > 0 && (
            <>
              <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Последние выплаты")}</h2>
              <div className="lt pay">
                {payouts.slice(0, 3).map(({ day, rows }) => rows.map((r) => (
                  <a key={r.tx} className="lt-row" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer">
                    <span className="lt-rank">{r.place}</span>
                    <span className="lt-tok"><span className="lt-name">${r.symbol}</span><span className="lt-sub">{day}</span></span>
                    <span className="lt-num">{E(r.eth)} <span className="dim">({D(r.eth)})</span></span>
                    <span className="lt-num dim">{t("сожжено")} {r.tokens >= 1e6 ? `${(r.tokens / 1e6).toFixed(2)}M` : fmt(r.tokens, 0)}</span>
                    <span className="lt-st dim mono">{r.tx.slice(0, 8)}… ↗</span>
                  </a>
                )))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
