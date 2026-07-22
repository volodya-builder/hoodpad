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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const D = (e) => {
    const v = e * rate;
    return v >= 1000 ? usd(v) : "$" + v.toFixed(2);
  };
  const me = wallet?.account;

  const load = useCallback(async () => {
    const [tokens, epoch, endsIn, minPower] = await Promise.all([
      loadTokens(),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "epoch" }),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "epochEndsIn" }),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "minPower" }).catch(() => 0n),
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
    setSt({ tokens, rows, epoch, endsIn: Number(endsIn), myPower, myChoice, minPower });
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
        {t("Голос за шкуру: твоя сила голоса — это комиссии, уплаченные торговлей в текущем раунде. Раз в неделю казна выкупает токен-победитель с рынка и сжигает купленное — памп цены и дефляция для всех его держателей. Голосуй, чтобы система поддержала твою монету.")}
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

        {wallet && !votedFor && st.myPower < st.minPower && (() => {
          // сила = 1% объёма => объём = сила × 100
          const myVolUsd = Number(formatEther(st.myPower)) * 100 * rate;
          const needVolUsd = Number(formatEther(st.minPower)) * 100 * rate;
          const pct = needVolUsd > 0 ? Math.min((myVolUsd / needVolUsd) * 100, 100) : 0;
          return (
            <div className="cushion-banner" style={{ marginTop: 12, display: "block" }}>
              ⚡ {t("Право голоса — от")} <b>{usd(needVolUsd)}</b> {t("объёма торгов в раунде.")}{" "}
              {t("Твой объём:")} <b>{myVolUsd >= 1000 ? usd(myVolUsd) : "$" + myVolUsd.toFixed(2)}</b> ({fmt(pct, 0)}%)
              <span className="vr-bar" style={{ display: "block", marginTop: 8, maxWidth: 340 }}>
                <span style={{ width: `${Math.max(pct, 2)}%` }} />
              </span>
            </div>
          );
        })()}

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
                <button className="btn" disabled={!!votedFor || busy === tk.token || (wallet && st.myPower < st.minPower)}
                        onClick={() => doVote(tk.token)}
                        title={votedFor ? t("Голос в этом раунде уже отдан")
                          : wallet && st.myPower < st.minPower ? t("Недостаточно объёма торгов для голоса") : ""}>
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
