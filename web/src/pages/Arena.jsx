import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { fmt, fmtEth } from "../lib/web3.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useClock, timeAgo } from "../lib/data.js";
import { useArena, hallOfFame, dayStart } from "../lib/arena.js";
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
        <>
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
            </div>
          )}

          <div className="arena-list">
            <div className="arena-hdr">
              <span />
              <span />
              <span>{t("Токен")}</span>
              <span>{t("Капа")}</span>
              <span>{t("Объём за день")} <i title={t("Метрика выбывания: на каждом чекпоинте вылетает токен с наименьшим объёмом торгов с начала дня")}>ⓘ</i></span>
              <span style={{ textAlign: "right" }}>{t("Статус")}</span>
            </div>
            {st.alive.map((p, i) => {
              const maxVol = Math.max(...st.alive.map((x) => x.dayVol), 1e-9);
              const w = Math.max(3, (p.dayVol / maxVol) * 100);
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
                    <span className="ar-vol">{D(p.dayVol)}</span>
                  </span>
                  <span className={`ar-status ${danger ? "bad" : "ok"}`}>
                    {danger ? t("под угрозой") : t("в бою")}
                  </span>
                </a>
              );
            })}

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

          {(() => {
            const hof = hallOfFame(st.tokens, st.trades);
            if (hof.length === 0) return null;
            return (
              <div className="bottom-card" style={{ marginTop: 26 }}>
                <div className="bt-tabs"><div className="bt-tab on">🏆 {t("Зал славы")}</div></div>
                {hof.map(({ day, champion: c }) => (
                  <a key={day} className="hof-row" href={`#/token/${c.token}`}>
                    <span className="dim">{new Date(day).toLocaleDateString()}</span>
                    {c.meta.image ? <img src={c.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
                    <b>${c.symbol}</b>
                    <span className="dim">{c.name}</span>
                    <span className="hof-crown">👑</span>
                  </a>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </>
  );
}
