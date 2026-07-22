import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { tokenAbi } from "../lib/abi.js";
import { EXPLORER } from "../lib/config.js";
import { loadTokens, subgraphUserTrades, poolTrades, timeAgo, useClock } from "../lib/data.js";
import { currentPosition } from "../lib/position.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

// Публичный профиль любого кошелька: статистика, позиции, история сделок,
// запуски. Открывается кликом по адресу в активности/лидерах/держателях.
export default function Trader({ address }) {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(30000);
  const addr = (address || "").toLowerCase();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("pos");
  const [cp, setCp] = useState("");

  const dollars = (e) => {
    const v = e * rate, a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    return (v < 0 ? "-" : "") + (a >= 1e3 ? usd(a) : "$" + a.toFixed(2));
  };
  const compactN = (n) =>
    n >= 1e9 ? fmt(n / 1e9, 2) + "B" : n >= 1e6 ? fmt(n / 1e6, 2) + "M"
    : n >= 1e3 ? fmt(n / 1e3, 1) + "K" : fmt(n, 0);
  const copyCA = (a) => {
    try { navigator.clipboard.writeText(a); } catch (e) { /* ignore */ }
    setCp(a); setTimeout(() => setCp(""), 1200);
  };

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) { setError("bad address"); return; }
    let alive = true;
    (async () => {
      const [tokens, ethBal] = await Promise.all([
        loadTokens(),
        publicClient.getBalance({ address }).catch(() => 0n),
      ]);
      // сделки одним запросом; фолбэк — обход пулов
      let mineAll;
      try {
        mineAll = await subgraphUserTrades(addr);
      } catch (e) {
        mineAll = [];
        for (const tk of tokens) {
          const h = await poolTrades(tk.pool).catch(() => ({ trades: [] }));
          mineAll.push(...h.trades.filter((tr) => tr.addr.toLowerCase() === addr)
            .map((tr) => ({ ...tr, pool: (tk.pool || "").toLowerCase() })));
        }
      }
      const byPool = {};
      for (const tr of mineAll) (byPool[tr.pool] ??= []).push(tr);
      const candidates = tokens.filter((tk) => byPool[(tk.pool || "").toLowerCase()]
        || (tk.creator || "").toLowerCase() === addr);
      const enriched = [];
      for (let i = 0; i < candidates.length; i += 5) {
        const part = await Promise.all(candidates.slice(i, i + 5).map(async (tk) => {
          const bal = await publicClient.readContract({
            address: tk.token, abi: tokenAbi, functionName: "balanceOf", args: [address],
          }).catch(() => 0n);
          const all = byPool[(tk.pool || "").toLowerCase()] || [];
          const cur = currentPosition(all);
          const invested = cur.filter((x) => x.side === "buy").reduce((s, x) => s + x.eth + x.fee, 0);
          const realized = cur.filter((x) => x.side === "sell").reduce((s, x) => s + x.eth, 0);
          const allInv = all.filter((x) => x.side === "buy").reduce((s, x) => s + x.eth + x.fee, 0);
          const allReal = all.filter((x) => x.side === "sell").reduce((s, x) => s + x.eth, 0);
          return { ...tk, bal, all, cur, invested, realized, allInv, allReal,
                   isMine: (tk.creator || "").toLowerCase() === addr };
        }));
        enriched.push(...part);
        if (!alive) return;
      }
      let totVal = 0, totInv = 0, totReal = 0, volume = 0;
      enriched.forEach((tk) => {
        totVal += Number(formatEther(tk.bal)) * Number(formatEther(tk.price));
        totInv += tk.allInv; totReal += tk.allReal;
        volume += tk.all.reduce((s, x) => s + x.eth + x.fee, 0);
      });
      const next = {
        ethBal, enriched, volume,
        positions: enriched.filter((tk) => Number(formatEther(tk.bal)) >= 1),
        launched: enriched.filter((tk) => tk.isMine),
        totVal, totInv, totReal, totPnl: totVal + totReal - totInv,
        tradesCount: mineAll.length,
        history: enriched.flatMap((tk) => tk.all.map((tr) => ({ ...tr, sym: tk.symbol, token: tk.token, img: tk.meta?.image })))
          .sort((a, b) => Number(b.block - a.block)).slice(0, 50),
      };
      if (alive) setState(next);
    })().catch((e) => alive && setError(e.shortMessage || e.message));
    return () => { alive = false; };
  }, [addr]);

  return (
    <>
      <div className="pf-head" style={{ display: "flex", alignItems: "center", gap: 16, margin: "30px 0 18px" }}>
        <div className="pf-ava" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--card)",
          border: "1px solid var(--border-gold)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
          👤
        </div>
        <div>
          <div className="page-title" style={{ margin: 0, fontSize: 26 }}>{t("Трейдер")}</div>
          <div className="dim mono" style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
            {short(address || "")}
            <span className="addr-copy" style={{ cursor: "pointer" }} onClick={() => copyCA(address)}>
              {cp === address ? "✓" : "⧉"}
            </span>
            <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">↗</a>
            {state && <> · {t("баланс")} {fmtEth(Number(formatEther(state.ethBal)))} ETH ({dollars(Number(formatEther(state.ethBal)))})</>}
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!state && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {state && (<>
        <div className="ana-grid" style={{ marginTop: 6 }}>
          <div className="ana-card pf-stat">
            <div className="k">{t("Общий PnL")}</div>
            <div className="pf-usd" style={{ color: state.totPnl >= 0 ? "var(--leaf)" : "var(--red)" }}>
              {state.totPnl >= 0 ? "+" : ""}{dollars(state.totPnl)}
              {state.totInv > 0 && (
                <span className="pf-pct">{state.totPnl >= 0 ? "+" : ""}{fmt((state.totPnl / state.totInv) * 100, 1)}%</span>
              )}
            </div>
            <div className="s">{state.tradesCount} {t("сделок")}</div>
          </div>
          <div className="ana-card pf-stat">
            <div className="k">{t("Объём торгов")}</div>
            <div className="pf-usd">{dollars(state.volume)}</div>
            <div className="s">{fmtEth(state.volume)} ETH</div>
          </div>
          <div className="ana-card pf-stat">
            <div className="k">{t("Стоимость позиций")}</div>
            <div className="pf-usd">{dollars(state.totVal)}</div>
            <div className="s">{state.positions.length} {t("позиций")}</div>
          </div>
          <div className="ana-card pf-stat">
            <div className="k">{t("Запусков")}</div>
            <div className="pf-usd">{state.launched.length}</div>
            <div className="s">{state.launched.filter((x) => x.graduated).length} {t("градуировало")}</div>
          </div>
        </div>

        <div className="bottom-card" style={{ marginTop: 18 }}>
          <div className="bt-tabs">
            <div className={`bt-tab ${tab === "pos" ? "on" : ""}`} onClick={() => setTab("pos")}>{t("Позиции")}</div>
            <div className={`bt-tab ${tab === "hist" ? "on" : ""}`} onClick={() => setTab("hist")}>{t("История сделок")}</div>
            {state.launched.length > 0 && (
              <div className={`bt-tab ${tab === "mint" ? "on" : ""}`} onClick={() => setTab("mint")}>{t("Запуски")}</div>
            )}
          </div>

          {tab === "pos" && (<>
            {state.positions.length === 0 && <div className="center">{t("Открытых позиций нет.")}</div>}
            {state.positions.map((p) => {
              const balTok = Number(formatEther(p.bal));
              const val = balTok * Number(formatEther(p.price));
              const totPnl = val + p.realized - p.invested;
              const pct = p.invested > 0 ? (totPnl / p.invested) * 100 : 0;
              return (
                <div className="pos-row" key={p.token}
                     onClick={() => { window.location.hash = `#/token/${p.token}`; window.scrollTo({ top: 0 }); }}>
                  <span className="pos-id tk-cell">
                    <span>{t("Токен")}</span>
                    <span className="pos-id-body">
                      {p.meta.image && <img src={p.meta.image} alt="" style={{ width: 28, height: 28, borderRadius: 9 }} />}
                      <b className="ticker" style={{ fontSize: 13 }}>${p.symbol}</b>
                    </span>
                  </span>
                  <div className="tk-cell"><span>{t("Куплено")}</span><b>{dollars(p.invested)}</b></div>
                  <div className="tk-cell"><span>{t("Продано")}</span><b>{dollars(p.realized)}</b></div>
                  <div className="tk-cell"><span>{t("Баланс")}</span><b>{dollars(val)}</b><span>{compactN(balTok)}</span></div>
                  <div className="tk-cell"><span>{t("Прибыль")}</span>
                    <b style={{ color: totPnl >= 0 ? "var(--leaf)" : "var(--red)" }}>
                      {dollars(totPnl)} ({pct >= 0 ? "+" : ""}{fmt(pct, 1)}%)
                    </b></div>
                </div>
              );
            })}
          </>)}

          {tab === "hist" && (<>
            {state.history.length === 0 && <div className="center">{t("Сделок пока нет.")}</div>}
            {state.history.length > 0 && (
              <div className="trow phist hdr" style={{ marginTop: 8 }}>
                <span>{t("Монета")}</span><span>{t("Время")}</span><span>{t("Тип")}</span>
                <span>ETH</span><span>{t("Токены")}</span><span>{t("Блок")}</span>
              </div>
            )}
            {state.history.map((tr, i) => (
              <div className="trow phist" key={i}>
                <span className="hist-coin" onClick={() => copyCA(tr.token)} title={t("Скопировать адрес контракта")}>
                  {tr.img ? <img src={tr.img} alt="" /> : <span className="ts-ph">🖼️</span>}
                  <a href={`#/token/${tr.token}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
                    <b>${tr.sym}</b>
                  </a>
                  <span className="mono dim">{cp === tr.token ? "✓" : `${tr.token.slice(0, 6)}…${tr.token.slice(-4)} ⧉`}</span>
                </span>
                <span className="dim">{tr.ts ? timeAgo(tr.ts) : "—"}</span>
                <span className={tr.side === "buy" ? "side-buy" : "side-sell"}>{t(tr.side === "buy" ? "Купил" : "Продал")}</span>
                <a href={`${EXPLORER}/tx/${tr.tx}`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                  {fmtEth(tr.eth)} ETH <span className="usd-sub">({dollars(tr.eth)})</span>
                </a>
                <span>{compactN(tr.tokens)}</span>
                <a className="dim" href={`${EXPLORER}/block/${tr.block}`} target="_blank" rel="noreferrer">{String(tr.block)}</a>
              </div>
            ))}
          </>)}

          {tab === "mint" && state.launched.map((p) => (
            <div className="pos-row" key={p.token}
                 onClick={() => { window.location.hash = `#/token/${p.token}`; window.scrollTo({ top: 0 }); }}>
              <span className="pos-id tk-cell">
                <span>{t("Токен")}</span>
                <span className="pos-id-body">
                  {p.meta.image && <img src={p.meta.image} alt="" style={{ width: 28, height: 28, borderRadius: 9 }} />}
                  <b className="ticker" style={{ fontSize: 13 }}>${p.symbol}</b>
                </span>
              </span>
              <div className="tk-cell"><span>{t("Капа")}</span>
                <b>{usd(Number(formatEther(p.price)) * 1e9 * rate)}</b></div>
              <div className="tk-cell"><span>{t("Кривая")}</span>
                <b>{fmt(Number((p.sold * 10000n) / p.cap) / 100, 1)}%</b></div>
              <div className="tk-cell"><span>{t("Статус")}</span>
                <b>{p.graduated ? "🎯 " + t("Градуировал") : t("на кривой")}</b></div>
            </div>
          ))}
        </div>
      </>)}
    </>
  );
}
