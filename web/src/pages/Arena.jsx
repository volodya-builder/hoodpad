import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { fmt, fmtEth } from "../lib/web3.js";
import { useEthUsd, usd, usdFine } from "../lib/price.js";
import { useClock } from "../lib/data.js";
import { useArena, grandArena, hallOfFame, dayStart, useArenaPot, useArenaPayouts } from "../lib/arena.js";
import { useLang } from "../lib/i18n.jsx";
import { FEATURES, ARENA_LIVE, EXPLORER } from "../lib/config.js";
import Icon from "../components/Icon.jsx";

// Арена — суточный бой на выживание по честному объёму торгов.
// Экономика (решение владельца 15.09.2026): 20% каждой комиссии платформы
// копятся в казне арены (ArenaTreasury); утром следующего дня бот арены
// делит фонд между подиумом 70/20/10 — выкупает монеты-призёры с рынка и
// сжигает. Подиум и здесь, и у бота считает одно ядро (lib/arena-core.js).
// Оформление — минимализм (просьба владельца 15.09.2026): одна строка
// описания, полоса цифр, три места, таблица. Без комментатора, «болельщика»,
// всплывающих тостов и полос-таймеров. Гранд-Арена — за FEATURES.grandArena.

const SPLIT = [70, 20, 10];

function Countdown({ to }) {
  useClockTick();
  if (!to) return null;
  const s = Math.max(0, Math.floor((to - Date.now()) / 1000));
  const p = (x) => String(x).padStart(2, "0");
  return <span className="mono">{p(Math.floor(s / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>;
}
function useClockTick() {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

const Logo = ({ src }) => (src
  ? <img src={src} alt="" />
  : <span className="ts-ph"><Icon name="image" size={14} style={{ margin: 0 }} /></span>);

const Rank = ({ i }) => (i === 0
  ? <span className="ar-rank ar-rank-ico"><Icon name="crown" size={16} style={{ margin: 0 }} /></span>
  : <span className="ar-rank">{i + 1}</span>);

export default function Arena() {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(1000);
  const st = useArena();
  const pot = useArenaPot();           // фонд казны арены, ETH
  const payouts = useArenaPayouts();   // последние выкупы, по дням

  // сумма: ETH и рядом доллары
  const M = (eth) => (eth === null || eth === undefined
    ? "…"
    : <>{fmtEth(eth)} ETH{rate > 0 && <span className="usd-sub"> ({usdFine(eth * rate)})</span>}</>);
  const D = (eth) => (rate > 0 ? (eth * rate >= 1000 ? usd(eth * rate) : usdFine(eth * rate)) : "…");
  const [cp, setCp] = useState("");
  const [view, setView] = useState("day");
  const copyCA = (e, addr) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(addr); } catch (err) { /* ignore */ }
    setCp(addr); setTimeout(() => setCp(""), 1200);
  };
  const mcapOf = (p) => Number(formatEther(p.price)) * 1e9 * rate;
  const CA = ({ p }) => (
    <span className="mono ar-ca" title={t("Скопировать адрес контракта")} onClick={(e) => copyCA(e, p.token)}>
      {cp === p.token ? `✓ ${t("скопировано")}` : `${p.token.slice(0, 6)}…${p.token.slice(-4)} ⧉`}
    </span>
  );

  return (
    <>
      <div className="page-title">{t("Арена")}</div>
      <div className="page-sub" style={{ maxWidth: 720 }}>
        {t("Суточный турнир по честному объёму торгов. Приз — 20% всех комиссий платформы: каждое утро выкуп и сжигание монет подиума.")}
      </div>

      {!st && <div className="center">{t("Читаю блокчейн…")}</div>}

      {st && st.participants.length === 0 && (
        <div className="center" style={{ padding: 60 }}>
          {t("Сегодня некому сражаться — запустите токен и откройте арену.")}{" "}
          <a href="#/create" style={{ color: "var(--gold)" }}>{t("Запустить токен →")}</a>
        </div>
      )}

      {st && st.participants.length > 0 && (
        <div className="arena-main">
          <div className="bt-tabs" style={{ marginTop: 18 }}>
            <div className={`bt-tab ${view === "day" ? "on" : ""}`} onClick={() => setView("day")}>{t("Бой дня")}</div>
            {FEATURES.grandArena && (
              <div className={`bt-tab ${view === "grand" ? "on" : ""}`} onClick={() => setView("grand")}>{t("Гранд-Арена")}</div>
            )}
            <div className={`bt-tab ${view === "hof" ? "on" : ""}`} onClick={() => setView("hof")}>{t("История побед")}</div>
            <div className={`bt-tab ${view === "rules" ? "on" : ""}`} onClick={() => setView("rules")}>{t("Правила")}</div>
          </div>

          {view === "rules" && (
            <div className="rules-wrap">
              <div className="rl-sec">
                <div className="rl-title">{t("Как проходит день")}</div>
                <div className="rl-foot dim" style={{ marginTop: 0 }}>
                  {t("В 00:00 UTC в бой вступают все неградуировавшие токены. День делится на чекпоинты — по числу участников; на каждом выбывает токен с наименьшими очками боя. Последний выживший — чемпион дня. Выбывание — витрина: торговля не останавливается. Наутро чемпион отдыхает на троне — у остальных честный шанс.")}
                </div>
              </div>

              <div className="rl-sec">
                <div className="rl-title">{t("Очки боя")}</div>
                <div className="rl-formula">
                  <div className="rl-box green"><b>{t("Честный объём")}</b><span className="dim">{t("за день, в ETH")}</span></div>
                  <span className="rl-op">×</span>
                  <div className="rl-box"><b>1 + {t("рост капы")}</b><span className="dim">{t("за день")}</span></div>
                  <span className="rl-op">=</span>
                  <div className="rl-box gold"><b>{t("Очки боя")}</b></div>
                </div>
                <div className="rl-foot dim">
                  {t("Честный объём — покупки минус продажи по каждому кошельку; сделки создателя не считаются; вклад одного кошелька — не больше четверти общего потока. Гонять объём туда-сюда бесполезно, дамп цены режет собственные очки.")}
                </div>
              </div>

              <div className="rl-sec">
                <div className="rl-title">{t("Приз")}</div>
                <div className="rl-foot dim" style={{ marginTop: 0 }}>
                  {t("20% каждой торговой комиссии платформы уходят в казну арены — контракт без функции вывода: деньги оттуда могут только выкупать монеты платформы и сжигать их. Каждое утро (после 00:00 UTC) весь накопленный фонд делится между вчерашним подиумом: 70% первому месту, 20% второму, 10% третьему. Первое место — выживший чемпион, второе и третье — по итоговым очкам; нулевые очки не награждаются. Выкуп с рынка и сжигание: предложение падает, выигрывают все держатели. Исполняет бот, все транзакции — в эксплорере.")}
                </div>
              </div>
            </div>
          )}

          {view === "hof" && (() => {
            const hof = hallOfFame(st.tokens, st.trades, 31);
            if (hof.length === 0) return <div className="center">{t("Первый чемпион появится после финала дня.")}</div>;
            return (
              <div className="arena-list" style={{ marginTop: 18 }}>
                {hof.map(({ day, champion: c }) => (
                  <a key={day} className="arena-row" href={`#/token/${c.token}`}>
                    <Rank i={0} />
                    <Logo src={c.meta.image} />
                    <span className="ar-name">
                      <b>${c.symbol}</b>
                      <CA p={c} />
                    </span>
                    <span className="ar-mcap dim">{new Date(day).toLocaleDateString()}</span>
                    <span className="ar-volwrap">
                      <span className="ar-vol">{t("очки боя")}: {D(c.score ?? c.dayVol ?? 0)}</span>
                    </span>
                    <span className="ar-status" style={{ color: "var(--gold)" }}>{t("Чемпион дня")}</span>
                  </a>
                ))}
              </div>
            );
          })()}

          {FEATURES.grandArena && view === "grand" && (() => {
            const ga = grandArena(st.tokens, st.trades);
            const days = Math.floor(ga.endsIn / 86_400_000);
            const hours = Math.floor((ga.endsIn % 86_400_000) / 3_600_000);
            const maxPts = Math.max(...ga.table.map((r) => r.points + (r.pendingPoints || 0)), 1e-9);
            return (
              <>
                <div className="arena-bar" style={{ marginTop: 18 }}>
                  <div className="ab-cell"><span>{t("В лиге")}</span><b>{ga.table.length}</b></div>
                  <div className="ab-cell"><span>{t("Финал месяца")}</span>
                    <b className="ab-timer">{days}{t("д")} {hours}{t("ч")}</b></div>
                </div>
                {ga.table.length === 0 && <div className="center">{t("Пока нет чемпионов — лига откроется после первого финала дня.")}</div>}
                <div className="arena-list">
                  {ga.table.map((row, i) => {
                    const pts = row.points + (row.pendingPoints || 0);
                    const w = Math.max(3, (pts / maxPts) * 100);
                    return (
                      <a key={row.token.token} className={`arena-row ${i === 0 ? "leader" : ""}`} href={`#/token/${row.token.token}`}>
                        <Rank i={i} />
                        <Logo src={row.token.meta.image} />
                        <span className="ar-name"><b>${row.token.symbol}</b><CA p={row.token} /></span>
                        <span className="ar-mcap">{row.wins} {t("побед")}</span>
                        <span className="ar-volwrap">
                          <span className="ar-volbar"><span style={{ width: `${w}%` }} /></span>
                          <span className="ar-vol">{D(pts)}</span>
                        </span>
                        <span className="ar-status dim">{row.leadingToday ? t("лидирует сегодня") : ""}</span>
                      </a>
                    );
                  })}
                </div>
              </>
            );
          })()}

          {view === "day" && (<>
          <div className="arena-bar" style={{ marginTop: 18 }}>
            <div className="ab-cell">
              <span>{t("В бою")}</span>
              <b>{st.alive.length} / {st.participants.length}</b>
            </div>
            <div className="ab-cell">
              <span>{st.alive.length > 1 ? t("Следующее выбывание") : t("Финал дня")}</span>
              <b className="ab-timer"><Countdown to={st.nextCheckpoint ?? dayStart() + 86_400_000} /></b>
            </div>
            <div className="ab-cell">
              <span>{t("Призовой фонд")}</span>
              <b style={{ color: "var(--gold)" }}>{ARENA_LIVE ? M(pot) : "—"}</b>
            </div>
          </div>

          {/* Три места — только цифры */}
          <div className="podium3 minimal">
            {[t("1 место"), t("2 место"), t("3 место")].map((place, i) => {
              const v = pot === null ? null : pot * (SPLIT[i] / 100);
              return (
                <div className={`pod-card ${["gold", "silver", "bronze"][i]}`} key={place}>
                  <span className="pod-place">{place}</span>
                  <b className="pod-sum">{ARENA_LIVE ? (v === null ? "…" : M(v)) : "—"}</b>
                  <span className="pod-pct">{SPLIT[i]}%</span>
                </div>
              );
            })}
          </div>

          {st.champion && st.alive.length === 1 && (
            <div className="arena-champ">
              <Icon name="crown" /> {t("Чемпион дня")}: <b>${st.champion.symbol}</b>
            </div>
          )}

          <div className="arena-list">
            <div className="arena-hdr">
              <span />
              <span />
              <span>{t("Токен")}</span>
              <span>{t("Капа")}</span>
              <span>{t("Очки боя")}</span>
              <span style={{ textAlign: "right" }} />
            </div>
            {(() => {
              const maxVol = Math.max(...st.alive.map((x) => x.score), 1e-9);
              const secsToElim = Math.max(0, Math.floor(((st.nextCheckpoint ?? 0) - Date.now()) / 1000));
              const p2 = (x) => String(x).padStart(2, "0");
              const eh = Math.floor(secsToElim / 3600);
              const elimClock = eh > 0
                ? `${eh}:${p2(Math.floor((secsToElim % 3600) / 60))}:${p2(secsToElim % 60)}`
                : `${p2(Math.floor(secsToElim / 60))}:${p2(secsToElim % 60)}`;
              return st.alive.map((p, i) => {
                const w = Math.max(3, (p.score / maxVol) * 100);
                const danger = st.alive.length > 1 && i === st.alive.length - 1;
                return (
                  <a key={p.token} className={`arena-row ${i === 0 ? "leader" : ""} ${danger ? "danger" : ""}`} href={`#/token/${p.token}`}>
                    <Rank i={i} />
                    <Logo src={p.meta.image} />
                    <span className="ar-name">
                      <b>${p.symbol}</b>
                      <CA p={p} />
                    </span>
                    <span className="ar-mcap">{usd(mcapOf(p))}</span>
                    <span className="ar-volwrap">
                      <span className="ar-volbar"><span style={{ width: `${w}%` }} /></span>
                      <span className="ar-vol">{D(p.dayVol)}</span>
                    </span>
                    <span className={`ar-status ${danger ? "bad" : ""}`} style={{ textAlign: "right" }}>
                      {danger ? <>{t("выбывает через")} <span className="mono">{elimClock}</span></> : ""}
                    </span>
                  </a>
                );
              });
            })()}

            {st.eliminated.slice().reverse().map(({ token: p, at }) => (
              <a key={p.token} className="arena-row dead" href={`#/token/${p.token}`}>
                <span className="ar-rank">—</span>
                <Logo src={p.meta.image} />
                <span className="ar-name">
                  <b>${p.symbol}</b>
                  <CA p={p} />
                </span>
                <span className="ar-mcap dim">{usd(mcapOf(p))}</span>
                <span className="ar-volwrap dim">
                  {t("выбыл")} {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span />
              </a>
            ))}
          </div>

          {/* Последние выкупы — из событий казны арены */}
          {ARENA_LIVE && payouts && payouts.length > 0 && (
            <div className="arena-pay">
              <div className="sec-h3" style={{ marginTop: 26 }}>{t("Последние выплаты подиуму")}</div>
              {payouts.slice(0, 3).map(({ day, rows }) => (
                <div className="arena-pay-day" key={day}>
                  <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>{day}</div>
                  {rows.map((r) => (
                    <a key={r.tx} className="arena-pay-row" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer">
                      <span className="ar-rank">{r.place}</span>
                      <b>${r.symbol}</b>
                      <span>{M(r.eth)}</span>
                      <span className="dim">{t("сожжено")} {r.tokens >= 1e6 ? `${(r.tokens / 1e6).toFixed(2)}M` : fmt(r.tokens, 0)}</span>
                      <span className="dim mono">{r.tx.slice(0, 8)}… ↗</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          )}
          </>)}
        </div>
      )}
    </>
  );
}
