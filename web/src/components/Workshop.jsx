import React, { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { loadTokens } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { fmt, short } from "../lib/web3.js";
import {
  roundId, roundEnd, roundPhase, loadRound, submitProposal, submitVote,
  tally, balanceOf, voteMessage, proposeMessage, PROPOSE_MIN,
} from "../lib/workshop.js";

const PHASE_LBL = { propose: "Приём предложений", vote: "Идёт голосование", done: "Раунд закрыт" };

function left(ms) {
  if (ms <= 0) return "0ч";
  const h = Math.floor(ms / 3600000);
  return h >= 24 ? `${Math.floor(h / 24)}д ${h % 24}ч` : `${h}ч`;
}

export default function Workshop({ wallet, onConnect, token: fixed, embedded }) {
  const { t } = useLang();
  const [tokens, setTokens] = useState(null);
  const [sel, setSel] = useState("");
  const [round, setRound] = useState(null);
  const [res, setRes] = useState(null);
  const [bal, setBal] = useState(0n);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());

  const id = roundId(now);
  const phase = roundPhase(id, now);

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (fixed) { setSel(fixed); setTokens([]); return; }
    loadTokens().then((list) => {
      setTokens(list);
      if (list && list.length && !sel) setSel(list[0].token);
    }).catch(() => setTokens([]));
  }, [fixed]); // eslint-disable-line

  const refresh = React.useCallback(async () => {
    if (!sel) return;
    const r = await loadRound(sel, id);
    setRound(r);
    setRes(await tally(sel, id, r.votes));
  }, [sel, id]);

  useEffect(() => { setRound(null); setRes(null); refresh(); }, [refresh]);
  useEffect(() => {
    if (!sel || !wallet) { setBal(0n); return; }
    balanceOf(sel, wallet.account).then(setBal).catch(() => setBal(0n));
  }, [sel, wallet]);

  const token = useMemo(() => (tokens || []).find((x) => x.token === sel), [tokens, sel]);
  const myVote = wallet && round ? round.votes?.[wallet.account.toLowerCase()] : null;
  const canPropose = bal >= PROPOSE_MIN;

  const sign = async (message) => {
    if (!wallet) throw new Error("кошелёк не подключён");
    return wallet.walletClient.signMessage({ account: wallet.account, message });
  };

  const doPropose = async () => {
    setErr(""); const txt = text.trim();
    if (txt.length < 8) { setErr(t("Опишите подробнее — минимум 8 символов.")); return; }
    setBusy(true);
    try {
      const signature = await sign(proposeMessage(sel, id, txt));
      await submitProposal({ token: sel, id, text: txt, address: wallet.account, signature });
      setText(""); await refresh();
    } catch (e) { setErr(String(e.shortMessage || e.message)); }
    finally { setBusy(false); }
  };

  const doVote = async (pid) => {
    setErr(""); setBusy(true);
    try {
      const signature = await sign(voteMessage(sel, id, pid));
      await submitVote({ token: sel, id, pid, address: wallet.account, signature });
      await refresh();
    } catch (e) { setErr(String(e.shortMessage || e.message)); }
    finally { setBusy(false); }
  };

  if (!fixed && tokens === null) return <div className="ai-empty">{t("Загружаю…")}</div>;
  if (!fixed && !tokens.length) return <div className="ai-empty">{t("Пока нет ни одной монеты.")}</div>;

  const total = res?.total ?? 0n;

  return (
    <div className={`wsh ${embedded ? "wsh-emb" : ""}`}>
      <div className="wsh-head">
        {!fixed && (
          <select className="wsh-sel" value={sel} onChange={(e) => setSel(e.target.value)}>
            {(tokens || []).map((x) => (
              <option key={x.token} value={x.token}>{x.name} · ${x.symbol}</option>
            ))}
          </select>
        )}
        <span className={`wsh-phase ${phase}`}>{t(PHASE_LBL[phase])}</span>
        <span className="wsh-left">
          {t("раунд")} #{id} · {t("до конца")} {left(roundEnd(id) - now)}
        </span>
      </div>

      {!wallet && (
        <div className="wsh-connect">
          {t("Подключите кошелёк, чтобы предлагать и голосовать.")}{" "}
          <button className="btn btn-primary" onClick={onConnect}>{t("Подключить кошелёк")}</button>
        </div>
      )}

      {wallet && (
        <div className="wsh-you">
          {t("У вас")} <b>{fmt(Number(formatEther(bal)), 0)}</b>{token ? ` $${token.symbol}` : ""}
          {" · "}
          {canPropose
            ? <span className="wsh-ok">{t("можно предлагать и голосовать")}</span>
            : bal > 0n
              ? <span className="wsh-dim">{t("можно голосовать; для предложений нужно 0.1% выпуска")}</span>
              : <span className="wsh-dim">{t("нужны монеты этого токена")}</span>}
        </div>
      )}

      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

      {phase === "propose" && wallet && canPropose && (
        <div className="wsh-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={280}
            placeholder={t("Что ИИ должен построить для этой монеты? Одно предложение.")}
          />
          <div className="wsh-form-row">
            <span className="dim">{text.length}/280</span>
            <button className="btn btn-primary" disabled={busy} onClick={doPropose}>
              {busy ? t("Подписываю…") : t("Предложить")}
            </button>
          </div>
        </div>
      )}

      <div className="wsh-list">
        {round === null && <div className="center" style={{ padding: "18px 0" }}>{t("Читаю раунд…")}</div>}
        {round !== null && round.proposals.length === 0 && (
          <div className="ai-empty" style={{ marginTop: 14 }}>
            {t("Предложений пока нет. Первое может быть вашим.")}
          </div>
        )}
        {round !== null && round.proposals.map((p) => {
          const w = res?.byProp?.[p.pid] ?? 0n;
          const pct = total > 0n ? Number((w * 1000n) / total) / 10 : 0;
          const mine = myVote?.pid === p.pid;
          return (
            <div className={`wsh-item ${mine ? "mine" : ""}`} key={p.pid}>
              <div className="wsh-item-top">
                <div className="wsh-text">{p.text}</div>
                {phase === "vote" && wallet && bal > 0n && (
                  <button className={`btn ${mine ? "" : "btn-primary"}`} disabled={busy} onClick={() => doVote(p.pid)}>
                    {mine ? t("Ваш голос") : t("Голосовать")}
                  </button>
                )}
              </div>
              <div className="wsh-bar"><span style={{ width: `${pct}%` }} /></div>
              <div className="wsh-meta">
                <span>{pct.toFixed(1)}%</span>
                <span className="dim">{t("предложил")} {short(p.by)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {res && (
        <div className="wsh-note">
          {t("Голосов учтено")}: <b>{res.voters}</b>
          {res.rejected > 0 && <> · {t("отброшено без подписи")}: <b>{res.rejected}</b></>}
          <div className="dim" style={{ marginTop: 6, lineHeight: 1.55 }}>
            {t("Вес голоса — баланс токена, читается из блокчейна при подсчёте. Каждый голос подписан кошельком; строка без верной подписи не считается, поэтому подделать запись можно, а повлиять — нет. Голосование пока вне блокчейна: это v1.")}
          </div>
        </div>
      )}
    </div>
  );
}
