import React, { useEffect, useState, useCallback } from "react";
import { parseAbiItem } from "viem";
import { publicClient, fmt, fmtEth } from "../lib/web3.js";
import { votePowerAbi } from "../lib/abi.js";
import { VOTEPOWER_ADDRESS } from "../lib/config.js";
import { loadTokens, allTrades, subgraphUserTrades, recentFromBlock, useClock } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

// Простое голосование: один кошелёк — один голос за монету.
// Право голоса — у тех, кто наторговал >= MIN_VOL_USD на любой монете hood.
// Победитель = токен с наибольшим числом ГОЛОСОВ; казна выкупает его и сжигает.
const MIN_VOL_USD = 500;
const votedEvent = parseAbiItem(
  "event Voted(address indexed trader, uint256 indexed epoch, address indexed token, uint256 power)"
);

export default function VoteV2({ wallet, onConnect }) {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(5000);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const me = wallet?.account;

  const load = useCallback(async () => {
    const [tokens, epoch, endsIn, trades] = await Promise.all([
      loadTokens(),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "epoch" }),
      publicClient.readContract({ address: VOTEPOWER_ADDRESS, abi: votePowerAbi, functionName: "epochEndsIn" }),
      allTrades(),
    ]);

    // объём каждого кошелька на всей платформе (для допуска)
    const volByWallet = {};
    for (const tr of trades) {
      const k = tr.addr.toLowerCase();
      volByWallet[k] = (volByWallet[k] || 0) + (tr.eth + tr.fee) * rate;
    }

    // голоса текущего раунда: события Voted (диапазон одной эпохи)
    let votesByToken = {}, myChoice = null;
    try {
      const logs = await publicClient.getLogs({
        address: VOTEPOWER_ADDRESS, event: votedEvent,
        args: { epoch }, fromBlock: await recentFromBlock(), toBlock: "latest",
      });
      const seen = new Set();
      for (const l of logs) {
        const voter = l.args.trader.toLowerCase();
        if (seen.has(voter)) continue; // один голос на кошелёк
        seen.add(voter);
        if ((volByWallet[voter] || 0) < MIN_VOL_USD) continue; // допуск по объёму
        const tk = l.args.token.toLowerCase();
        votesByToken[tk] = (votesByToken[tk] || 0) + 1;
        if (me && voter === me.toLowerCase()) myChoice = tk;
      }
    } catch (e) { /* индексатор логов недоступен — покажем нули */ }

    const live = tokens.filter((x) => !x.graduated);
    const rows = live.map((tk) => ({ ...tk, votes: votesByToken[tk.token.toLowerCase()] || 0 }))
      .sort((a, b) => b.votes - a.votes);
    const myVol = me ? (volByWallet[me.toLowerCase()] || 0) : 0;
    setSt({ tokens, rows, epoch, endsIn: Number(endsIn), myVol, myChoice });
  }, [me, rate]);

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
  const totalVotes = st ? st.rows.reduce((s, r) => s + r.votes, 0) : 0;
  const eligible = st && st.myVol >= MIN_VOL_USD;
  const votedFor = st?.myChoice ? st.tokens.find((x) => x.token.toLowerCase() === st.myChoice) : null;

  return (
    <>
      <div className="page-title">{t("Голосование")}</div>
      <div className="page-sub" style={{ maxWidth: 760 }}>
        {t("Раз в неделю казна выкупает токен-победитель голосования с рынка и сжигает купленное — памп цены и дефляция для всех держателей. Один кошелёк — один голос. Голосовать могут те, кто наторговал от $500 на любой монете hood.")}
      </div>

      {error && <div className="error">{error}</div>}
      {!st && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {st && (<>
        <div className="vote-bar" style={{ marginTop: 16 }}>
          <div className="vb-cell"><span>{t("Раунд")}</span><b>#{String(st.epoch)}</b></div>
          <div className="vb-cell"><span>{t("До выкупа")}</span><b className="ab-timer">{cd(st.endsIn)}</b></div>
          <div className="vb-cell"><span>{t("Всего голосов")}</span><b>{totalVotes}</b></div>
          <div className="vb-cell">
            <span>{t("Мой голос")}</span>
            <b>{votedFor ? `$${votedFor.symbol}` : wallet ? t("ещё не отдан") : "—"}</b>
          </div>
        </div>

        {wallet && !eligible && !votedFor && (
          <div className="cushion-banner" style={{ marginTop: 12, display: "block" }}>
            ⚡ {t("Право голоса — от")} <b>${MIN_VOL_USD}</b> {t("объёма торгов на любой монете hood.")}{" "}
            {t("Твой объём:")} <b>{st.myVol >= 1000 ? usd(st.myVol) : "$" + st.myVol.toFixed(2)}</b> ({fmt(Math.min((st.myVol / MIN_VOL_USD) * 100, 100), 0)}%)
            <span className="vr-bar" style={{ display: "block", marginTop: 8, maxWidth: 340 }}>
              <span style={{ width: `${Math.max(Math.min((st.myVol / MIN_VOL_USD) * 100, 100), 2)}%` }} />
            </span>
          </div>
        )}

        <div className="bottom-card" style={{ marginTop: 16 }}>
          <div className="bt-tabs"><div className="bt-tab on">🗳 {t("Раунд выкупа")}</div></div>
          {st.rows.map((tk) => {
            const share = totalVotes > 0 ? (tk.votes / totalVotes) * 100 : 0;
            const isMy = votedFor && votedFor.token === tk.token;
            return (
              <div className="vote-row" key={tk.token}>
                <a href={`#/token/${tk.token}`} className="vr-id">
                  {tk.meta.image ? <img src={tk.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
                  <b>${tk.symbol}</b>
                  {isMy && <span className="badge hr-badge">{t("мой голос")}</span>}
                </a>
                <span className="vr-bar"><span style={{ width: `${Math.max(share, tk.votes > 0 ? 4 : 0)}%` }} /></span>
                <span className="vr-val">{tk.votes} {tk.votes === 1 ? t("голос") : t("голосов")} <span className="dim">({fmt(share, 0)}%)</span></span>
                <button className="btn" disabled={!!votedFor || busy === tk.token || (wallet && !eligible)}
                        onClick={() => doVote(tk.token)}
                        title={votedFor ? t("Голос в этом раунде уже отдан")
                          : wallet && !eligible ? t("Недостаточно объёма торгов для голоса") : ""}>
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
