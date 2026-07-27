import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { fmt, fmtEth } from "../lib/web3.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useClock, timeAgo } from "../lib/data.js";
import { useArena, grandArena, hallOfFame, dayStart } from "../lib/arena.js";
import { useLang } from "../lib/i18n.jsx";
import { publicClient } from "../lib/web3.js";
import { TREASURY_ADDRESS } from "../lib/config.js";

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

export default function Arena() {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(1000);
  const st = useArena();
  const [cheer, setCheer] = useCheer();
  const [toast, setToast] = useState(null);      // всплывающее событие «выбыл»
  const prevElim = React.useRef(null);
  // накоплено в казне на выкупы
  const [treBal, setTreBal] = useState(null);

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
  useEffect(() => {
    let alive = true;
    const pull = () => publicClient.getBalance({ address: TREASURY_ADDRESS })
      .then((b) => alive && setTreBal(Number(formatEther(b))))
      .catch(() => {});
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const D = (e) => {
    const v = e * rate;
    return v >= 1000 ? usd(v) : "$" + v.toFixed(2);
  };
  const [cp, setCp] = useState("");
  const [view, setView] = useState("day"); // «Суточная арена» | «Гранд-Арена»
  const copyCA = (e, addr) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(addr); } catch (err) { /* ignore */ }
    setCp(addr); setTimeout(() => setCp(""), 1200);
  };
  const mcapOf = (p) => Number(formatEther(p.price)) * 1e9 * rate;
  const CA = ({ p }) => (
    <span className="mono ar-ca" title={t("Скопировать адрес контракта")}
          onClick={(e) => copyCA(e, p.token)}>
      {cp === p.token ? "✓ скопировано" : `${p.token.slice(0, 6)}…${p.token.slice(-4)} ⧉`}
    </span>
  );


  return (
    <>
      <div className="page-title">⚔️ {t("Арена")}</div>
      <div className="page-sub" style={{ maxWidth: 760 }}>
        {t("Каждый день — бой на выживание. Токен с наименьшим объёмом торгов выбывает на каждом чекпоинте. Последний выживший — Чемпион дня: золотая рамка, Зал славы и приоритет выкупа казны. Выбывание — витрина, торговля не останавливается.")}
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
            <div className={`bt-tab ${view === "day" ? "on" : ""}`} onClick={() => setView("day")}>
              ⚔️ {t("Суточная арена")}
            </div>
            <div className={`bt-tab ${view === "grand" ? "on" : ""}`} onClick={() => setView("grand")}>
              👑 {t("Гранд-Арена")}
            </div>
            <div className={`bt-tab ${view === "hof" ? "on" : ""}`} onClick={() => setView("hof")}>
              🏆 {t("История побед")}
            </div>
            <div className={`bt-tab ${view === "rules" ? "on" : ""}`} onClick={() => setView("rules")}>
              📜 {t("Правила")}
            </div>
          </div>

          {view === "rules" && (
            <div className="rules-wrap">

              {/* 1. Как проходит день — таймлайн */}
              <div className="rl-sec">
                <div className="rl-title">⚔️ {t("Как проходит день")}</div>
                <div className="rl-tl">
                  <div className="rl-tl-line" />
                  <div className="rl-tl-pt"><span className="rl-tl-dot start">⚔️</span><b>00:00 UTC</b><span className="dim">{t("все токены в бою")}</span></div>
                  <div className="rl-tl-pt"><span className="rl-tl-dot">☠</span><b>{t("чекпоинт")}</b><span className="dim">{t("слабейший выбывает")}</span></div>
                  <div className="rl-tl-pt"><span className="rl-tl-dot">☠</span><b>{t("чекпоинт")}</b><span className="dim">{t("и так весь день")}</span></div>
                  <div className="rl-tl-pt"><span className="rl-tl-dot gold">👑</span><b>24:00 UTC</b><span className="dim">{t("выживший — Чемпион")}</span></div>
                </div>
                <div className="rl-foot dim">
                  {t("Участвуют все неградуировавшие токены автоматически. Выбывание — витрина: торговля не останавливается ни на секунду. Чекпоинтов столько, сколько участников. Наутро чемпион отдыхает на троне — у остальных честный шанс.")}
                </div>
              </div>

              {/* 2. Очки боя — формула */}
              <div className="rl-sec">
                <div className="rl-title">🎯 {t("Как считаются очки боя")}</div>
                <div className="rl-formula">
                  <div className="rl-box green"><b>{t("Честный объём")}</b><span className="dim">{t("за день, в ETH")}</span></div>
                  <span className="rl-op">×</span>
                  <div className="rl-box"><b>1 + {t("рост капы")}</b><span className="dim">{t("за день")}</span></div>
                  <span className="rl-op">=</span>
                  <div className="rl-box gold"><b>{t("Очки боя")}</b><span className="dim">{t("решают всё")}</span></div>
                </div>
                <div className="rl-chips">
                  <div className="rl-chip ok">✅ {t("Разные кошельки покупают и держат — очки растут")}</div>
                  <div className="rl-chip ok">✅ {t("Цена за день выросла — множитель больше")}</div>
                  <div className="rl-chip bad">❌ {t("Гонять объём туда-сюда — считается разница, т.е. ноль")}</div>
                  <div className="rl-chip bad">❌ {t("Сделки создателя токена — не считаются вовсе")}</div>
                  <div className="rl-chip bad">❌ {t("Один кошелёк — максимум 25% объёма токена")}</div>
                  <div className="rl-chip bad">❌ {t("Дамп цены — режет собственные очки")}</div>
                </div>
              </div>

              {/* 3. Куда идёт казна — потоки и подиум */}
              <div className="rl-sec">
                <div className="rl-title">🏦 {t("Куда казна тратит деньги")}</div>
                <div className="rl-foot dim" style={{ marginTop: 2 }}>
                  {t("В казну попадает 30% каждой торговой комиссии. Вывести из неё нельзя — только выкупать токены платформы и сжигать. Проценты — от текущего баланса, поэтому казна никогда не пустеет, а призы растут вместе с оборотом.")}
                </div>
                <div className="rl-flow">
                  <div className="rl-fcard gold">
                    <div className="rl-fpct">50%</div>
                    <div className="rl-frate">⚔️ {t("каждый день")}</div>
                    <div className="rl-fname">{t("Подиум арены")}</div>
                    <div className="rl-mini-podium">
                      <div className="rl-mp s2"><i>🥈</i><em style={{ height: 28 }} /><span>20%</span></div>
                      <div className="rl-mp s1"><i>🥇</i><em style={{ height: 64 }} /><span>70%</span></div>
                      <div className="rl-mp s3"><i>🥉</i><em style={{ height: 16 }} /><span>10%</span></div>
                    </div>
                  </div>
                  <div className="rl-fcard">
                    <div className="rl-fpct">20%</div>
                    <div className="rl-frate">🗳 {t("каждую неделю")}</div>
                    <div className="rl-fname">{t("Победитель голосования")}</div>
                    <div className="rl-fdesc dim">{t("Голосуют кошельки с честным объёмом от $500 и торговлей в 2+ дня. Один кошелёк — один голос.")}</div>
                  </div>
                  <div className="rl-fcard">
                    <div className="rl-fpct">30%</div>
                    <div className="rl-frate">👑 {t("каждый месяц")}</div>
                    <div className="rl-fname">{t("Гранд-чемпион")}</div>
                    <div className="rl-fdesc dim">{t("Каждая победа дня — ⭐ и очки лиги. Лидер месяца получает Гранд-выкуп.")}</div>
                  </div>
                </div>
                <div className="rl-foot dim">
                  🔥 {t("Приз — не перевод денег, а выкуп токена с рынка + сжигание: предложение падает, цена крепнет, выигрывают все держатели. 1-е место — выживший чемпион, 2-е и 3-е — по итоговым очкам. Нулевые очки не награждаются. Исполняет ИИ-казначей утром следующего дня, все транзакции — в эксплорере.")}
                </div>
              </div>

              {/* 4. Честность */}
              <div className="rl-fair">
                <span>⛓ {t("Всё считается из он-чейн сделок")}</span>
                <span>🤖 {t("Правила исполняет код, не люди")}</span>
                <span>🔍 {t("Каждый может проверить сам")}</span>
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
                    <span className="ar-rank">👑</span>
                    {c.meta.image ? <img src={c.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
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

          {view === "grand" && (() => {
            const ga = grandArena(st.tokens, st.trades);
            const days = Math.floor(ga.endsIn / 86_400_000);
            const hours = Math.floor((ga.endsIn % 86_400_000) / 3_600_000);
            const pool = treBal !== null ? treBal * 0.30 : null;
            const maxPts = Math.max(...ga.table.map((r) => r.points + (r.pendingPoints || 0)), 1e-9);
            return (
              <>
                <div className="arena-bar" style={{ borderColor: "var(--gold)", marginTop: 18 }}>
                  <div className="ab-cell"><span>{t("В лиге")}</span><b>{ga.table.length}</b></div>
                  <div className="ab-cell"><span>{t("Финал месяца")}</span>
                    <b className="ab-timer">{days}{t("д")} {hours}{t("ч")}</b></div>
                  {pool !== null && (
                    <div className="ab-cell"><span>{t("Гранд-выкуп")}<span className="share-chip gold" title={t("30% баланса казны на конец месяца. Казна пополняется с каждой сделки все 30 дней — к финалу приз заметно больше сегодняшней оценки.")}>30% {t("казны")}</span></span>
                      <b style={{ color: "var(--gold)" }}>{D(pool)} <span className="dim" style={{ fontWeight: 500, fontSize: 13 }}>({fmtEth(pool)} ETH)</span></b>
                      <span className="dim" style={{ fontSize: 11.5, marginTop: 3 }}>📈 {t("копится с каждой сделкой все 30 дней месяца")}</span></div>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
                  {t("Сюда попадают только чемпионы дня. Каждая победа — ⭐ и очки лиги. Лидер месяца получает Гранд-выкуп из казны в первый день следующего месяца.")}
                </div>
                {ga.legendRow && (
                  <div className="cushion-banner" style={{ marginBottom: 12 }}>
                    🏛 {t("Легенда прошлого месяца")}: <b>${ga.legendRow.token.symbol}</b> — {t("вне конкурса в этой лиге, титул защищён навсегда")}
                  </div>
                )}
                {ga.table.length === 0 && <div className="center">{t("Пока нет чемпионов — лига откроется после первого финала дня.")}</div>}
                <div className="arena-list">
                  {ga.table.map((row, i) => {
                    const pts = row.points + (row.pendingPoints || 0);
                    const w = Math.max(3, (pts / maxPts) * 100);
                    return (
                      <a key={row.token.token} className={`arena-row ${i === 0 ? "leader" : ""}`}
                         href={`#/token/${row.token.token}`}>
                        <span className="ar-rank">{i === 0 ? "👑" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
                        {row.token.meta.image ? <img src={row.token.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
                        <span className="ar-name">
                          <b>${row.token.symbol}</b>
                          <CA p={row.token} />
                        </span>
                        <span className="ar-mcap">{"⭐".repeat(Math.min(row.wins, 5))}{row.wins > 5 ? `×${row.wins}` : ""}</span>
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
              <span>{t("Накоплено на выкупы")}</span>
              <b style={{ color: "var(--gold)" }}>
                {treBal === null ? "…" : <>{D(treBal)} <span className="dim" style={{ fontWeight: 500, fontSize: 13 }}>({fmtEth(treBal)} ETH)</span></>}
              </b>
            </div>
          </div>

          {/* Подиум дня: что даёт каждое место — наглядно и с процентами казны */}
          <div className="podium3">
            {[
              ["gold", "🥇", t("1 место"), 70, t("чемпион дня")],
              ["silver", "🥈", t("2 место"), 20, t("по очкам боя")],
              ["bronze", "🥉", t("3 место"), 10, t("по очкам боя")],
            ].map(([cls, medal, place, pct, who]) => {
              const v = treBal === null ? null : treBal * 0.5 * (pct / 100);
              return (
                <div className={`pod-card ${cls}`} key={cls}>
                  <span className="pod-medal">{medal}</span>
                  <span className="pod-place">{place} <span className="dim">· {who}</span></span>
                  <b className="pod-sum">{v === null ? "…" : v > 0 && v < 0.01 ? "<$0.01" : D(v)}</b>
                  <span className="pod-pct">{pct}% {t("приза")}</span>
                </div>
              );
            })}
            <div className="pod-note dim">
              💡 {t("Каждое утро казна тратит половину баланса на вчерашний подиум: выкупает токены-призёры с рынка и сжигает их. Приз растёт с каждым днём торгов.")}
            </div>
          </div>

          {st.champion && st.alive.length === 1 && (
            <div className="arena-champ">
              🏆 {t("Чемпион дня")}: <b>${st.champion.symbol}</b> — {t("объём")} {D(st.champion.dayVol)}
              {" "}({st.champion.dayGrowth >= 0 ? "+" : ""}{(st.champion.dayGrowth * 100).toFixed(1)}% {t("капа за день")})
            </div>
          )}

          {/* комментатор боя — живая строка-репортаж */}
          {st.alive.length > 1 && (() => {
            const secs = Math.max(0, Math.floor(((st.nextCheckpoint ?? 0) - Date.now()) / 1000));
            const leader = st.alive[0], loser = st.alive[st.alive.length - 1];
            const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
            const hm = h > 0 ? `${h}${t("ч")} ${m}${t("м")}` : `${m}${t("м")}`;
            let line;
            if (secs < 90) line = <>🔴 {t("Развязка близко!")} <b>${loser.symbol}</b> {t("вылетает через")} <b>{secs}{t("с")}</b> — {t("держателям пора спасать монету!")}</>;
            else if (leader.dayGrowth > 0.05) line = <>🚀 <b>${leader.symbol}</b> {t("рвётся вперёд")} (+{(leader.dayGrowth * 100).toFixed(1)}%)! <b>${loser.symbol}</b> {t("на грани — осталось")} {hm}.</>;
            else line = <>⚔️ <b>${leader.symbol}</b> {t("держит корону")}. <b>${loser.symbol}</b> {t("замыкает — следующее выбывание через")} {hm}.</>;
            return <div className="arena-caster">{line}</div>;
          })()}

          {/* болеешь за токен */}
          {cheer && st.alive.some((p) => p.token.toLowerCase() === cheer.toLowerCase()) && (() => {
            const my = st.alive.find((p) => p.token.toLowerCase() === cheer.toLowerCase());
            const place = st.alive.indexOf(my) + 1;
            return (
              <div className="cushion-banner" style={{ marginBottom: 12 }}>
                ⭐ {t("Ты болеешь за")} <b>${my.symbol}</b> — {t("сейчас")} {place}/{st.alive.length} {t("в бою")}
              </div>
            );
          })()}

          <div className="arena-list">
            <div className="arena-hdr">
              <span />
              <span />
              <span>{t("Токен")}</span>
              <span>{t("Капа")}</span>
              <span>{t("Очки боя")} <i title={t("Очки боя = ЧЕСТНЫЙ объём за день × (1 + прирост капитализации). Честный объём: покупки минус продажи по каждому кошельку, сделки создателя не в счёт, один кошелёк — максимум 25%. Накрутка и прокрутка объёма очков не дают, дамп цены режет их. На каждом чекпоинте вылетает токен с наименьшими очками.")}>ⓘ</i></span>
              <span style={{ textAlign: "right" }}>{t("Статус")}</span>
            </div>
            {(() => {
              const maxVol = Math.max(...st.alive.map((x) => x.score), 1e-9);
              const secsToElim = Math.max(0, Math.floor(((st.nextCheckpoint ?? 0) - Date.now()) / 1000));
              // интервал между чекпоинтами (для полосы-таймера под аутсайдером)
              const elimInterval = st.participants.length ? 86_400_000 / st.participants.length : 0;
              const elimFrac = elimInterval > 0
                ? Math.max(0, Math.min(1, ((st.nextCheckpoint ?? 0) - Date.now()) / elimInterval)) : 0;
              const p2 = (x) => String(x).padStart(2, "0");
              const eh = Math.floor(secsToElim / 3600);
              const elimClock = eh > 0
                ? `${eh}:${p2(Math.floor((secsToElim % 3600) / 60))}:${p2(secsToElim % 60)}`
                : `${p2(Math.floor(secsToElim / 60))}:${p2(secsToElim % 60)}`;
              // стрики: сколько раз токен был чемпионом за последние дни
              const winCount = {};
              try { for (const h of hallOfFame(st.tokens, st.trades, 14)) { const k = h.champion.token.toLowerCase(); winCount[k] = (winCount[k] || 0) + 1; } } catch (e) { /* ignore */ }
              return st.alive.map((p, i) => {
              const w = Math.max(3, (p.score / maxVol) * 100);
              const danger = st.alive.length > 1 && i === st.alive.length - 1;
              const hot = danger && secsToElim < 60;       // красная тревога в последнюю минуту
              const isCheer = cheer && p.token.toLowerCase() === cheer.toLowerCase();
              const streak = winCount[p.token.toLowerCase()] || 0;
              const row = (
                <a key={p.token} className={`arena-row ${i === 0 ? "leader" : ""} ${danger ? "danger" : ""} ${hot ? "danger-hot" : ""} ${isCheer ? "cheered" : ""}`}
                   href={`#/token/${p.token}`}>
                  <span className="ar-rank">{i === 0 ? "👑" : i + 1}</span>
                  {p.meta.image ? <img src={p.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
                  <span className="ar-name">
                    <b>${p.symbol}</b>
                    {streak > 0 && <span className="ar-streak" title={t("Побед за 2 недели")}>🔥{streak}</span>}
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
                    {hot ? <span className="hot-timer">⚡{secsToElim}{t("с")}</span>
                      : danger ? <span style={{ color: "#e06a4a" }}>{t("под угрозой")}</span>
                        : t("в бою")}
                  </span>
                </a>
              );
              if (!danger) return row;
              // полоса-таймер под аутсайдером: утекает к выбыванию, давит психологически
              return (
                <React.Fragment key={p.token}>
                  {row}
                  <div className={`elim-timer ${elimFrac < 0.25 ? "critical" : ""}`}>
                    <div className="elim-fill" style={{ width: `${elimFrac * 100}%` }} />
                    <span className="elim-label">☠ {t("До выбывания")} <b>${p.symbol}</b>: <b className="mono">{elimClock}</b></span>
                  </div>
                </React.Fragment>
              );
            });
            })()}

            {st.eliminated.slice().reverse().map(({ token: p, at }) => (
              <a key={p.token} className="arena-row dead" href={`#/token/${p.token}`}>
                <span className="ar-rank">☠</span>
                {p.meta.image ? <img src={p.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
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

          </>)}
        </div>
      )}

      {toast && (
        <div className="arena-toast">
          {toast.img ? <img src={toast.img} alt="" /> : <span>☠</span>}
          <span>☠ <b>${toast.sym}</b> {t("выбыл из арены!")}</span>
        </div>
      )}
    </>
  );
}
