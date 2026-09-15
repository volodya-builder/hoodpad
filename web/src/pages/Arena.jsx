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
// Гранд-Арена (месячная лига старой схемы казны) — за FEATURES.grandArena.

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

// болельщик: за какой токен человек болеет (localStorage)
function useCheer() {
  const [c, setC] = useState(() => { try { return localStorage.getItem("hood_cheer") || ""; } catch (e) { return ""; } });
  const set = (addr) => {
    const v = c.toLowerCase() === (addr || "").toLowerCase() ? "" : (addr || "");
    setC(v);
    try { v ? localStorage.setItem("hood_cheer", v) : localStorage.removeItem("hood_cheer"); } catch (e) { /* ignore */ }
  };
  return [c, set];
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
  const [cheer, setCheer] = useCheer();
  const [toast, setToast] = useState(null);
  const prevElim = React.useRef(null);

  // тост при новом выбывании
  useEffect(() => {
    if (!st) return;
    const cur = new Set(st.eliminated.map((e) => e.token.token.toLowerCase()));
    if (prevElim.current) {
      for (const e of st.eliminated) {
        if (!prevElim.current.has(e.token.token.toLowerCase())) {
          setToast({ sym: e.token.symbol, img: e.token.meta?.image, ts: Date.now() });
          setTimeout(() => setToast((x) => (x && Date.now() - x.ts >= 5500 ? null : x)), 6000);
          break;
        }
      }
    }
    prevElim.current = cur;
  }, [st?.eliminated?.length]);

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
      <div className="page-sub" style={{ maxWidth: 760 }}>
        {t("Каждый день — бой на выживание по честному объёму торгов: на каждом чекпоинте выбывает слабейший, последний выживший — чемпион дня. 20% каждой комиссии платформы копятся в призовой фонд; утром фонд выкупает монеты-призёры с рынка и сжигает их. Выбывание — витрина, торговля не останавливается.")}
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
                <div className="rl-title"><Icon name="target" /> {t("Как проходит день")}</div>
                <div className="rl-tl">
                  <div className="rl-tl-line" />
                  <div className="rl-tl-pt"><span className="rl-tl-dot start"><Icon name="bolt" size={13} style={{ margin: 0 }} /></span><b>00:00 UTC</b><span className="dim">{t("все токены в бою")}</span></div>
                  <div className="rl-tl-pt"><span className="rl-tl-dot">–</span><b>{t("чекпоинт")}</b><span className="dim">{t("слабейший выбывает")}</span></div>
                  <div className="rl-tl-pt"><span className="rl-tl-dot">–</span><b>{t("чекпоинт")}</b><span className="dim">{t("и так весь день")}</span></div>
                  <div className="rl-tl-pt"><span className="rl-tl-dot gold"><Icon name="crown" size={13} style={{ margin: 0 }} /></span><b>24:00 UTC</b><span className="dim">{t("выживший — Чемпион")}</span></div>
                </div>
                <div className="rl-foot dim">
                  {t("Участвуют все неградуировавшие токены автоматически. Выбывание — витрина: торговля не останавливается ни на секунду. Чекпоинтов столько, сколько участников. Наутро чемпион отдыхает на троне — у остальных честный шанс.")}
                </div>
              </div>

              <div className="rl-sec">
                <div className="rl-title"><Icon name="check" /> {t("Как считаются очки боя")}</div>
                <div className="rl-formula">
                  <div className="rl-box green"><b>{t("Честный объём")}</b><span className="dim">{t("за день, в ETH")}</span></div>
                  <span className="rl-op">×</span>
                  <div className="rl-box"><b>1 + {t("рост капы")}</b><span className="dim">{t("за день")}</span></div>
                  <span className="rl-op">=</span>
                  <div className="rl-box gold"><b>{t("Очки боя")}</b><span className="dim">{t("решают всё")}</span></div>
                </div>
                <div className="rl-chips">
                  <div className="rl-chip ok"><Icon name="check" size={13} /> {t("Разные кошельки покупают и держат — очки растут")}</div>
                  <div className="rl-chip ok"><Icon name="check" size={13} /> {t("Цена за день выросла — множитель больше")}</div>
                  <div className="rl-chip bad"><Icon name="alert" size={13} /> {t("Гонять объём туда-сюда — считается разница, т.е. ноль")}</div>
                  <div className="rl-chip bad"><Icon name="alert" size={13} /> {t("Сделки создателя токена — не считаются вовсе")}</div>
                  <div className="rl-chip bad"><Icon name="alert" size={13} /> {t("Один кошелёк — в зачёт идёт максимум четверть общего потока")}</div>
                  <div className="rl-chip bad"><Icon name="alert" size={13} /> {t("Дамп цены — режет собственные очки")}</div>
                </div>
              </div>

              <div className="rl-sec">
                <div className="rl-title"><Icon name="bank" /> {t("Откуда приз и куда он идёт")}</div>
                <div className="rl-foot dim" style={{ marginTop: 2 }}>
                  {t("20% каждой торговой комиссии платформы уходят в казну арены. Вывести из неё нельзя — только выкупать монеты платформы и сжигать. Каждое утро (после 00:00 UTC) весь накопленный фонд делится между вчерашним подиумом.")}
                </div>
                <div className="rl-flow one">
                  <div className="rl-fcard gold">
                    <div className="rl-fpct">20%</div>
                    <div className="rl-frate">{t("каждой комиссии")}</div>
                    <div className="rl-fname">{t("Подиум арены")}</div>
                    <div className="rl-mini-podium">
                      <div className="rl-mp s2"><i>2</i><em style={{ height: 28 }} /><span>20%</span></div>
                      <div className="rl-mp s1"><i>1</i><em style={{ height: 64 }} /><span>70%</span></div>
                      <div className="rl-mp s3"><i>3</i><em style={{ height: 16 }} /><span>10%</span></div>
                    </div>
                  </div>
                </div>
                <div className="rl-foot dim">
                  {t("Приз — не перевод денег, а выкуп токена с рынка + сжигание: предложение падает, цена крепнет, выигрывают все держатели. 1-е место — выживший чемпион, 2-е и 3-е — по итоговым очкам. Нулевые очки не награждаются. Исполняет бот арены утром следующего дня, все транзакции — в эксплорере.")}
                </div>
              </div>

              <div className="rl-fair">
                <span><Icon name="shield" size={13} /> {t("Всё считается из он-чейн сделок")}</span>
                <span><Icon name="code" size={13} /> {t("Правила исполняет код, не люди")}</span>
                <span><Icon name="search" size={13} /> {t("Каждый может проверить сам")}</span>
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
                <div className="arena-bar" style={{ borderColor: "var(--gold)", marginTop: 18 }}>
                  <div className="ab-cell"><span>{t("В лиге")}</span><b>{ga.table.length}</b></div>
                  <div className="ab-cell"><span>{t("Финал месяца")}</span>
                    <b className="ab-timer">{days}{t("д")} {hours}{t("ч")}</b></div>
                </div>
                <div className="dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
                  {t("Сюда попадают только чемпионы дня. Каждая победа — звезда и очки лиги.")}
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
                        <span className={`ar-status ${row.leadingToday ? "ok" : ""}`} style={!row.leadingToday ? { color: "var(--text-dim)" } : undefined}>
                          {row.leadingToday ? t("лидирует сегодня") : t("в лиге")}
                        </span>
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
              <b style={{ color: "var(--gold)" }}>{ARENA_LIVE ? M(pot) : t("скоро")}</b>
              <span className="dim" style={{ fontSize: 11.5, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                {t("20% всех комиссий · выплата утром")}
              </span>
            </div>
          </div>

          {/* Подиум дня: что даёт каждое место */}
          <div className="podium3">
            <div className="pod-head">
              {t("Призовой фонд дня")}
              <span className="share-chip gold" title={t("Каждое утро казна арены тратит весь накопленный фонд на вчерашний подиум")}>{t("весь фонд")}</span>
              <span className="dim" style={{ fontWeight: 500 }}> · {t("делится между тремя местами")}</span>
            </div>
            {[
              ["gold", t("1 место"), t("чемпион дня")],
              ["silver", t("2 место"), t("по очкам боя")],
              ["bronze", t("3 место"), t("по очкам боя")],
            ].map(([cls, place, who], i) => {
              const v = pot === null ? null : pot * (SPLIT[i] / 100);
              return (
                <div className={`pod-card ${cls}`} key={cls}>
                  <span className="pod-medal">{i + 1}</span>
                  <span className="pod-place">{place} <span className="dim">· {who}</span></span>
                  <b className="pod-sum">{ARENA_LIVE ? (v === null ? "…" : M(v)) : "—"}</b>
                  <span className="pod-pct">{SPLIT[i]}% {t("приза")}</span>
                </div>
              );
            })}
            <div className="pod-note dim">
              {t("Каждое утро бот арены выкупает токены-призёры с рынка и сжигает их — предложение падает, выигрывают все держатели. Фонд растёт с каждой сделкой на платформе.")}
            </div>
          </div>

          {st.champion && st.alive.length === 1 && (
            <div className="arena-champ">
              <Icon name="crown" /> {t("Чемпион дня")}: <b>${st.champion.symbol}</b> — {t("объём")} {D(st.champion.dayVol)}
              {" "}({st.champion.dayGrowth >= 0 ? "+" : ""}{(st.champion.dayGrowth * 100).toFixed(1)}% {t("капа за день")})
            </div>
          )}

          {/* комментатор боя */}
          {st.alive.length > 1 && (() => {
            const secs = Math.max(0, Math.floor(((st.nextCheckpoint ?? 0) - Date.now()) / 1000));
            const leader = st.alive[0], loser = st.alive[st.alive.length - 1];
            const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
            const hm = h > 0 ? `${h}${t("ч")} ${m}${t("м")}` : `${m}${t("м")}`;
            let line;
            if (secs < 90) line = <>{t("Развязка близко!")} <b>${loser.symbol}</b> {t("вылетает через")} <b>{secs}{t("с")}</b> — {t("держателям пора спасать монету!")}</>;
            else if (leader.dayGrowth > 0.05) line = <><b>${leader.symbol}</b> {t("рвётся вперёд")} (+{(leader.dayGrowth * 100).toFixed(1)}%)! <b>${loser.symbol}</b> {t("на грани — осталось")} {hm}.</>;
            else line = <><b>${leader.symbol}</b> {t("держит корону")}. <b>${loser.symbol}</b> {t("замыкает — следующее выбывание через")} {hm}.</>;
            return <div className="arena-caster">{line}</div>;
          })()}

          {/* болеешь за токен */}
          {cheer && st.alive.some((p) => p.token.toLowerCase() === cheer.toLowerCase()) && (() => {
            const my = st.alive.find((p) => p.token.toLowerCase() === cheer.toLowerCase());
            const place = st.alive.indexOf(my) + 1;
            return (
              <div className="cushion-banner" style={{ marginBottom: 12 }}>
                <Icon name="sparkles" size={14} /> {t("Ты болеешь за")} <b>${my.symbol}</b> — {t("сейчас")} {place}/{st.alive.length} {t("в бою")}
              </div>
            );
          })()}

          <div className="arena-list">
            <div className="arena-hdr">
              <span />
              <span />
              <span>{t("Токен")}</span>
              <span>{t("Капа")}</span>
              <span>{t("Очки боя")} <i title={t("Очки боя = ЧЕСТНЫЙ объём за день × (1 + прирост капитализации). Честный объём: покупки минус продажи по каждому кошельку, сделки создателя не в счёт, вклад одного кошелька урезан до четверти общего потока. Накрутка и прокрутка объёма очков не дают, дамп цены режет их. На каждом чекпоинте вылетает токен с наименьшими очками.")}>ⓘ</i></span>
              <span style={{ textAlign: "right" }}>{t("Статус")}</span>
            </div>
            {(() => {
              const maxVol = Math.max(...st.alive.map((x) => x.score), 1e-9);
              const secsToElim = Math.max(0, Math.floor(((st.nextCheckpoint ?? 0) - Date.now()) / 1000));
              const elimInterval = st.participants.length ? 86_400_000 / st.participants.length : 0;
              const elimFrac = elimInterval > 0
                ? Math.max(0, Math.min(1, ((st.nextCheckpoint ?? 0) - Date.now()) / elimInterval)) : 0;
              const p2 = (x) => String(x).padStart(2, "0");
              const eh = Math.floor(secsToElim / 3600);
              const elimClock = eh > 0
                ? `${eh}:${p2(Math.floor((secsToElim % 3600) / 60))}:${p2(secsToElim % 60)}`
                : `${p2(Math.floor(secsToElim / 60))}:${p2(secsToElim % 60)}`;
              const winCount = {};
              try { for (const h of hallOfFame(st.tokens, st.trades, 14)) { const k = h.champion.token.toLowerCase(); winCount[k] = (winCount[k] || 0) + 1; } } catch (e) { /* ignore */ }
              return st.alive.map((p, i) => {
                const w = Math.max(3, (p.score / maxVol) * 100);
                const danger = st.alive.length > 1 && i === st.alive.length - 1;
                const hot = danger && secsToElim < 60;
                const isCheer = cheer && p.token.toLowerCase() === cheer.toLowerCase();
                const streak = winCount[p.token.toLowerCase()] || 0;
                const row = (
                  <a key={p.token} className={`arena-row ${i === 0 ? "leader" : ""} ${danger ? "danger" : ""} ${hot ? "danger-hot" : ""} ${isCheer ? "cheered" : ""}`}
                     href={`#/token/${p.token}`}>
                    <Rank i={i} />
                    <Logo src={p.meta.image} />
                    <span className="ar-name">
                      <b>${p.symbol}{streak > 0 && <span className="ar-streak" title={t("Побед за 2 недели")}><Icon name="flame" size={11} style={{ margin: 0 }} />{streak}</span>}</b>
                      <CA p={p} />
                    </span>
                    <span className="ar-mcap">{usd(mcapOf(p))}</span>
                    <span className="ar-volwrap">
                      <span className="ar-volbar"><span style={{ width: `${w}%` }} /></span>
                      <span className="ar-vol">
                        {D(p.dayVol)}{" "}
                        <span className={p.dayGrowth >= 0 ? "side-buy" : "side-sell"} style={{ fontSize: 11 }}>
                          {p.dayGrowth >= 0 ? "+" : ""}{(p.dayGrowth * 100).toFixed(1)}%
                        </span>
                      </span>
                    </span>
                    <span className={`ar-status ${danger ? "bad" : "ok"}`} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <span className={`ar-star ${isCheer ? "on" : ""}`} title={t(isCheer ? "Не болеть" : "Болеть за этот токен")}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCheer(p.token); }}>
                        {isCheer ? "★" : "☆"}
                      </span>
                      {hot ? <span className="hot-timer">{secsToElim}{t("с")}</span>
                        : danger ? <span style={{ color: "#e06a4a" }}>{t("под угрозой")}</span>
                          : t("в бою")}
                    </span>
                  </a>
                );
                if (!danger) return row;
                return (
                  <React.Fragment key={p.token}>
                    {row}
                    <div className={`elim-timer ${elimFrac < 0.25 ? "critical" : ""}`}>
                      <div className="elim-fill" style={{ width: `${elimFrac * 100}%` }} />
                      <span className="elim-label">{t("До выбывания")} <b>${p.symbol}</b>: <b className="mono">{elimClock}</b></span>
                    </div>
                  </React.Fragment>
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
                <span className="ar-status bad">{t("выбыл")}</span>
              </a>
            ))}
          </div>

          {/* Вчерашние выкупы — из событий казны арены */}
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

      {toast && (
        <div className="arena-toast">
          {toast.img ? <img src={toast.img} alt="" /> : <span className="ts-ph"><Icon name="image" size={14} style={{ margin: 0 }} /></span>}
          <span><b>${toast.sym}</b> {t("выбыл из арены!")}</span>
        </div>
      )}
    </>
  );
}
