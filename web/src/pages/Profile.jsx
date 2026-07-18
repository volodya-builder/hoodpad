import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { tokenAbi } from "../lib/abi.js";
import { EXPLORER } from "../lib/config.js";
import { loadTokens, poolTrades } from "../lib/data.js";

export default function Profile({ wallet, onConnect }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    (async () => {
      const me = wallet.account.toLowerCase();
      const [tokens, ethBal] = await Promise.all([
        loadTokens(),
        publicClient.getBalance({ address: wallet.account }),
      ]);
      const enriched = await Promise.all(tokens.map(async (t) => {
        const [bal, hist] = await Promise.all([
          publicClient.readContract({
            address: t.token, abi: tokenAbi, functionName: "balanceOf", args: [wallet.account],
          }),
          poolTrades(t.pool).catch(() => ({ trades: [] })),
        ]);
        const mine = hist.trades.filter((tr) => tr.addr.toLowerCase() === me);
        const invested = mine.filter((x) => x.side === "buy").reduce((s, x) => s + x.eth + x.fee, 0);
        const realized = mine.filter((x) => x.side === "sell").reduce((s, x) => s + x.eth, 0);
        return { ...t, bal, mine, invested, realized };
      }));
      if (!alive) return;
      const positions = enriched.filter((t) => t.bal > 0n || t.mine.length > 0);
      const launched = enriched.filter((t) => false); // creator match below
      for (const t of enriched) {
        // creator is on the pool; cheap check via my trades isn't enough — skip deep read
      }
      let totVal = 0, totInv = 0, totReal = 0;
      positions.forEach((t) => {
        totVal += Number(formatEther(t.bal)) * Number(formatEther(t.price));
        totInv += t.invested; totReal += t.realized;
      });
      setState({
        ethBal, positions, launched,
        totVal, totInv, totReal, totPnl: totVal + totReal - totInv,
        myTrades: enriched.flatMap((t) => t.mine.map((tr) => ({ ...tr, sym: t.symbol, token: t.token })))
          .sort((a, b) => Number(b.block - a.block)).slice(0, 20),
      });
    })().catch((e) => alive && setError(e.shortMessage || e.message));
    return () => { alive = false; };
  }, [wallet]);

  if (!wallet) {
    return (
      <div className="center" style={{ paddingTop: 80 }}>
        Подключите кошелёк, чтобы увидеть профиль.{" "}
        <a style={{ color: "var(--gold)", cursor: "pointer" }} onClick={onConnect}>Подключить →</a>
      </div>
    );
  }

  return (
    <>
      <div className="pf-head">
        <div className="pf-ava">🏹</div>
        <div>
          <div className="page-title" style={{ margin: 0 }}>Профиль</div>
          <div className="dim mono">
            {short(wallet.account)} · баланс {state ? fmt(Number(formatEther(state.ethBal)), 4) : "…"} ETH
          </div>
        </div>
        {state && (
          <div style={{ marginLeft: "auto" }} className="about-stat">
            <div className="k">Общий PnL</div>
            <div className="v" style={{ color: state.totPnl >= 0 ? "var(--leaf)" : "var(--red)" }}>
              {state.totPnl >= 0 ? "+" : ""}{fmt(state.totPnl, 5)} ETH
            </div>
            <div className="s">
              позиции {fmt(state.totVal, 5)} · вложено {fmt(state.totInv, 5)} · реализовано {fmt(state.totReal, 5)}
            </div>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {!state && !error && <div className="center">Читаю блокчейн…</div>}

      {state && (
        <>
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs"><div className="bt-tab on">Мои позиции</div></div>
            {state.positions.length === 0 && <div className="center">Пока нет позиций.</div>}
            {state.positions.length > 0 && (
              <>
                <div className="prow6 hdr">
                  <span>Токен</span><span>Баланс</span><span>Стоимость</span>
                  <span>Вложено</span><span>PnL</span><span>Кривая</span>
                </div>
                {state.positions.map((t) => {
                  const val = Number(formatEther(t.bal)) * Number(formatEther(t.price));
                  const pnl = val + t.realized - t.invested;
                  const prog = Number((t.sold * 10000n) / t.cap) / 100;
                  return (
                    <a className="prow6" key={t.token} href={`#/token/${t.token}`} style={{ cursor: "pointer" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {t.meta.image && <img src={t.meta.image} style={{ width: 26, height: 26, borderRadius: 7 }} alt="" />}
                        <b>{t.symbol}</b>
                      </span>
                      <span>{fmt(Number(formatEther(t.bal)), 0)}</span>
                      <span>{fmt(val, 5)} ETH</span>
                      <span>{fmt(t.invested, 5)} ETH</span>
                      <span className={pnl >= 0 ? "pnl-pos" : "pnl-neg"}>
                        {pnl >= 0 ? "+" : ""}{fmt(pnl, 5)} ETH
                      </span>
                      <span className="dim">{t.graduated ? "🎯" : fmt(prog, 0) + "%"}</span>
                    </a>
                  );
                })}
              </>
            )}
          </div>

          <div className="bottom-card">
            <div className="bt-tabs"><div className="bt-tab on">Мои сделки</div></div>
            {state.myTrades.length === 0 && <div className="center">Сделок пока нет.</div>}
            {state.myTrades.length > 0 && (
              <>
                <div className="trow hdr">
                  <span>Тип</span><span>ETH</span><span>Токены</span><span>Токен</span><span>Блок</span>
                </div>
                {state.myTrades.map((tr, i) => (
                  <a className="trow" key={i} href={`#/token/${tr.token}`} style={{ cursor: "pointer" }}>
                    <span className={tr.side === "buy" ? "side-buy" : "side-sell"}>
                      {tr.side === "buy" ? "Купил" : "Продал"}
                    </span>
                    <span>{fmt(tr.eth, 5)}</span>
                    <span>{fmt(tr.tokens, 0)}</span>
                    <span><b>{tr.sym}</b></span>
                    <span className="dim">{String(tr.block)}</span>
                  </a>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
