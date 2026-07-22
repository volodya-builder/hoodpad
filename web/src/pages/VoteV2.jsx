import React, { useEffect, useState, useCallback } from "react";
import { formatEther } from "viem";
import { publicClient, fmt, fmtEth } from "../lib/web3.js";
import { votePowerAbi } from "../lib/abi.js";
import { VOTEPOWER_ADDRESS } from "../lib/config.js";
import { loadTokens, useClock } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

// «Голос за шкуру» (v2): сила голоса = комиссии, уплаченные в текущем
// 7-дневном раунде. Голосуешь силой за токен; казна выкупает победителя,
// 50% выкупленного распределяется голосовавшим за него. Клейм — здесь же.
export default function VoteV2({ wallet, onConnect }) {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(5000);
  const [st, setSt] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const D = (e) => {
    const v = e * rate;
    return v >= 1000 ? usd(v) : "$" + v.toFixed(2);
  };
  const me = wallet?.account;

  const load = useCallback(async () => {
    const [tokens, epoch, endsIn] = await Promise.all([
      loadTokens(),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "epoch" }),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "epochEndsIn" }),
    ]);
    const live = tokens.filter((x) => !x.graduated);
    const totals = await Promise.all(live.map((tk) =>
      publicClient.readContract({
        address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "totalFor",
        args: [epoch, tk.token],
      }).catch(() => 0n)));
    let myPower = 0n, myChoice = null;
    if (me) {
      [myPower, myChoice] = await Promise.all([
        publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "powerOf", args: [epoch, me] }).catch(() => 0n),
        publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "choiceOf", args: [epoch, me] }).catch(() => null),
      ]);
    }
    const rows = live.map((tk, i) => ({ ...tk, power: totals[i] }))
      .sort((a, b) => (b.power > a.power ? 1 : b.power < a.power ? -1 : 0));
    setSt({ tokens, rows, epoch, endsIn: Number(endsIn), myPower, myChoice });

    // награды прошлых раундов
    if (me) {
      const out = [];
      for (let i = 1; i <= 8; i++) {
        const e = epoch - BigInt(i);
        if (e < 0n) break;
        const r = await publicClient.readContract({
          address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "rewardOf", args: [e],
        }).catch(() => null);
        if (!r || r[0] === "0x0000000000000000000000000000000000000000") continue;
        const pend = await publicClient.readContract({
          address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "pendingReward", args: [e, me],
        }).catch(() => 0n);
        if (pend > 0n) {
          const tk = tokens.find((x) => x.token.toLowerCase() === r[0].toLowerCase());
          out.push({ epoch: e, token: r[0], sym: tk?.symbol || "?", amount: pend });
        }
      }
      setRewards(out);
    }
  }, [me]);

  useEffect(() => {
    load().catch((e) => setError(e.shortMessage || e.message));
    const id = setInterval(() => load().catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function doVote(token) {
    if (!wallet) return onConnect();
    setBusy(token); setError("");
    try {
      const hash = await wallet.walletClient.writeContract({
        address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "vote",
        args: [token], account: wallet.account, chain: wallet.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (e) { setError(e.shortMessage || e.message); }
    setBusy("");
  }

  async function doClaim(epochId) {
    setBusy("claim" + epochId); setError("");
    try {
      const hash = await wallet.walletClient.writeContract({
        address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "claim",
        args: [epochId], account: wallet.account, chain: wallet.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (e) { setError(e.shortMessage || e.message); }
    setBusy("");
  }

  const cd = (sec) => {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d}${t("д")} ${h}${t("ч")}` : h > 0 ? `${h}${t("ч")} ${m}${t("м")}` : `${m}${t("м")}`;
  };
  const totalPower = st ? st.rows.reduce((s, r) => s + Number(formatEther(r.power)), 0) : 0;
  const votedFor = st?.myChoice && st.myChoice !== "0x0000000000000000000000000000000000000000"
    ? st.tokens.find((x) => x.token.toLowerCase() === st.myChoice.toLowerCase()) : null;

  return (
    <>
      <div className="page-title">{t("Голосование")}</div>
      <div className="page-sub" style={{ maxWidth: 760 }}>
        {t("Голос за шкуру: твоя сила голоса — это комиссии, уплаченные торговлей в текущем раунде. Раз в неделю казна выкупает победителя, и половина выкупленного делится между голосовавшими за него — пропорционально силе.")}
      </div>

      {error && <div className="error">{error}</div>}
      {!st && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {st && (<>
        <div className="vote-bar" style={{ marginTop: 16 }}>
          <div className="vb-cell"><span>{t("Раунд")}</span><b>#{String(st.epoch)}</b></div>
          <div className="vb-cell"><span>{t("До выкупа")}</span><b className="ab-timer">{cd(st.endsIn)}</b></div>
          <div className="vb-cell">
            <span>{t("Моя сила голоса")}</span>
            <b>{wallet ? <>{D(Number(formatEther(st.myPower)))} <span className="dim" style={{ fontSize: 12 }}>({fmtEth(Number(formatEther(st.myPower)))} ETH)</span></> : "—"}</b>
          </div>
          <div className="vb-cell">
            <span>{t("Мой голос")}</span>
            <b>{votedFor ? `$${votedFor.symbol}` : wallet ? t("ещё не отдан") : "—"}</b>
          </div>
        </div>

        {wallet && st.myPower === 0n && !votedFor && (
          <div className="cushion-banner" style={{ marginTop: 12 }}>
            ⚡ {t("Сила голоса зарабатывается торговлей: 1% комиссии любой сделки в этом раунде становится твоим голосом.")}
          </div>
        )}

        {rewards.length > 0 && (
          <div className="bottom-card" style={{ marginTop: 16 }}>
            <div className="bt-tabs"><div className="bt-tab on">🎁 {t("Мои награды")}</div></div>
            {rewards.map((r) => (
              <div className="pos-row" key={String(r.epoch)} style={{ cursor: "default" }}>
                <div className="tk-cell"><span>{t("Раунд")}</span><b>#{String(r.epoch)}</b></div>
                <div className="tk-cell"><span>{t("Токен")}</span><b>${r.sym}</b></div>
                <div className="tk-cell"><span>{t("Награда")}</span>
                  <b style={{ color: "var(--leaf)" }}>{fmt(Number(formatEther(r.amount)) / 1e6, 2)}M</b></div>
                <button className="btn btn-primary" style={{ marginLeft: "auto" }}
                        disabled={busy === "claim" + r.epoch}
                        onClick={() => doClaim(r.epoch)}>
                  {busy === "claim" + r.epoch ? "…" : t("Забрать")}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="bottom-card" style={{ marginTop: 16 }}>
          <div className="bt-tabs"><div className="bt-tab on">🗳 {t("Раунд выкупа")} — {t("голосуй силой")}</div></div>
          {st.rows.map((tk) => {
            const p = Number(formatEther(tk.power));
            const share = totalPower > 0 ? (p / totalPower) * 100 : 0;
            const isMy = votedFor && votedFor.token === tk.token;
            return (
              <div className="vote-row" key={tk.token}>
                <a href={`#/token/${tk.token}`} className="vr-id">
                  {tk.meta.image ? <img src={tk.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
                  <b>${tk.symbol}</b>
                  {isMy && <span className="badge hr-badge">{t("мой голос")}</span>}
                </a>
                <span className="vr-bar"><span style={{ width: `${Math.max(share, p > 0 ? 3 : 0)}%` }} /></span>
                <span className="vr-val">{D(p)} <span className="dim">({fmt(share, 0)}%)</span></span>
                <button className="btn" disabled={!!votedFor || busy === tk.token}
                        onClick={() => doVote(tk.token)}
                        title={votedFor ? t("Голос в этом раунде уже отдан") : ""}>
                  {busy === tk.token ? "…" : t("Голосовать")}
                </button>
              </div>
            );
          })}
        </div>
      </>)}
    </>
  );
}
