import React, { useEffect, useState, useCallback, useMemo } from "react";
import { formatEther, parseEther } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { treasuryAbi, tokenAbi, poolExtraAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { loadTokens, subgraphVotes, subgraphTreasuryOps, timeAgo } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

const EPOCH_LEN = 7 * 86400;

export default function Admin({ wallet, onConnect }) {
  const { t } = useLang();
  const rate = useEthUsd();
  const [owner, setOwner] = useState(null);
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [amt, setAmt] = useState("");
  const [burnAmt, setBurnAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const dollars = (e) => {
    const v = e * rate, a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    return a >= 1e3 ? usd(v) : "$" + v.toFixed(2);
  };

  const load = useCallback(async () => {
    const [tokens, bal, received, spent, ownerAddr] = await Promise.all([
      loadTokens(),
      publicClient.getBalance({ address: TREASURY_ADDRESS }),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => 0n),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => 0n),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "owner" }).catch(() => null),
    ]);
    const ep = BigInt(Math.floor(Date.now() / 1000 / EPOCH_LEN));
    const votes = await subgraphVotes(ep).catch(() => []);
    const tally = {};
    votes.forEach((v) => { tally[v.token] = (tally[v.token] ?? 0) + 1; });
    const held = await Promise.all(tokens.map((tk) =>
      publicClient.readContract({ address: tk.token, abi: tokenAbi, functionName: "balanceOf", args: [TREASURY_ADDRESS] }).catch(() => 0n)
    ));
    const accrued = await Promise.all(tokens.map((tk) =>
      publicClient.readContract({ address: tk.pool, abi: poolExtraAbi, functionName: "protocolFeesAccrued" }).catch(() => 0n)
    ));
    const ops = await subgraphTreasuryOps().catch(() => []);
    const list = tokens.map((tk, i) => ({
      ...tk, held: held[i], accrued: accrued[i], voteCount: tally[tk.token.toLowerCase()] ?? 0,
    })).sort((a, b) => b.voteCount - a.voteCount || Number(b.reserve - a.reserve));
    const unclaimed = accrued.reduce((s2, a) => s2 + a, 0n);
    setOwner(ownerAddr);
    setData({ list, bal, received, spent, unclaimed, ops: ops.slice(0, 12) });
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.shortMessage || e.message));
    const id = setInterval(() => load().catch(() => {}), 20000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    return data.list.filter((tk) =>
      !n || tk.symbol.toLowerCase().includes(n) || tk.name.toLowerCase().includes(n)
        || tk.token.toLowerCase().includes(n)
    );
  }, [data, q]);

  const selected = useMemo(
    () => (sel && data ? data.list.find((x) => x.token === sel) : null),
    [sel, data]
  );

  async function run(fn, okText) {
    setError(""); setOk(""); setBusy(true);
    try {
      const hash = await fn();
      await publicClient.waitForTransactionReceipt({ hash });
      setOk(okText + " · " + short(hash));
      setAmt(""); setBurnAmt("");
      await load();
      setTimeout(() => load().catch(() => {}), 3000);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setBusy(false); }
  }

  const doBuyback = () => run(
    () => wallet.walletClient.writeContract({
      address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "buyback",
      args: [selected.token, parseEther(amt), 0n],
    }),
    t("Выкуп исполнен")
  );

  async function claimAll() {
    setError(""); setOk(""); setBusy(true);
    try {
      let claimed = 0;
      for (const tk of data.list) {
        if (tk.accrued > 0n) {
          const hash = await wallet.walletClient.writeContract({
            address: tk.pool, abi: poolExtraAbi, functionName: "claimProtocolFees",
          });
          await publicClient.waitForTransactionReceipt({ hash });
          claimed++;
        }
      }
      setOk(t("Комиссии собраны") + ` (${claimed})`);
      await load();
      setTimeout(() => load().catch(() => {}), 3000);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setBusy(false); }
  }

  const doBurn = () => run(
    () => wallet.walletClient.writeContract({
      address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "burn",
      args: [selected.token, parseEther(burnAmt)],
    }),
    t("Сжигание исполнено")
  );

  if (!wallet) {
    return (
      <div className="center" style={{ paddingTop: 80 }}>
        {t("Подключите кошелёк владельца платформы.")}{" "}
        <a style={{ color: "var(--gold)", cursor: "pointer" }} onClick={onConnect}>{t("Подключить →")}</a>
      </div>
    );
  }
  if (owner && wallet.account.toLowerCase() !== owner.toLowerCase()) {
    return (
      <div className="center" style={{ paddingTop: 80 }}>
        {t("Доступ только для владельца платформы.")}
      </div>
    );
  }

  const balEth = data ? Number(formatEther(data.bal)) : 0;

  return (
    <>
      <div className="page-title">⚙ {t("Панель управления казной")}</div>
      <div className="page-sub" style={{ maxWidth: 720 }}>
        {t("Выберите токен и выполните выкуп с казны. Голоса раунда показаны как подсказка — решение всегда за вами.")}
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="notice" style={{ margin: "10px 0" }}>✓ {ok}</div>}
      {!data && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {data && (
        <>
          <div className="ana-grid" style={{ margin: "18px 0 8px" }}>
            <div className="ana-card">
              <div className="k">{t("Баланс казны")}</div>
              <div className="v" style={{ color: "var(--gold)", fontSize: 24 }}>{fmt(balEth, 5)} ETH</div>
              <div className="s">{dollars(balEth)}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Получено за всё время")}</div>
              <div className="v" style={{ fontSize: 24 }}>{fmt(Number(formatEther(data.received)), 5)} ETH</div>
              <div className="s">{dollars(Number(formatEther(data.received)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Потрачено на выкупы")}</div>
              <div className="v" style={{ fontSize: 24 }}>{fmt(Number(formatEther(data.spent)), 5)} ETH</div>
              <div className="s">{dollars(Number(formatEther(data.spent)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Несобранные комиссии в пулах")}</div>
              <div className="v" style={{ fontSize: 24, color: data.unclaimed > 0n ? "var(--gold)" : "inherit" }}>
                {fmt(Number(formatEther(data.unclaimed)), 6)} ETH
              </div>
              <div className="s" style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy || data.unclaimed === 0n} onClick={claimAll}>
                  {busy ? "…" : t("Собрать в казну")}
                </button>
              </div>
            </div>
          </div>

          <div className="vote-layout">
            <div className="bottom-card" style={{ marginTop: 0 }}>
              <div style={{ padding: "14px 16px 4px" }}>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Поиск: тикер, имя или адрес…")}
                  spellCheck={false}
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
              {filtered.length === 0 && <div className="center">{t("Ничего не найдено")}</div>}
              {filtered.map((tk) => (
                <div key={tk.token}
                     className={`prow6 vote-row ${sel === tk.token ? "adm-sel" : ""}`}
                     style={{ gridTemplateColumns: "44px 1.6fr 1fr 1fr 1fr", cursor: "pointer" }}
                     onClick={() => { setSel(tk.token); setOk(""); setError(""); }}>
                  <span>
                    {tk.meta.image
                      ? <img src={tk.meta.image} style={{ width: 32, height: 32, borderRadius: 9 }} alt="" />
                      : "🖼️"}
                  </span>
                  <span>
                    <b>{tk.symbol}</b>{" "}
                    <span className="dim" style={{ fontSize: 12 }}>{tk.name}</span>
                    {tk.graduated && <span className="badge" style={{ marginLeft: 6 }}>🎯</span>}
                  </span>
                  <span className="dim">🗳 {tk.voteCount} {t("голосов")}</span>
                  <span className="dim">{fmt(Number(formatEther(tk.reserve)), 3)} ETH</span>
                  <span className="dim">
                    {tk.held > 0n ? `${fmt(Number(formatEther(tk.held)), 0)} ${t("в казне")}` : "—"}
                  </span>
                </div>
              ))}
            </div>

            <aside className="wallet-panel">
              {!selected && <div className="dim">{t("Выберите токен слева, чтобы выкупить или сжечь.")}</div>}
              {selected && (
                <>
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {selected.meta.image && <img src={selected.meta.image} style={{ width: 26, height: 26, borderRadius: 7 }} alt="" />}
                    ${selected.symbol}
                  </h3>

                  {selected.graduated ? (
                    <div className="dim" style={{ marginBottom: 12 }}>
                      {t("Токен градуировал — кривая закрыта, выкуп с казны недоступен.")}
                    </div>
                  ) : (
                    <>
                      <label>{t("Сумма выкупа (ETH)")}</label>
                      <div className="wp-filters" style={{ marginBottom: 8 }}>
                        <input value={amt} onChange={(e) => setAmt(e.target.value)}
                               placeholder="0.001" inputMode="decimal" />
                      </div>
                      <div className="qa-row" style={{ marginTop: 0, marginBottom: 10 }}>
                        {[10, 25, 50].map((p) => (
                          <div key={p} className="fpill qa-pill"
                               onClick={() => setAmt((balEth * p / 100).toFixed(6))}>
                            {p}% {t("казны")}
                          </div>
                        ))}
                      </div>
                      <button className="btn btn-primary btn-block" disabled={busy || !amt}
                              onClick={doBuyback}>
                        {busy ? "…" : `${t("Выкупить")} $${selected.symbol}`}
                      </button>
                    </>
                  )}

                  {selected.held > 0n && (
                    <>
                      <label style={{ marginTop: 18, display: "block" }}>
                        {t("Сжечь токены")} · {t("в казне")} {fmt(Number(formatEther(selected.held)), 0)}
                      </label>
                      <div className="wp-filters" style={{ marginBottom: 8 }}>
                        <input value={burnAmt} onChange={(e) => setBurnAmt(e.target.value)}
                               placeholder="0" inputMode="decimal" />
                      </div>
                      <div className="qa-row" style={{ marginTop: 0, marginBottom: 10 }}>
                        <div className="fpill qa-pill"
                             onClick={() => setBurnAmt(formatEther(selected.held))}>
                          MAX
                        </div>
                      </div>
                      <button className="btn btn-danger btn-block" disabled={busy || !burnAmt}
                              onClick={doBurn}>
                        {busy ? "…" : `🔥 ${t("Сжечь")}`}
                      </button>
                    </>
                  )}
                </>
              )}

              {data.ops.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div className="k" style={{ fontSize: 11.5, color: "var(--text-dim)", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
                    {t("Последние операции")}
                  </div>
                  {data.ops.map((o, i) => (
                    <a key={i} className="wp-item" href={`${EXPLORER}/tx/${o.tx}`} target="_blank" rel="noreferrer">
                      <span>{o.kind === "received" ? "↓" : o.kind === "buyback" ? "🛒" : "🔥"}</span>
                      <span className="dim" style={{ fontSize: 12 }}>
                        {o.kind === "burned"
                          ? `${fmt(Number(o.tokenAmount) / 1e18, 0)}`
                          : `${fmt(Number(o.ethAmount) / 1e18, 5)} ETH`}
                      </span>
                      <span className="when">{timeAgo(Number(o.timestamp) * 1000)}</span>
                    </a>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
