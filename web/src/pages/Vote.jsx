import React, { useEffect, useState, useCallback } from "react";
import { parseAbi, parseAbiItem } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { VOTE_ADDRESS } from "../lib/config.js";
import { loadTokens } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

const voteAbi = parseAbi([
  "function vote(address token)",
  "function epoch() view returns (uint256)",
  "function epochEndsIn() view returns (uint256)",
  "function voted(uint256, address) view returns (bool)",
]);
const voteEvent = parseAbiItem(
  "event Vote(address indexed token, address indexed voter, uint256 indexed epoch)"
);

function countdown(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

export default function Vote({ wallet, onConnect }) {
  const { t } = useLang();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enabled = VOTE_ADDRESS !== "0x0000000000000000000000000000000000000000";

  const load = useCallback(async () => {
    if (!enabled) return;
    const [tokens, ep, endsIn] = await Promise.all([
      loadTokens(),
      publicClient.readContract({ address: VOTE_ADDRESS, abi: voteAbi, functionName: "epoch" }),
      publicClient.readContract({ address: VOTE_ADDRESS, abi: voteAbi, functionName: "epochEndsIn" }),
    ]);
    const logs = await publicClient.getLogs({
      address: VOTE_ADDRESS, event: voteEvent, args: { epoch: ep },
      fromBlock: 0n, toBlock: "latest",
    });
    const tally = {};
    for (const l of logs) {
      const k = l.args.token.toLowerCase();
      tally[k] = (tally[k] ?? 0) + 1;
    }
    let myVote = null;
    if (wallet) {
      const mine = logs.find(
        (l) => l.args.voter.toLowerCase() === wallet.account.toLowerCase()
      );
      if (mine) myVote = mine.args.token.toLowerCase();
    }
    const total = logs.length;
    const rows = tokens
      .filter((t) => !t.graduated)
      .map((t) => ({ ...t, votes: tally[t.token.toLowerCase()] ?? 0 }))
      .sort((a, b) => b.votes - a.votes);
    setState({ rows, total, endsIn: Number(endsIn), myVote, ep });
  }, [wallet, enabled]);

  useEffect(() => {
    load().catch((e) => setError(e.shortMessage || e.message));
    const id = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(id);
  }, [load]);

  async function castVote(token) {
    setError("");
    if (!wallet) return onConnect();
    setBusy(true);
    try {
      const hash = await wallet.walletClient.writeContract({
        address: VOTE_ADDRESS, abi: voteAbi, functionName: "vote", args: [token],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setBusy(false); }
  }

  if (!enabled) {
    return (
      <div className="center" style={{ paddingTop: 80 }}>
        {t("Голосование скоро появится — контракт готовится к деплою.")}
      </div>
    );
  }

  return (
    <>
      <div className="page-title">{t("Голосование за выкуп")}</div>
      <div className="page-sub">
        {t("Каждую неделю комьюнити подсказывает казне, какой токен поддержать выкупом: один кошелёк — один голос за раунд, всё в блокчейне. Итоговое решение о выкупе принимает платформа — голосование совещательное.")}
      </div>

      {state && (
        <div className="about-card" style={{ marginTop: 0 }}>
          <div className="about-stat">
            <div className="k">{t("Голосов в раунде")}</div>
            <div className="v">{state.total}</div>
          </div>
          <div className="about-stat">
            <div className="k">{t("До конца раунда")}</div>
            <div className="v">{countdown(state.endsIn)}</div>
          </div>
          {state.myVote && (
            <div className="about-stat">
              <div className="k">{t("Ваш голос")}</div>
              <div className="v" style={{ fontSize: 18 }}>
                {state.rows.find((r) => r.token.toLowerCase() === state.myVote)?.symbol ?? short(state.myVote)} ✓
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {!state && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {state && state.rows.length === 0 && (
        <div className="center">{t("Нет токенов на кривой — голосовать пока не за кого.")}</div>
      )}

      {state && state.rows.length > 0 && (
        <div className="bottom-card" style={{ marginTop: 18 }}>
          {state.rows.map((t, i) => {
            const sharePct = state.total > 0 ? (t.votes / state.total) * 100 : 0;
            const isMine = state.myVote === t.token.toLowerCase();
            return (
              <div className="prow6" key={t.token}
                   style={{ gridTemplateColumns: "40px 1.6fr 2fr 90px 130px" }}>
                <span className="dim">{i + 1}</span>
                <a href={`#/token/${t.token}`}
                   style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  {t.meta.image && (
                    <img src={t.meta.image} style={{ width: 30, height: 30, borderRadius: 8 }} alt="" />
                  )}
                  <span>
                    <b>{t.symbol}</b>{" "}
                    <span className="dim" style={{ fontSize: 12 }}>{t.name}</span>
                  </span>
                </a>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span className="pbar" style={{ flex: 1, margin: 0 }}>
                    <span style={{ display: "block", height: "100%", borderRadius: 3,
                                   background: "var(--gold)", width: `${sharePct}%` }} />
                  </span>
                  <span className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmt(sharePct, 0)}%
                  </span>
                </span>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{t.votes}</b>
                {isMine ? (
                  <span className="badge">{t("ваш голос")}</span>
                ) : (
                  <button className="btn" disabled={busy || !!state.myVote}
                          onClick={() => castVote(t.token)}
                          title={state.myVote ? t("Вы уже голосовали в этом раунде") : ""}>
                    {t("Голосовать")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="ana-note">
        {t("Голос — маленькая транзакция в сети (газ — доли цента). Новый раунд начинается автоматически каждые 7 дней.")}
      </div>
    </>
  );
}
