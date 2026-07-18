import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt } from "../lib/web3.js";
import { treasuryAbi, poolExtraAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { loadTokens, poolTrades } from "../lib/data.js";

export default function Analytics() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = await loadTokens();
      const all = await Promise.all(tokens.map(async (t) => {
        const [h, shareBps] = await Promise.all([
          poolTrades(t.pool).catch(() => ({ trades: [] })),
          publicClient.readContract({ address: t.pool, abi: poolExtraAbi, functionName: "creatorFeeShareBps" }).catch(() => 2000),
        ]);
        return { ...h, shareBps: Number(shareBps) };
      }));
      const trades = all.flatMap((h) => h.trades);
      const volume = trades.reduce((s, tr) => s + tr.eth + tr.fee, 0);
      const fees = trades.reduce((s, tr) => s + tr.fee, 0);
      const creatorPaidExact = all.reduce((s, h) =>
        s + h.trades.reduce((x, tr) => x + tr.fee, 0) * (h.shareBps / 10000), 0);
      const [treBal, received, spent] = await Promise.all([
        publicClient.getBalance({ address: TREASURY_ADDRESS }),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => 0n),
      ]);
      if (!alive) return;
      setStats({
        volume, fees, tradesCount: trades.length,
        launches: tokens.length,
        grads: tokens.filter((t) => t.graduated).length,
        creatorPaid: creatorPaidExact,
        treBal, received, spent,
      });
    })().catch((e) => alive && setError(e.shortMessage || e.message));
    return () => { alive = false; };
  }, []);

  return (
    <>
      <div className="page-title">Аналитика протокола</div>
      <div className="page-sub">Все цифры читаются напрямую из контрактов hood в Robinhood Chain.</div>
      {error && <div className="error">{error}</div>}
      {!stats && !error && <div className="center">Читаю события из блокчейна…</div>}
      {stats && (
        <div className="ana-grid">
          <div className="ana-card">
            <div className="k">Объём торгов</div>
            <div className="v">{fmt(stats.volume, 4)} ETH</div>
            <div className="s">{stats.tradesCount} сделок за всё время</div>
          </div>
          <div className="ana-card">
            <div className="k">Запуски токенов</div>
            <div className="v">{stats.launches}</div>
            <div className="s">{stats.grads} градаций</div>
          </div>
          <div className="ana-card">
            <div className="k">Выплачено создателям</div>
            <div className="v" style={{ color: "var(--gold)" }}>{fmt(stats.creatorPaid, 5)} ETH</div>
            <div className="s">доля создателя каждого пула — с первого трейда</div>
          </div>
          <div className="ana-card">
            <div className="k">Казна выкупа</div>
            <div className="v" style={{ color: "var(--gold)" }}>{fmt(Number(formatEther(stats.treBal)), 5)} ETH</div>
            <div className="s">
              получено {fmt(Number(formatEther(stats.received)), 5)} · выкуплено на {fmt(Number(formatEther(stats.spent)), 5)}
              {" · "}
              <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
                контракт
              </a>
            </div>
          </div>
        </div>
      )}
      <div className="ana-note">
        Примечание: комиссии попадают в казну после вызова claimProtocolFees у пула —
        до этого они накапливаются в самом пуле.
      </div>
    </>
  );
}
