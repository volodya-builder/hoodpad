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

export default function Arena() {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(1000);
  const st = useArena();
  // накоплено в казне на выкупы
  const [treBal, setTreBal] = useState(null);
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
          </div>

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
                        <span className="ar-rank">{i === 0 ? "👑" : i + 1}</span>
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
              <span>{t("Приз")}</span>
              <b>👑 {t("Чемпион дня")}</b>
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

          <div className="arena-list">
            <div className="arena-hdr">
              <span />
              <span />
              <span>{t("Токен")}</span>
              <span>{t("Капа")}</span>
              <span>{t("Очки боя")} <i title={t("Очки боя = объём за день × (1 + прирост капитализации за день). Пустая прокрутка объёма не даёт множителя, дамп цены режет очки. На каждом чекпоинте вылетает токен с наименьшими очками.")}>ⓘ</i></span>
              <span style={{ textAlign: "right" }}>{t("Статус")}</span>
            </div>
            {(() => {
              return st.alive.map((p, i) => {
              const maxVol = Math.max(...st.alive.map((x) => x.score), 1e-9);
              const w = Math.max(3, (p.score / maxVol) * 100);
              const danger = st.alive.length > 1 && i === st.alive.length - 1;
              return (
                <a key={p.token} className={`arena-row ${i === 0 ? "leader" : ""} ${danger ? "danger" : ""}`}
                   href={`#/token/${p.token}`}>
                  <span className="ar-rank">{i === 0 ? "👑" : i + 1}</span>
                  {p.meta.image ? <img src={p.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
                  <span className="ar-name">
                    <b>${p.symbol}</b>
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
                  <span className={`ar-status ${danger ? "bad" : "ok"}`}>
                    {danger ? t("под угрозой") : t("в бою")}
                  </span>
                </a>
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
    </>
  );
}
