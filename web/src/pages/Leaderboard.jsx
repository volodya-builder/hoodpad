import React, { useEffect, useState } from "react";
import { publicClient, fmtEth, short } from "../lib/web3.js";
import { poolExtraAbi } from "../lib/abi.js";
import { parseAbi } from "viem";
import { EXPLORER } from "../lib/config.js";
import { loadTokens, poolTrades } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

const creatorAbi = parseAbi(["function creator() view returns (address)"]);

// Память вкладки: мгновенно при переключении и после перезагрузки.
let _lbRaw = null;
const LB_LS = "hood_cache_leaderboard_v2";
try {
  const s = localStorage.getItem(LB_LS);
  if (s) _lbRaw = JSON.parse(s);
} catch (e) { /* ignore */ }

export default function Leaderboard() {
  const { t } = useLang();
  const rate = useEthUsd();
  const [lb, setLb] = useState(_lbRaw);
  const [error, setError] = useState("");
  // сортировки: ключ + направление (-1 по убыванию, 1 по возрастанию)
  const [cSort, setCSort] = useState({ k: "fees", d: -1 });
  const [tSort, setTSort] = useState({ k: "vol", d: -1 });
  const pickC = (k) => setCSort((s) => (s.k === k ? { k, d: -s.d } : { k, d: -1 }));
  const pickT = (k) => setTSort((s) => (s.k === k ? { k, d: -s.d } : { k, d: -1 }));
  const arrow = (s, k) => (s.k === k ? (s.d === -1 ? " ▼" : " ▲") : " ⇅");

  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = await loadTokens();
      const all = await Promise.all(tokens.map(async (tk) => {
        const [h, shareBps, creator] = await Promise.all([
          poolTrades(tk.pool).catch(() => ({ trades: [] })),
          publicClient.readContract({ address: tk.pool, abi: poolExtraAbi, functionName: "creatorFeeShareBps" }).catch(() => 2000),
          tk.creator ? Promise.resolve(tk.creator)
            : publicClient.readContract({ address: tk.pool, abi: creatorAbi, functionName: "creator" }).catch(() => null),
        ]);
        return { tk, creator, shareBps: Number(shareBps), trades: h.trades };
      }));

      const creatorsMap = {};
      for (const a of all) {
        if (!a.creator) continue;
        const key = a.creator.toLowerCase();
        const earned = a.trades.reduce((s, tr) => s + tr.fee, 0) * (a.shareBps / 10000);
        const vol = a.trades.reduce((s, tr) => s + tr.eth + tr.fee, 0);
        const c = creatorsMap[key] ?? { earned: 0, volume: 0, tokens: 0, symbols: [] };
        c.earned += earned;
        c.volume += vol;
        c.tokens += 1;
        c.symbols.push(a.tk.symbol);
        creatorsMap[key] = c;
      }
      // трейдеры: объём, число сделок и реализованный PnL (продажи − покупки)
      const tradersMap = {};
      for (const a of all) for (const tr of a.trades) {
        const k = tr.addr.toLowerCase();
        const x = tradersMap[k] ?? { volume: 0, count: 0, pnl: 0 };
        x.volume += tr.eth + tr.fee;
        x.count += 1;
        x.pnl += tr.side === "sell" ? tr.eth : -(tr.eth + tr.fee);
        tradersMap[k] = x;
      }
      const next = {
        creators: Object.entries(creatorsMap),
        traders: Object.entries(tradersMap),
      };
      if (!alive) return;
      _lbRaw = next;
      try { localStorage.setItem(LB_LS, JSON.stringify(next)); } catch (e) { /* ignore */ }
      setLb(next);
    })().catch((e) => { if (alive && !_lbRaw) setError(e.shortMessage || e.message); });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <div className="page-title">{t("Лидеры")}</div>
      <div className="page-sub" style={{ maxWidth: 720 }}>
        {t("Кто создаёт самые прибыльные монеты и кто торгует активнее всех — всё по данным блокчейна.")}
      </div>

      {error && <div className="error">{error}</div>}
      {!lb && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {lb && (() => {
        const cKey = { fees: "earned", vol: "volume", tokens: "tokens" }[cSort.k];
        const creators = [...lb.creators].sort((a, b) => (a[1][cKey] - b[1][cKey]) * -cSort.d).slice(0, 25);
        const tKey = { vol: "volume", pnl: "pnl", trades: "count" }[tSort.k];
        const traders = [...lb.traders].sort((a, b) => (a[1][tKey] - b[1][tKey]) * -tSort.d).slice(0, 25);
        // доллары крупно, ETH мелкой подписью
        const ethUsd = (v) => {
          const d = v * rate;
          return <>{d >= 1000 ? usd(d) : "$" + d.toFixed(2)} <span className="usd-sub">({fmtEth(v)} ETH)</span></>;
        };
        return (
        <div className="lb-grid" style={{ marginTop: 18 }}>
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div className="bt-tab on">🏆 {t("Топ создателей")}</div>
              <div className="pill-group">
                {[["fees", t("Комиссии")], ["vol", t("Объём")], ["tokens", t("Монет")]].map(([k, lbl]) => (
                  <div key={k} className={`fpill ${cSort.k === k ? "on" : ""}`} onClick={() => pickC(k)}>
                    {lbl}<i style={{ fontStyle: "normal", opacity: .55, fontSize: 9 }}>{arrow(cSort, k)}</i>
                  </div>
                ))}
              </div>
            </div>
            {creators.length === 0 && <div className="center">{t("Пока пусто.")}</div>}
            {creators.map(([addr, c], i) => (
              <a className="lb-row" key={addr} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <span className={i < 3 ? `rank-num rk${i + 1}` : "dim"}>{i + 1}</span>
                <span className="lb-who">
                  <span className="mono">{short(addr)}</span>
                  <span className="lb-syms">
                    {c.tokens} {t("монет")} · {c.symbols.slice(0, 5).map((s) => `$${s}`).join(" ")}
                  </span>
                </span>
                <span className="lb-val" style={{ color: cSort.k === "fees" ? "var(--gold)" : undefined }}>
                  {cSort.k === "tokens" ? c.tokens : ethUsd(cSort.k === "vol" ? c.volume : c.earned)}
                </span>
              </a>
            ))}
          </div>
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div className="bt-tab on">⚡ {t("Топ трейдеров")}</div>
              <div className="pill-group">
                {[["vol", t("Объём")], ["pnl", "PnL"], ["trades", t("Сделки")]].map(([k, lbl]) => (
                  <div key={k} className={`fpill ${tSort.k === k ? "on" : ""}`} onClick={() => pickT(k)}>
                    {lbl}<i style={{ fontStyle: "normal", opacity: .55, fontSize: 9 }}>{arrow(tSort, k)}</i>
                  </div>
                ))}
              </div>
            </div>
            {traders.length === 0 && <div className="center">{t("Пока пусто.")}</div>}
            {traders.map(([addr, x], i) => (
              <a className="lb-row" key={addr} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <span className={i < 3 ? `rank-num rk${i + 1}` : "dim"}>{i + 1}</span>
                <span className="lb-who">
                  <span className="mono">{short(addr)}</span>
                  <span className="lb-syms">{x.count} {t("сделок")} · {fmtEth(x.volume)} ETH</span>
                </span>
                <span className="lb-val" style={tSort.k === "pnl" ? { color: x.pnl >= 0 ? "var(--leaf)" : "var(--red)" } : undefined}>
                  {tSort.k === "trades" ? x.count
                    : tSort.k === "pnl" ? <>{x.pnl >= 0 ? "+" : "−"}{ethUsd(Math.abs(x.pnl))}</>
                    : ethUsd(x.volume)}
                </span>
              </a>
            ))}
          </div>
        </div>
        );
      })()}
    </>
  );
}
