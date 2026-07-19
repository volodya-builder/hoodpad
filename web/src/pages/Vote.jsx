import React, { useEffect, useState, useCallback, useMemo } from "react";
import { parseAbi, parseAbiItem } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { VOTE_ADDRESS, EXPLORER } from "../lib/config.js";
import { loadTokens, timeAgo, subgraphVotes, useClock } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

const voteAbi = parseAbi([
  "function vote(address token)",
]);
const voteEvent = parseAbiItem(
  "event Vote(address indexed token, address indexed voter, uint256 indexed epoch)"
);

const EPOCH_LEN = 7 * 86400; // как в контракте: block.timestamp / 7 days

function countdown(sec) {
  let en = false;
  try { en = localStorage.getItem("hood_lang") === "en"; } catch (e) { /* ignore */ }
  const [D, H, M] = en ? ["d", "h", "m"] : ["д", "ч", "м"];
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}${D} ${h}${H} ${m}${M}`;
  if (h > 0) return `${h}${H} ${m}${M}`;
  return `${m}${M}`;
}

// Память вкладки между заходами: повторное открытие — мгновенное.
// Плюс сохраняем в localStorage, чтобы и после перезагрузки не было "Reading the chain".
let _voteState = null;
const VOTE_LS = "hood_cache_vote_v1";
try {
  const raw = localStorage.getItem(VOTE_LS);
  if (raw) _voteState = JSON.parse(raw);
} catch (e) { /* ignore */ }

export default function Vote({ wallet, onConnect }) {
  const { t } = useLang();
  useClock(5000);
  const [state, setState] = useState(_voteState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [q, setQ] = useState("");
  const [ftoken, setFtoken] = useState("all");

  const enabled = VOTE_ADDRESS !== "0x0000000000000000000000000000000000000000";

  const load = useCallback(async () => {
    if (!enabled) return;
    // Эпоха и таймер считаются локально — ровно та же формула, что в контракте
    const nowSec = Math.floor(Date.now() / 1000);
    const ep = BigInt(Math.floor(nowSec / EPOCH_LEN));
    const endsIn = EPOCH_LEN - (nowSec % EPOCH_LEN);

    const tokens = await loadTokens();

    let votes;
    try {
      votes = await subgraphVotes(ep); // индексатор: один быстрый запрос (с повторами внутри)
    } catch (e) {
      // Запасной путь: события из блокчейна, но БЕЗ сканирования от нулевого блока
      // (это убивало публичный RPC). Смотрим только последние ~1.2 млн блоков —
      // раунд длится 7 дней, этого с запасом хватает.
      let latest;
      try { latest = await publicClient.getBlockNumber(); } catch (e0) { latest = null; }
      if (latest === null) {
        // RPC тоже недоступен — оставляем то, что уже показано, не роняем страницу
        if (_voteState) return;
        votes = [];
      } else {
        const LOOKBACK = 1_200_000n;
        const fromB = latest > LOOKBACK ? latest - LOOKBACK : 0n;
        const logs = await publicClient.getLogs({
          address: VOTE_ADDRESS, event: voteEvent, args: { epoch: ep },
          fromBlock: fromB, toBlock: "latest",
        });
        votes = logs.map((l) => ({
          voter: l.args.voter, token: l.args.token.toLowerCase(),
          block: Number(l.blockNumber), ts: null,
        }));
        if (votes.length > 0) {
          try {
            const minB = Math.min(...votes.map((v) => v.block));
            const [lb, oldest] = await Promise.all([
              publicClient.getBlock(),
              publicClient.getBlock({ blockNumber: BigInt(minB) }),
            ]);
            const span = Number(lb.number) - minB;
            const avg = span > 0 ? (Number(lb.timestamp) - Number(oldest.timestamp)) / span : 0;
            for (const v of votes) {
              v.ts = (Number(oldest.timestamp) + (v.block - minB) * avg) * 1000;
            }
          } catch (e2) { /* останутся номера блоков */ }
        }
        votes.sort((a, b) => b.block - a.block);
      }
    }

    const tally = {};
    for (const v of votes) tally[v.token] = (tally[v.token] ?? 0) + 1;

    const symByAddr = {};
    for (const tk of tokens) symByAddr[tk.token.toLowerCase()] = tk.symbol;

    const rows = tokens
      .filter((tk) => !tk.graduated)
      .map((tk) => ({ ...tk, votes: tally[tk.token.toLowerCase()] ?? 0 }))
      .sort((a, b) => b.votes - a.votes);

    const next = { rows, votes, symByAddr, total: votes.length, endsIn, ep: ep.toString() };
    _voteState = next;
    try { localStorage.setItem(VOTE_LS, JSON.stringify(next)); } catch (e) { /* ignore */ }
    setState(next);
  }, [enabled]);

  useEffect(() => {
    // Ошибку показываем ТОЛЬКО если совсем нечего показать. Есть кэш — молча повторим.
    load().catch((e) => { if (!_voteState) setError(e.shortMessage || e.message); });
    const id = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(id);
  }, [load]);

  const myVote = useMemo(() => {
    if (!wallet || !state) return null;
    const mine = state.votes.find(
      (v) => v.voter.toLowerCase() === wallet.account.toLowerCase()
    );
    return mine ? mine.token : null;
  }, [state, wallet]);

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
      setTimeout(() => load().catch(() => {}), 3000); // индексатор догоняет за секунды
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setBusy(false); }
  }

  const filteredVotes = useMemo(() => {
    if (!state) return [];
    const needle = q.trim().toLowerCase();
    return state.votes.filter((v) => {
      if (ftoken !== "all" && v.token !== ftoken) return false;
      if (!needle) return true;
      const sym = (state.symByAddr[v.token] ?? "").toLowerCase();
      return v.voter.toLowerCase().includes(needle) || sym.includes(needle);
    });
  }, [state, q, ftoken]);

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
            <div className="v">{countdown(EPOCH_LEN - (Math.floor(Date.now() / 1000) % EPOCH_LEN))}</div>
          </div>
          {myVote && (
            <div className="about-stat">
              <div className="k">{t("Ваш голос")}</div>
              <div className="v" style={{ fontSize: 18 }}>
                {state.rows.find((r) => r.token.toLowerCase() === myVote)?.symbol ?? short(myVote)} ✓
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
        <div className="vote-layout">
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="vote-hint">{t("Нажмите на строку, чтобы увидеть, кто голосовал.")}</div>
            {state.rows.map((r, i) => {
              const addr = r.token.toLowerCase();
              const sharePct = state.total > 0 ? (r.votes / state.total) * 100 : 0;
              const isMine = myVote === addr;
              const isOpen = expanded === addr;
              const voters = isOpen ? state.votes.filter((v) => v.token === addr) : [];
              const rank = i < 3 && state.total > 0 ? i + 1 : 0;
              return (
                <React.Fragment key={r.token}>
                  <div className="prow6 vote-row"
                       style={{ gridTemplateColumns: "40px 1.6fr 2fr 90px 130px", cursor: "pointer" }}
                       onClick={() => setExpanded(isOpen ? null : addr)}>
                    <span className={rank ? `rank-num rk${rank}` : "dim"}>{i + 1}</span>
                    <a href={`#/token/${r.token}`} onClick={(e) => e.stopPropagation()}
                       style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      {r.meta.image && (
                        <img src={r.meta.image} className={`vote-ava${rank ? ` r${rank}` : ""}`} alt="" />
                      )}
                      <span>
                        <b>{r.symbol}</b>{" "}
                        <span className="dim" style={{ fontSize: 12 }}>{r.name}</span>
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
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.votes} <span className={`chev-mini ${isOpen ? "open" : ""}`}>▾</span>
                    </b>
                    {isMine ? (
                      <span className="badge">{t("ваш голос")}</span>
                    ) : (
                      <button className="btn" disabled={busy || !!myVote}
                              onClick={(e) => { e.stopPropagation(); castVote(r.token); }}
                              title={myVote ? t("Вы уже голосовали в этом раунде") : ""}>
                        {t("Голосовать")}
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="vote-voters">
                      {voters.length === 0 && (
                        <div className="dim">{t("Пока никто не голосовал за этот токен.")}</div>
                      )}
                      {voters.map((v, k) => (
                        <div className="vv-row" key={k}>
                          <span>🏹</span>
                          <a className="mono" href={`${EXPLORER}/address/${v.voter}`}
                             target="_blank" rel="noreferrer"
                             onClick={(e) => e.stopPropagation()}>
                            {short(v.voter)}
                          </a>
                          <span className="when">{v.ts ? timeAgo(v.ts) : `#${v.block}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <aside className="wallet-panel">
            <h3>{t("Кошельки раунда")} <span className="chat-count">{filteredVotes.length}</span></h3>
            <div className="wp-filters">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("Поиск: адрес или тикер…")}
                spellCheck={false}
              />
              <select value={ftoken} onChange={(e) => setFtoken(e.target.value)}>
                <option value="all">{t("Все токены")}</option>
                {state.rows.map((r) => (
                  <option key={r.token} value={r.token.toLowerCase()}>
                    ${r.symbol} · {r.votes}
                  </option>
                ))}
              </select>
            </div>
            <div className="wp-list">
              {filteredVotes.length === 0 && <div className="dim">{t("Ничего не найдено")}</div>}
              {filteredVotes.map((v, k) => (
                <a className="wp-item" key={k}
                   href={`${EXPLORER}/address/${v.voter}`} target="_blank" rel="noreferrer">
                  <span>🏹</span>
                  <span className="mono">{short(v.voter)}</span>
                  <span className="sym">${state.symByAddr[v.token] ?? short(v.token)}</span>
                  <span className="when">{v.ts ? timeAgo(v.ts) : ""}</span>
                </a>
              ))}
            </div>
          </aside>
        </div>
      )}

      <div className="ana-note">
        {t("Голос — маленькая транзакция в сети (газ — доли цента). Новый раунд начинается автоматически каждые 7 дней.")}
      </div>
    </>
  );
}
