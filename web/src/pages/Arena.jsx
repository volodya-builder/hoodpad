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
            <div className="arena-rules">
              {[
                [t("Кто участвует"), [
                  t("Все неградуировавшие токены платформы. Ничего включать не нужно — токен попадает в бой автоматически."),
                  t("Токен, созданный посреди дня, вступает в бой с момента создания."),
                  t("Градуировавшие токены выпускаются из арены — они уже победили по-крупному."),
                ]],
                [t("Очки боя"), [
                  t("Очки = честный объём за день (в ETH) × (1 + прирост капитализации за день)."),
                  t("Честный объём: по каждому кошельку считается |покупки − продажи| за день. Прогон объёма туда-сюда даёт ноль."),
                  t("Сделки кошелька создателя токена не засчитываются вовсе."),
                  t("Один кошелёк даёт максимум 25% честного объёма токена — сибил из одного кита не работает."),
                  t("Прирост капы ограничен коридором −60%…+150%, чтобы одна аномальная свеча не решала бой."),
                  t("Дамп цены уменьшает множитель — слив токена бьёт по его же очкам."),
                ]],
                [t("Выбывание"), [
                  t("День (UTC) делится на равные интервалы по числу участников — это чекпоинты."),
                  t("На каждом чекпоинте выбывает живой токен с наименьшими очками на этот момент."),
                  t("Ничья по очкам: выживает тот, кто создан раньше; если и это совпало — решает адрес контракта."),
                  t("Выбывание — витрина, торговля выбывшим токеном не останавливается ни на секунду."),
                ]],
                [t("Призы казны"), [
                  t("Каждый день казна тратит 25% своего баланса на подиум арены: 50% фонда — 1 месту, 30% — 2 месту, 20% — 3 месту."),
                  t("1-е место — выживший чемпион; 2-е и 3-е — лучшие по итоговым очкам боя среди остальных участников."),
                  t("Приз — это выкуп токена с рынка и сжигание купленного: меньше предложение, крепче цена. Деньги не выдаются никому на руки."),
                  t("Место с нулевыми очками не награждается — мёртвый день не фармится."),
                  t("Выплаты исполняет ИИ-казначей автоматически утром следующего дня (UTC), транзакции видны в казне и эксплорере."),
                  t("Ритмы казны: подиум арены — ежедневно 25% баланса (главный акцент), голосование — еженедельно 20%, Гранд-выкуп — ежемесячно 20%. Проценты от текущего баланса: казна никогда не пустеет, а дневной приз растёт вместе с оборотом."),
                ]],
                [t("Чемпион дня и защита трона"), [
                  t("Последний выживший в 24:00 UTC — Чемпион дня: золотая рамка, Зал славы, приоритет внимания казны."),
                  t("На следующий день чемпион не участвует — «день отдыха на троне». У остальных есть честный шанс."),
                  t("Через день чемпион возвращается в бой на общих основаниях."),
                ]],
                [t("Гранд-Арена (месячная лига)"), [
                  t("Каждая победа в суточной арене даёт токену ⭐ звезду и очки лиги — столько, сколько он набрал в день победы."),
                  t("Лидер текущего дня виден в таблице со статусом «ведёт сегодня» — его очки ещё не зачтены."),
                  t("В конце календарного месяца (UTC) лидер по очкам лиги — Гранд-чемпион."),
                  t("В честь Гранд-чемпиона казна исполняет Гранд-выкуп: покупает его токен и сжигает купленное."),
                ]],
                [t("Честность"), [
                  t("Всё считается из он-чейн сделок детерминированно: одинаковые данные — одинаковый результат у каждого зрителя."),
                  t("Никаких серверов, админок и ручных решений — правила исполняет код, проверить может любой."),
                  t("Накрутка не запрещена — она просто не работает: не даёт ни очков арены, ни права голоса."),
                ]],
              ].map(([title, items], i) => (
                <div className="bottom-card" style={{ marginTop: i === 0 ? 4 : 14 }} key={i}>
                  <h3 style={{ margin: "2px 0 10px" }}>{title}</h3>
                  {items.map((line, j) => (
                    <div className="check-item" key={j} style={{ padding: "5px 0" }}>
                      <span className="fact-check" style={{ position: "static" }}>✓</span>
                      <span className="dim" style={{ lineHeight: 1.55 }}>{line}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {view === "hof" && (() => {
            const hof = hallOfFame(st.tokens, st.trades, 31);
            if (hof.length === 0) return <div className="center">{t("Первый чемпион появится после финала дня.")}</div>;
            return (
              <div className="arena-list">
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
            const pool = treBal !== null ? treBal * 0.15 : null;
            const maxPts = Math.max(...ga.table.map((r) => r.points + (r.pendingPoints || 0)), 1e-9);
            return (
              <>
                <div className="arena-bar" style={{ borderColor: "var(--gold)" }}>
                  <div className="ab-cell"><span>{t("В лиге")}</span><b>{ga.table.length}</b></div>
                  <div className="ab-cell"><span>{t("Финал месяца")}</span>
                    <b className="ab-timer">{days}{t("д")} {hours}{t("ч")}</b></div>
                  {pool !== null && (
                    <div className="ab-cell"><span>{t("Гранд-выкуп")}</span>
                      <b style={{ color: "var(--gold)" }}>{D(pool)} <span className="dim" style={{ fontWeight: 500, fontSize: 13 }}>({fmtEth(pool)} ETH)</span></b></div>
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
          <div className="arena-bar">
            <div className="ab-cell">
              <span>{t("В бою")}</span>
              <b>{st.alive.length} / {st.participants.length}</b>
            </div>
            <div className="ab-cell">
              <span>{st.alive.length > 1 ? t("Следующее выбывание") : t("Финал дня")}</span>
              <b className="ab-timer"><Countdown to={st.nextCheckpoint ?? dayStart() + 86_400_000} /></b>
            </div>
            <div className="ab-cell">
              <span>{t("Призы дня")} <i title={t("Каждый день казна тратит 25% баланса на подиум: 50% — 1 месту, 30% — 2 месту, 20% — 3 месту. Выкуп токена с рынка и сжигание. Исполняется автоматически утром следующего дня.")}>ⓘ</i></span>
              <b>
                {treBal === null ? "…" : (() => {
                  const pot = treBal * 0.25;
                  return <>🥇{D(pot * 0.5)} 🥈{D(pot * 0.3)} 🥉{D(pot * 0.2)}</>;
                })()}
              </b>
            </div>
            <div className="ab-cell">
              <span>{t("Накоплено на выкупы")}</span>
              <b style={{ color: "var(--gold)" }}>
                {treBal === null ? "…" : <>{D(treBal)} <span className="dim" style={{ fontWeight: 500, fontSize: 13 }}>({fmtEth(treBal)} ETH)</span></>}
              </b>
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
