import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatEther, formatUnits } from "viem";
import { loadTokens, timeAgo } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { short, publicClient } from "../lib/web3.js";
import { AGENT_TREASURY_ADDRESS, FEE_SPLITTER_ADDRESS, SPLITTER_LIVE } from "../lib/config.js";
import { feeSplitterAbi } from "../lib/abi.js";
import { useEthUsd, useQuoteUsd } from "../lib/price.js";
import { modelLogo } from "../lib/models.mjs";
import CoinPicker from "./CoinPicker.jsx";
import CoinHero from "./CoinHero.jsx";
import {
  PROPOSE_MIN, FREE_BUILDS, AGENT_PERIOD_MIN,
  loadBoard, watchBoard, tallyBoard, submitProposal, submitVote,
  proposalMessage, voteMessage, newPid, balanceOf, loadBuilds, nextAgentWake, loadHeartbeat,
} from "../lib/board.js";
import Icon from "./Icon.jsx";

/** Панель «что делает агент»: одно состояние крупно, подпись и кольцо таймера. */
function AgentStatus({ st, wakeIn, period, budgetLabel, budgetTitle, t }) {
  const frac = Math.max(0, Math.min(1, 1 - wakeIn / period));
  const R = 20, C = 2 * Math.PI * R;
  const mm = Math.floor(wakeIn / 60000), ss = Math.floor((wakeIn % 60000) / 1000);
  return (
    <div className={`ag ag-${st.kind}`}>
      <div className="ag-ico">
        {st.kind === "building" && <span className="ag-spin" />}
        {st.kind === "queued" && (
          <svg viewBox="0 0 48 48" width="48" height="48" className="ag-ring">
            <circle cx="24" cy="24" r={R} className="ag-ring-bg" />
            <circle cx="24" cy="24" r={R} className="ag-ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
          </svg>
        )}
        {st.kind === "idle" && <span className="ag-dot" />}
        {st.kind === "paused" && <Icon name="pause" size={20} style={{ margin: 0 }} />}
        {st.kind === "failed" && <Icon name="alert" size={20} style={{ margin: 0 }} />}
        {st.kind === "queued" && <span className="ag-time">{wakeIn > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : "…"}</span>}
      </div>
      <div className="ag-body">
        <div className="ag-title">{st.title}</div>
        <div className="ag-sub">{st.sub}</div>
        {st.note && <div className="ag-note">{st.note}</div>}
      </div>
      <div className="ag-foot"><span className="board-budget ag-budget" title={budgetTitle}>{budgetLabel}</span></div>
    </div>
  );
}

/** Доска идей монеты + что построено. token — зафиксировать монету
 *  (страница монеты); без него — выбор монеты сверху (вкладка «ИИ»). */
export default function Board({ token: fixed, wallet, onConnect, embedded = false }) {
  const { t } = useLang();
  const [tokens, setTokens] = useState(null);
  const [sel, setSel] = useState(fixed || "");
  const [board, setBoard] = useState(null);
  const [tally, setTally] = useState(null);
  const [builds, setBuilds] = useState([]);
  const [bal, setBal] = useState(0n);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [aiOn, setAiOn] = useState(null);
  const [budget, setBudget] = useState(null); // { eth, erc20, sym, dec }
  const [hb, setHb] = useState(null); // пульс агента из CI
  const ethRate = useEthUsd();
  const tk = useMemo(() => (tokens || []).find((x) => x.token.toLowerCase() === (sel || "").toLowerCase()) || null, [tokens, sel]);
  const quoteRate = useQuoteUsd(tk?.q?.addr);

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  // монеты — для выбора и для картинок/символов. У кого ИИ включён — те
  // первыми и с пометкой: агент работает только на них.
  useEffect(() => {
    let alive = true;
    loadTokens().then(async (list) => {
      let arr = list || [];
      if (SPLITTER_LIVE && arr.length) {
        const flags = await Promise.all(arr.map((x) =>
          publicClient.readContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "aiOf", args: [x.token] }).catch(() => false)));
        arr = arr.map((x, i) => ({ ...x, aiOn: Boolean(flags[i]) }));
        arr = [...arr.filter((x) => x.aiOn), ...arr.filter((x) => !x.aiOn)];
      }
      if (!alive) return;
      setTokens(arr);
      if (!fixed && arr.length && !sel) setSel(arr[0].token);
    }).catch(() => { if (alive) setTokens([]); });
    return () => { alive = false; };
  }, [fixed]); // eslint-disable-line

  // доска: первая загрузка + живой поток + запасной опрос
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    setBoard(null); setTally(null);
    loadBoard(sel).then((b) => { if (alive) setBoard(b); }).catch(() => { if (alive) setBoard({ proposals: [], votes: {}, building: null }); });
    const stop = watchBoard(sel, (b) => { if (alive) setBoard(b); });
    const poll = setInterval(() => { loadBoard(sel).then((b) => { if (alive) setBoard(b); }).catch(() => {}); }, 10_000);
    return () => { alive = false; stop(); clearInterval(poll); };
  }, [sel]);

  // пульс агента — раз в 15 с
  useEffect(() => {
    let alive = true;
    const go = () => loadHeartbeat().then((h) => { if (alive) setHb(h); });
    go(); const i = setInterval(go, 15_000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  // построенное — из builds.json (обновляется раз в 30 с)
  useEffect(() => {
    let alive = true;
    const go = () => loadBuilds().then((b) => { if (alive) setBuilds(b); }).catch(() => {});
    go(); const i = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  const myBuilds = useMemo(() => builds.filter((b) => String(b.token).toLowerCase() === (sel || "").toLowerCase()).sort((a, b) => (b.at || 0) - (a.at || 0)), [builds, sel]);
  const builtPids = useMemo(() => new Set(myBuilds.map((b) => b.pid).filter(Boolean)), [myBuilds]);

  // подсчёт при каждом изменении доски
  useEffect(() => {
    if (!board || !sel) return;
    let alive = true;
    tallyBoard(sel, board, builtPids).then((r) => { if (alive) setTally(r); }).catch(() => {});
    return () => { alive = false; };
  }, [board, sel, builtPids]);

  // мой баланс, ИИ включён?, бюджет агента
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    if (wallet) balanceOf(sel, wallet.account).then((v) => { if (alive) setBal(v); }); else setBal(0n);
    if (SPLITTER_LIVE) {
      publicClient.readContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "aiOf", args: [sel] })
        .then((v) => { if (alive) setAiOn(Boolean(v)); }).catch(() => { if (alive) setAiOn(null); });
    }
    return () => { alive = false; };
  }, [sel, wallet, board]);

  useEffect(() => {
    if (!sel || !AGENT_TREASURY_ADDRESS) { setBudget(null); return; }
    let alive = true;
    const abi = [
      { name: "budget", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
      { name: "budgetErc20", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
    ];
    (async () => {
      try {
        const q = tk?.q || null;
        const v = q
          ? await publicClient.readContract({ address: AGENT_TREASURY_ADDRESS, abi, functionName: "budgetErc20", args: [sel, q.addr] })
          : await publicClient.readContract({ address: AGENT_TREASURY_ADDRESS, abi, functionName: "budget", args: [sel] });
        if (alive) setBudget({ v, q });
      } catch (e) { if (alive) setBudget(null); }
    })();
    return () => { alive = false; };
  }, [sel, tk?.q?.addr, builds.length]); // eslint-disable-line

  const sign = async (message) => wallet.walletClient.signMessage({ account: wallet.account, message });
  const myVote = wallet && board ? board.votes?.[wallet.account.toLowerCase()] : null;
  const myPid = myVote?.pid || "";
  const canPropose = bal >= PROPOSE_MIN;

  const doPropose = async () => {
    setErr("");
    const txt = text.trim();
    if (!wallet) return onConnect?.();
    if (txt.length < 8) return setErr(t("Опишите идею подробнее."));
    if (!canPropose) return setErr(t("Чтобы предлагать, нужно 0.1% выпуска монеты."));
    setBusy(true);
    try {
      const pid = newPid();
      const signature = await sign(proposalMessage(sel, pid, txt));
      await submitProposal({ token: sel, text: txt, address: wallet.account, signature, pid });
      // сразу голосуем за свою идею — так у неё есть вес с первой секунды
      const vsig = await sign(voteMessage(sel, pid));
      await submitVote({ token: sel, pid, address: wallet.account, signature: vsig });
      setText("");
      setBoard(await loadBoard(sel));
    } catch (e) { setErr(e.shortMessage || e.message); }
    finally { setBusy(false); }
  };

  const doVote = async (pid) => {
    setErr("");
    if (!wallet) return onConnect?.();
    if (bal <= 0n) return setErr(t("Голос весит столько, сколько у вас монеты. Купите хоть немного."));
    setBusy(true);
    try {
      const next = myPid === pid ? "" : pid; // повторный клик — снять голос
      const signature = await sign(voteMessage(sel, next));
      await submitVote({ token: sel, pid: next, address: wallet.account, signature });
      setBoard(await loadBoard(sel));
    } catch (e) { setErr(e.shortMessage || e.message); }
    finally { setBusy(false); }
  };

  // ---- строка статуса агента
  // Отсчёт до следующего захода: по пульсу агента (он знает, когда вернётся),
  // а без свежего пульса — по расписанию cron.
  const hbFresh = !!(hb && hb.at && now - hb.at < 20 * 60000);
  const nextAt = hbFresh && hb.next ? hb.next : nextAgentWake(now);
  const wakeIn = Math.max(0, nextAt - now);
  const mm = Math.floor(wakeIn / 60000), ss = Math.floor((wakeIn % 60000) / 1000);
  const freeLeft = Math.max(0, FREE_BUILDS - myBuilds.length);
  const rate = budget?.q ? quoteRate : ethRate;
  const budgetUsd = budget && rate ? Number(budget.q ? formatUnits(budget.v, budget.q.dec) : formatEther(budget.v)) * rate : null;
  const BUILD_USD = 0.5; // ориентир стоимости одной сборки
  const paidBuilds = budgetUsd !== null ? Math.floor(budgetUsd / BUILD_USD) : null;
  const building = tally?.building || null;
  const buildingProp = building ? tally.list.find((p) => p.pid === building.pid) : null;
  const aiOff = SPLITTER_LIVE && aiOn === false;

  // ---- что делает агент прямо сейчас — одно состояние для панели
  const period = hbFresh && hb.next && hb.next > hb.at ? hb.next - hb.at : AGENT_PERIOD_MIN * 60000;
  const hbMine = hb && hb.token && hb.token.toLowerCase() === (sel || "").toLowerCase() ? hb : null;
  const hbAge = hb?.at ? now - hb.at : null;
  const lastSeen = hbAge === null ? "" : hbAge < 90_000 ? t("только что") : `${Math.round(hbAge / 60000)} ${t("мин назад")}`;
  const hbLate = hbAge !== null && hbAge > 15 * 60000;
  const topIdea = tally?.list?.[0] || null;
  const lastBuild = myBuilds[0] || null;
  const agentSt = (() => {
    const seen = lastSeen ? `${t("агент был на связи")} ${lastSeen}` : t("агент заходит каждые 5 минут");
    const late = hbLate ? ` · ${t("задерживается — GitHub иногда запаздывает")}` : wakeIn === 0 ? ` · ${t("вот-вот зайдёт")}` : "";
    if (aiOff) return { kind: "paused", title: t("На паузе"), sub: t("ИИ у этой монеты не включён — включает создатель на странице монеты.") };
    if (buildingProp || (hbMine && hbMine.state === "building" && hbAge < 20 * 60000 && !builtPids.has(hbMine.pid)))
      return { kind: "building", title: t("Строит"), sub: `«${(buildingProp?.text || hbMine?.text || "").slice(0, 90)}»`, note: hbMine?.model ? `${t("модель")}: ${hbMine.model}` : undefined };
    if (hbMine && hbMine.state === "failed" && hbAge < 30 * 60000 && lastBuild && lastBuild.failed && lastBuild.pid === hbMine.pid)
      return { kind: "failed", title: t("Последняя сборка не удалась"), sub: hbMine.note || t("страница не прошла проверку, идея снята с доски"), note: seen };
    if (!tally || tally.list.length === 0) return { kind: "idle", title: t("Ждёт идей"), sub: t("Доска пуста — агент проснётся, как только появится идея с голосом."), note: seen + late };
    if (!(topIdea.weight > 0n)) return { kind: "idle", title: t("Ждёт голосов"), sub: t("Идеи есть, но ни у одной нет веса — проголосуйте."), note: seen + late };
    if (freeLeft === 0 && paidBuilds !== null && paidBuilds === 0)
      return { kind: "paused", title: t("На паузе — бюджет пуст"), sub: t("Бесплатные сборки кончились; 10% комиссии с каждой сделки пополняют бюджет монеты."), note: seen };
    return { kind: "queued", title: t("В очереди"), sub: `${t("заберёт")} «${String(topIdea.text).slice(0, 70)}» ${t("при следующем заходе")}`, note: seen + late };
  })();

  if (!fixed && tokens === null) return <div className="ai-empty">{t("Загружаю…")}</div>;
  if (!fixed && !tokens.length) return <div className="ai-empty">{t("Пока нет ни одной монеты.")}</div>;

  return (
    <div className={`board ${embedded ? "board-emb" : ""}`}>
      {!fixed && (
        <CoinHero x={tk} aiOn={SPLITTER_LIVE ? aiOn : null}
                  picker={<CoinPicker tokens={tokens} value={sel} onChange={setSel} compact={!!tk} />} />
      )}
      <AgentStatus st={agentSt} wakeIn={wakeIn} period={period} t={t}
        budgetTitle={t("Первые сборки за счёт hood, дальше — на бюджет монеты: 10% комиссии с каждой сделки")}
        budgetLabel={freeLeft > 0
          ? t("{n} сборки бесплатно").replace("{n}", String(freeLeft))
          : paidBuilds !== null
            ? t("бюджет ≈ {n} сборок").replace("{n}", String(paidBuilds))
            : t("бюджет: по комиссиям монеты")} />

      <div className="board-cols">
        <div className="board-main">
          {aiOff ? (
            <div className="ai-empty">
              {t("У этой монеты ИИ не включён: агент на неё не работает, идеи копить некуда. Включить может создатель одной подписью на странице монеты.")}
            </div>
          ) : (
          <div className="board-form">
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 280))} rows={2}
                      placeholder={t("Что построить? Например: игра-кликер с рекордами, страница-мем с генератором подписей, калькулятор…")} />
            <div className="board-form-row">
              <span className="dim">
                {!wallet ? t("подключите кошелёк, чтобы предлагать и голосовать")
                  : canPropose ? t("можно предлагать и голосовать")
                  : bal > 0n ? t("можно голосовать; предлагать — от 0.1% выпуска")
                  : t("нужны монеты этого токена")}
                {" · "}{text.length}/280
              </span>
              <button className="btn btn-primary" disabled={busy} onClick={doPropose}>
                {!wallet ? t("Подключить кошелёк") : busy ? t("…") : t("Предложить")}
              </button>
            </div>
          </div>
          )}
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

          <div className="board-list">
            {tally === null && <div className="center dim" style={{ padding: "18px 0" }}>{t("Читаю доску…")}</div>}
            {tally && tally.list.length === 0 && (
              <div className="ai-empty">{t("Доска пуста. Первая идея — ваша: агент возьмёт верхнюю, как только освободится.")}</div>
            )}
            {tally && tally.list.map((p, i) => {
              const mine = wallet && p.by === wallet.account.toLowerCase();
              const voted = myPid === p.pid;
              const isBuilding = building && building.pid === p.pid;
              return (
                <div className={`board-item ${i === 0 && p.weight > 0n ? "top" : ""} ${voted ? "voted" : ""} ${isBuilding ? "building" : ""}`} key={p.pid}>
                  <div className="board-item-top">
                    <span className="board-rank">{i + 1}</span>
                    <div className="board-text">{p.text}</div>
                    <button className={`btn ${voted ? "btn-primary" : ""} board-vote`} disabled={busy || !!isBuilding} onClick={() => doVote(p.pid)}
                            title={voted ? t("Снять голос") : t("Голосовать")}>
                      {isBuilding ? t("в работе") : voted ? "✓ " + t("мой голос") : t("Голосовать")}
                    </button>
                  </div>
                  <div className="wsh-bar"><span style={{ width: `${p.pct}%` }} /></div>
                  <div className="board-meta">
                    <span>{p.pct.toFixed(1)}% · {p.voters} {t("голос.")}{i === 0 && p.weight > 0n && !isBuilding ? ` · ${t("следующая в работу")}` : ""}</span>
                    <span className="dim">{mine ? t("вы") : short(p.by)} · {timeAgo(p.at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {tally && tally.voters > 0 && (
            <div className="wsh-note">{t("Голосов")}: {tally.voters} · {t("вес — доля в монете, голос можно переставить")}</div>
          )}
        </div>

        <div className="board-side">
          <div className="board-side-h">{t("Построено")} {myBuilds.length ? <span className="dim">· {myBuilds.length}</span> : null}</div>
          {myBuilds.length === 0 && <div className="ai-empty">{t("Пока ничего. Победившая идея появится здесь ссылкой.")}</div>}
          {myBuilds.map((b, i) => (
            <div className={`board-build ${b.failed ? "failed" : ""}`} key={i}>
              <div className="board-build-task">{b.task}</div>
              <div className="board-build-meta">
                {b.failed
                  ? <span className="side-sell" title={b.note || ""}>{t("не вышло")}</span>
                  : b.path
                    // Агент коммитит в staging — там страница есть сразу; на боевом
                    // домене появится, когда владелец выкатит. Ссылка всегда туда, где есть.
                    ? <a href={`${b.path.startsWith("http") ? "" : "/staging/"}${b.path}`} target="_blank" rel="noreferrer">{t("Открыть")} ↗</a>
                    : b.url && <a href={b.url} target="_blank" rel="noreferrer">{t("Открыть")} ↗</a>}
                {b.model && <span className="dim" title={b.model}><img className="q-logo" src={modelLogo(b.model)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />{String(b.model).split("/")[1] || b.model}</span>}
                {typeof b.spent === "number" && <span className="dim">${b.spent.toFixed(2)}</span>}
                {b.at && <span className="dim">{timeAgo(b.at)}</span>}
              </div>
            </div>
          ))}
          <div className="board-facts" title={t("Это зашито в код и не меняется голосованием")}>
            {t("Агент строит одну страницу за раз, не трогает деньги, не даёт финансовых советов и не выходит за свой поддомен.")}
          </div>
        </div>
      </div>
    </div>
  );
}
