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
const LB_LS = "hood_cache_leaderboard_v1";
try {
  const s = localStorage.getItem(LB_LS);
  if (s) _lbRaw = JSON.parse(s);
} catch (e) { /* ignore */ }

export default function Leaderboard() {
  const { t } = useLang();
  const rate = useEthUsd();
  const [lb, setLb] = useState(_lbRaw);
  const [error, setError] = useState("");

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
        const c = creatorsMap[key] ?? { earned: 0, symbols: [] };
        c.earned += earned;
        c.symbols.push(a.tk.symbol);
        creatorsMap[key] = c;
      }
      const tradersMap = {};
      for (const a of all) for (const tr of a.trades) {
        const k = tr.addr.toLowerCase();
        const x = tradersMap[k] ?? { volume: 0, count: 0 };
        x.volume += tr.eth + tr.fee;
        x.count += 1;
        tradersMap[k] = x;
      }
      const next = {
        creators: Object.entries(creatorsMap).sort((a, b) => b[1].earned - a[1].earned).slice(0, 25),
        traders: Object.entries(tradersMap).sort((a, b) => b[1].volume - a[1].volume).slice(0, 25),
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

      {lb && (
        <div className="lb-grid" style={{ marginTop: 18 }}>
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs"><div className="bt-tab on">🏆 {t("Топ создателей")}</div></div>
            {lb.creators.length === 0 && <div className="center">{t("Пока пусто.")}</div>}
            {lb.creators.map(([addr, c], i) => (
              <a className="lb-row" key={addr} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <span className={i < 3 ? `rank-num rk${i + 1}` : "dim"}>{i + 1}</span>
                <span className="lb-who">
                  <span className="mono">{short(addr)}</span>
                  <span className="lb-syms">{c.symbols.slice(0, 8).map((s) => `$${s}`).join(" ")}</span>
                </span>
                <span className="lb-val" style={{ color: "var(--gold)" }}>
                  {fmtEth(c.earned)} ETH <span className="usd-sub">({usd(c.earned * rate)})</span>
                </span>
              </a>
            ))}
          </div>
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs"><div className="bt-tab on">⚡ {t("Топ трейдеров")}</div></div>
            {lb.traders.length === 0 && <div className="center">{t("Пока пусто.")}</div>}
            {lb.traders.map(([addr, x], i) => (
              <a className="lb-row" key={addr} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <span className={i < 3 ? `rank-num rk${i + 1}` : "dim"}>{i + 1}</span>
                <span className="lb-who">
                  <span className="mono">{short(addr)}</span>
                  <span className="lb-syms">{x.count} {t("сделок")}</span>
                </span>
                <span className="lb-val">
                  {fmtEth(x.volume)} ETH <span className="usd-sub">({usd(x.volume * rate)})</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
