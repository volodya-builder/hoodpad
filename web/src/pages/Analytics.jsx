import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt } from "../lib/web3.js";
import { treasuryAbi, poolExtraAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { loadTokens, poolTrades } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

export default function Analytics() {
  const { t } = useLang();
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
      <div className="page-title">{t("Аналитика протокола")}</div>
      <div className="page-sub">{t("Все цифры читаются напрямую из контрактов hood в Robinhood Chain.")}</div>
      {error && <div className="error">{error}</div>}
      {!stats && !error && <div className="center">{t("Читаю блокчейн…")}</div>}
      {stats && (
        <div className="ana-grid">
          <div className="ana-card">
            <div className="k">{t("Объём торгов")}</div>
            <div className="v">{fmt(stats.volume, 4)} ETH</div>
            <div className="s">{stats.tradesCount} {t("сделок за всё время")}</div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Запуски токенов")}</div>
            <div className="v">{stats.launches}</div>
            <div className="s">{stats.grads} {t("градаций")}</div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Выплачено создателям")}</div>
            <div className="v" style={{ color: "var(--gold)" }}>{fmt(stats.creatorPaid, 5)} ETH</div>
            <div className="s">{t("доля создателя каждого пула — с первого трейда")}</div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Казна выкупа")}</div>
            <div className="v" style={{ color: "var(--gold)" }}>{fmt(Number(formatEther(stats.treBal)), 5)} ETH</div>
            <div className="s">
              {t("получено")} {fmt(Number(formatEther(stats.received)), 5)} · {t("выкуплено на")} {fmt(Number(formatEther(stats.spent)), 5)}
              {" · "}
              <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
                {t("контракт")}
              </a>
            </div>
          </div>
        </div>
      )}
      <div className="ana-note">
        {t("Примечание: комиссии попадают в казну после вызова claimProtocolFees у пула — до этого они накапливаются в самом пуле.")}
      </div>
    </>
  );
}
