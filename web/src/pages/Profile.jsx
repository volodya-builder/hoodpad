import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { tokenAbi, poolAbi } from "../lib/abi.js";
import { EXPLORER } from "../lib/config.js";
import { loadTokens, poolTrades, subgraphUserTrades, timeAgo, useClock } from "../lib/data.js";
import { currentPosition } from "../lib/position.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

// Память профиля по адресу: мгновенно при переключении вкладок и после перезагрузки.
const _profCache = {}; // account -> state (в памяти сессии)
const PROF_LS = "hood_cache_profile_v1";
const _bigR = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v);
const _bigV = (k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v);
try {
  const s = localStorage.getItem(PROF_LS);
  if (s) Object.assign(_profCache, JSON.parse(s, _bigV));
} catch (e) { /* ignore */ }

export default function Profile({ wallet, onConnect }) {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(30000); // «Nч назад» в позициях обновляется само
  const acc = wallet?.account?.toLowerCase();
  const [state, setState] = useState(() => (acc ? _profCache[acc] ?? null : null));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState("");
  const [reload, setReload] = useState(0);
  // сортировки таблиц: запуски / позиции / сделки
  const [lsort, setLsort] = useState({ key: null, dir: -1 });
  const [psort, setPsort] = useState({ key: null, dir: -1 });
  const [trsort, setTrsort] = useState({ key: null, dir: -1 });
  const [lq, setLq] = useState("");           // поиск по позициям
  const [lq2, setLq2] = useState("");         // поиск по запускам
  const [posTab, setPosTab] = useState("pos"); // «Мои позиции» | «История сделок»
  const [caCopied, setCaCopied] = useState(""); // какой адрес только что скопирован

  const copyCA = (addr) => {
    try { navigator.clipboard.writeText(addr); } catch (e) { /* ignore */ }
    setCaCopied(addr);
    setTimeout(() => setCaCopied(""), 1200);
  };

  const SortH = ({ sort, setSort, k, label }) => (
    <span
      className={`sort-h ${sort.key === k ? "on" : ""}`}
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}
      title={t("Сортировать")}
    >
      {label} <i>{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</i>
    </span>
  );

  const sortRows = (rows, sort, valFn) => {
    if (!sort.key) return rows;
    return [...rows].sort((a, b) => (valFn(b, sort.key) - valFn(a, sort.key)) * -sort.dir);
  };

  // ETH → "(~$X)" рядом с каждой суммой
  const dollars = (e) => {
    const v = e * rate;
    const a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    const s = v < 0 ? "-" : "";
    if (a >= 1e3) return s + usd(a);
    return s + "$" + a.toFixed(2);
  };
  const U = (e) => <span className="usd-sub">({dollars(e)})</span>;
  // крупные количества токенов — компактно: 13.8M, 2.38M, 954K
  const compactN = (n) =>
    n >= 1e9 ? fmt(n / 1e9, 2) + "B"
    : n >= 1e6 ? fmt(n / 1e6, 2) + "M"
    : n >= 1e3 ? fmt(n / 1e3, 1) + "K"
    : fmt(n, 0);

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    // показываем кэш этого адреса сразу, обновляем в фоне
    if (_profCache[acc]) setState(_profCache[acc]);
    (async () => {
      const me = wallet.account.toLowerCase();
      const [tokens, ethBal] = await Promise.all([
        loadTokens(),
        publicClient.getBalance({ address: wallet.account }).catch(() => 0n),
      ]);

      // Масштабируемый путь: ВСЕ мои сделки — одним запросом к индексатору,
      // RPC дёргаем только по токенам, которые я реально трогал или создал.
      let myByPool = null;
      try {
        const mineAll = await subgraphUserTrades(me);
        myByPool = {};
        for (const tr of mineAll) (myByPool[tr.pool] ??= []).push({ ...tr, addr: wallet.account });
      } catch (e) { /* индексатор недоступен — фолбэк ниже */ }

      const candidates = myByPool
        ? tokens.filter((tk) => myByPool[(tk.pool || "").toLowerCase()]
            || (tk.creator || "").toLowerCase() === me)
        : tokens; // фолбэк: старый полный обход (редкий случай)

      // грузим токены пачками, чтобы не завалить RPC десятками запросов сразу
      const CHUNK = 5;
      const enriched = [];
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const part = await Promise.all(candidates.slice(i, i + CHUNK).map(async (tk) => {
          const poolKey = (tk.pool || "").toLowerCase();
          const [bal, mine, creatorRpc, feesAccrued] = await Promise.all([
            publicClient.readContract({
              address: tk.token, abi: tokenAbi, functionName: "balanceOf", args: [wallet.account],
            }).catch(() => 0n),
            myByPool
              ? Promise.resolve(myByPool[poolKey] || [])
              : poolTrades(tk.pool).then((h) => h.trades.filter((tr) => tr.addr.toLowerCase() === me)).catch(() => []),
            // creator из субграфа, если есть — экономим RPC-вызов
            tk.creator ? Promise.resolve(tk.creator)
              : publicClient.readContract({ address: tk.pool, abi: poolAbi, functionName: "creator" }).catch(() => null),
            publicClient.readContract({ address: tk.pool, abi: poolAbi, functionName: "creatorFeesAccrued" }).catch(() => 0n),
          ]);
          // счётчики позиции — только ТЕКУЩИЙ цикл (после последнего обнуления баланса)
          const cur = currentPosition(mine);
          const invested = cur.filter((x) => x.side === "buy").reduce((s, x) => s + x.eth + x.fee, 0);
          const realized = cur.filter((x) => x.side === "sell").reduce((s, x) => s + x.eth, 0);
          return {
            ...tk, bal, mine: cur, mineAll: mine, invested, realized,
            isMine: creatorRpc && creatorRpc.toLowerCase() === me,
            feesAccrued,
          };
        }));
        enriched.push(...part);
        if (!alive) return;
      }
      if (!alive) return;
      // позиция активна, только если на балансе больше «пыли» (>=1 токена);
      // закрытые (всё продано) в списке не висят
      const positions = enriched.filter((tk) => Number(formatEther(tk.bal)) >= 1);
      const launched = enriched.filter((tk) => tk.isMine);
      // итоги (Общий PnL / Вложено / Реализовано) — по ВСЕЙ истории,
      // чтобы общий PnL не терял реализованную прибыль закрытых циклов
      let totVal = 0, totInv = 0, totReal = 0;
      enriched.forEach((tk) => {
        const all = tk.mineAll || tk.mine;
        if (all.length === 0 && tk.bal === 0n) return;
        totVal += Number(formatEther(tk.bal)) * Number(formatEther(tk.price));
        totInv += all.filter((x) => x.side === "buy").reduce((s, x) => s + x.eth + x.fee, 0);
        totReal += all.filter((x) => x.side === "sell").reduce((s, x) => s + x.eth, 0);
      });
      const next = {
        ethBal, positions, launched,
        totVal, totInv, totReal, totPnl: totVal + totReal - totInv,
        tradesCount: enriched.reduce((s, tk) => s + (tk.mineAll || tk.mine).length, 0),
        myTrades: enriched.flatMap((tk) => (tk.mineAll || tk.mine).map((tr) => ({ ...tr, sym: tk.symbol, token: tk.token, img: tk.meta?.image || "" })))
          .sort((a, b) => Number(b.block - a.block)).slice(0, 50),
      };
      _profCache[me] = next;
      // в localStorage кладём облегчённую версию (без тяжёлых картинок), чтобы влезло
      try {
        const strip = (arr) => arr.map(({ meta, mine, ...r }) => ({ ...r, meta: {} }));
        const lite = { ...next, positions: strip(positions), launched: strip(launched),
                       myTrades: next.myTrades.map(({ img, ...r }) => r) }; // без картинок — берегём localStorage
        localStorage.setItem(PROF_LS, JSON.stringify({ [me]: lite }, _bigR));
      } catch (e) { /* переполнение localStorage — не страшно, память сессии остаётся */ }
      setState(next);
    })().catch((e) => { if (alive && !_profCache[acc]) setError(e.shortMessage || e.message); });
    return () => { alive = false; };
  }, [wallet, reload, acc]);

  async function copyAddr() {
    try {
      await navigator.clipboard.writeText(wallet.account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* clipboard unavailable */ }
  }

  async function claim(tk) {
    setError("");
    setClaiming(tk.token);
    try {
      const hash = await wallet.walletClient.writeContract({
        address: tk.pool, abi: poolAbi, functionName: "claimCreatorFees", args: [wallet.account],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setReload((x) => x + 1);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setClaiming(""); }
  }

  // Забрать комиссии со всех токенов сразу (по транзакции на пул)
  async function claimAll() {
    setError("");
    setClaiming("__all__");
    try {
      const withFees = state.launched.filter((tk) => tk.feesAccrued > 0n);
      for (const tk of withFees) {
        const hash = await wallet.walletClient.writeContract({
          address: tk.pool, abi: poolAbi, functionName: "claimCreatorFees", args: [wallet.account],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setReload((x) => x + 1);
    } catch (e) {
      setError(e.shortMessage || e.message);
    } finally { setClaiming(""); }
  }

  if (!wallet) {
    return (
      <div className="center" style={{ paddingTop: 80 }}>
        {t("Подключите кошелёк, чтобы увидеть профиль.")}{" "}
        <a style={{ color: "var(--gold)", cursor: "pointer" }} onClick={onConnect}>{t("Подключить →")}</a>
      </div>
    );
  }

  return (
    <>
      <div className="pf-head">
        <div className="pf-ava">🏹</div>
        <div>
          <div className="page-title" style={{ margin: 0 }}>{t("Профиль")}</div>
          <div className="dim mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {short(wallet.account)}
            <button className="mini-btn" onClick={copyAddr} title={t("Скопировать адрес")}>
              {copied ? "✓" : "⧉"}
            </button>
            <a className="mini-btn" href={`${EXPLORER}/address/${wallet.account}`} target="_blank" rel="noreferrer"
               title={t("Открыть в эксплорере")}>↗</a>
            <span>
              · {t("баланс")} {state ? <>{fmtEth(Number(formatEther(state.ethBal)))} ETH {U(Number(formatEther(state.ethBal)))}</> : "…"}
            </span>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!state && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {state && (
        <>
          <div className="ana-grid" style={{ margin: "34px 0 8px" }}>
            <div className="ana-card pf-stat">
              <div className="k">{t("Общий PnL")}</div>
              <div className="pf-usd" style={{ color: state.totPnl >= 0 ? "var(--leaf)" : "var(--red)" }}>
                {state.totPnl >= 0 ? "+" : ""}{dollars(state.totPnl)}
                {state.totInv > 0 && (
                  <span className="pf-pct">
                    {state.totPnl >= 0 ? "+" : ""}{fmt((state.totPnl / state.totInv) * 100, 1)}%
                  </span>
                )}
              </div>
              <div className="s">{fmtEth(state.totPnl)} ETH · {state.tradesCount} {t("сделок")}</div>
            </div>
            <div className="ana-card pf-stat">
              <div className="k">{t("Стоимость позиций")}</div>
              <div className="pf-usd">{dollars(state.totVal)}</div>
              <div className="s">{fmtEth(state.totVal)} ETH · {state.positions.length} {t("позиций")}</div>
            </div>
            <div className="ana-card pf-stat">
              <div className="k">{t("Вложено")}</div>
              <div className="pf-usd">{dollars(state.totInv)}</div>
              <div className="s">{fmtEth(state.totInv)} ETH</div>
            </div>
            <div className="ana-card pf-stat">
              <div className="k">{t("Реализовано")}</div>
              <div className="pf-usd">{dollars(state.totReal)}</div>
              <div className="s">{fmtEth(state.totReal)} ETH</div>
            </div>
          </div>

          <div className="bottom-card" style={{ marginTop: 18 }}>
            <div className="bt-tabs" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <input
                className="tbl-search"
                value={lq}
                onChange={(e) => setLq(e.target.value)}
                placeholder={t("Поиск: тикер или адрес…")}
                spellCheck={false}
              />
              <div className={`bt-tab ${posTab === "pos" ? "on" : ""}`} onClick={() => setPosTab("pos")}>
                {t("Мои позиции")}
              </div>
              <div className={`bt-tab ${posTab === "hist" ? "on" : ""}`} onClick={() => setPosTab("hist")}>
                {t("История сделок")}
              </div>
            </div>

            {posTab === "hist" && (<>
              {(!state.myTrades || state.myTrades.length === 0) && (
                <div className="center">{t("Сделок пока нет.")}</div>
              )}
              {state.myTrades && state.myTrades.length > 0 && (
                <>
                  <div className="trow phist hdr" style={{ marginTop: 8 }}>
                    <span>{t("Монета")}</span>
                    <SortH sort={trsort} setSort={setTrsort} k="ts" label={t("Время")} />
                    <span>{t("Тип")}</span>
                    <SortH sort={trsort} setSort={setTrsort} k="eth" label="ETH" />
                    <SortH sort={trsort} setSort={setTrsort} k="tokens" label={t("Токены")} />
                    <SortH sort={trsort} setSort={setTrsort} k="block" label={t("Блок")} />
                  </div>
                  {sortRows(state.myTrades.filter((tr) => {
                      const needle = lq.trim().toLowerCase();
                      if (!needle) return true;
                      return tr.sym.toLowerCase().includes(needle) || tr.token.toLowerCase().includes(needle);
                    }), trsort, (tr, k) =>
                      k === "ts" ? (tr.ts || 0)
                      : k === "eth" ? tr.eth
                      : k === "tokens" ? tr.tokens
                      : Number(tr.block))
                    .map((tr, i) => (
                    <div className="trow phist" key={i}>
                      <span className="hist-coin" onClick={() => copyCA(tr.token)}
                            title={t("Скопировать адрес контракта")}>
                        {tr.img
                          ? <img src={tr.img} alt="" />
                          : <span className="ts-ph" style={{ fontSize: 14 }}>🖼️</span>}
                        <a href={`#/token/${tr.token}`} onClick={(e) => e.stopPropagation()}
                           style={{ color: "inherit" }}><b>${tr.sym}</b></a>
                        <span className="mono dim">
                          {caCopied === tr.token ? "✓" : `${tr.token.slice(0, 6)}…${tr.token.slice(-4)} ⧉`}
                        </span>
                      </span>
                      <span className="dim" title={tr.ts ? new Date(tr.ts).toLocaleString() : ""}>
                        {tr.ts ? timeAgo(tr.ts) : "—"}
                      </span>
                      <span className={tr.side === "buy" ? "side-buy" : "side-sell"}>
                        {t(tr.side === "buy" ? "Купил" : "Продал")}
                      </span>
                      <a href={`${EXPLORER}/tx/${tr.tx}`} target="_blank" rel="noreferrer"
                         style={{ color: "inherit" }} title={t("Открыть транзакцию")}>
                        {fmtEth(tr.eth)} ETH <span className="usd-sub">({dollars(tr.eth)})</span>
                      </a>
                      <span>{compactN(tr.tokens)}</span>
                      <a className="dim" href={`${EXPLORER}/block/${tr.block}`} target="_blank" rel="noreferrer"
                         title={t("Открыть блок в эксплорере")}>
                        {String(tr.block)}
                      </a>
                    </div>
                  ))}
                </>
              )}
            </>)}

            {posTab === "pos" && (<>
            {state.positions.length === 0 && <div className="center">{t("Пока нет позиций.")}</div>}
            {sortRows(state.positions.filter((p) => {
              const needle = lq.trim().toLowerCase();
              if (!needle) return true;
              return p.symbol.toLowerCase().includes(needle)
                || p.name.toLowerCase().includes(needle)
                || p.token.toLowerCase().includes(needle);
            }), psort, (p, k) => {
              const val = Number(formatEther(p.bal)) * Number(formatEther(p.price));
              return k === "bal" ? Number(formatEther(p.bal))
                : k === "val" ? val
                : k === "inv" ? p.invested
                : k === "pnl" ? val + p.realized - p.invested
                : Number((p.sold * 10000n) / p.cap);
            }).map((p) => {
              const balTok = Number(formatEther(p.bal));
              const val = Number(formatEther(p.bal)) * Number(formatEther(p.price));
              const buys = p.mine ? p.mine.filter((x) => x.side === "buy") : [];
              const sells = p.mine ? p.mine.filter((x) => x.side === "sell") : [];
              const buysTok = buys.reduce((s, x) => s + x.tokens, 0);
              const sellsTok = sells.reduce((s, x) => s + x.tokens, 0);
              const feesEth = p.mine ? p.mine.reduce((s, x) => s + (x.fee || 0), 0) : 0;
              const avgB = buysTok > 0 ? p.invested / buysTok : 0;
              const uPnl = val - balTok * avgB;
              const uPct = balTok * avgB > 0 ? (uPnl / (balTok * avgB)) * 100 : 0;
              const totPnl = val + p.realized - p.invested;
              const totPct = p.invested > 0 ? (totPnl / p.invested) * 100 : 0;
              const lastTs = p.mine ? p.mine.reduce((s, x) => Math.max(s, x.ts || 0), 0) : 0;
              const firstTs = p.mine ? p.mine.reduce((s, x) => (x.ts ? Math.min(s, x.ts) : s), Infinity) : Infinity;
              const holdMs = firstTs !== Infinity ? Date.now() - firstTs : 0;
              const holdStr = firstTs === Infinity ? "—"
                : holdMs >= 86400000 ? `${Math.floor(holdMs / 86400000)}${t("д")}`
                : holdMs >= 3600000 ? `${Math.floor(holdMs / 3600000)}${t("ч")}`
                : `${Math.max(1, Math.floor(holdMs / 60000))}${t("м")}`;
              const pnlCol = (v) => ({ color: v >= 0 ? "var(--leaf)" : "var(--red)" });
              return (
                <div className="pos-row" key={p.token}
                     onClick={() => { window.location.hash = `#/token/${p.token}`; window.scrollTo({ top: 0, behavior: "smooth" }); }}
                     title={`${p.symbol} — ${t("Открыть страницу токена")}`}>
                  <span className="pos-id tk-cell">
                    <span>{t("Токен / Активность")}</span>
                    <span className="pos-id-body">
                      {p.meta.image && <img src={p.meta.image} alt="" style={{ width: 28, height: 28, borderRadius: 9 }} />}
                      <span>
                        <b className="ticker" style={{ fontSize: 13 }}>${p.symbol}</b>
                        <span className="pos-sub">
                          {lastTs ? timeAgo(lastTs) : "—"}
                        </span>
                      </span>
                    </span>
                  </span>
                  <div className="tk-cell"><span>{t("Куплено")}</span>
                    <b>{dollars(p.invested)}</b><span>{compactN(buysTok)}</span></div>
                  <div className="tk-cell"><span>{t("Продано")}</span>
                    <b>{dollars(p.realized)}</b><span>{sellsTok > 0 ? compactN(sellsTok) : "—"}</span></div>
                  <div className="tk-cell"><span>{t("Баланс")}</span>
                    <b>{dollars(val)}</b><span>{compactN(balTok)}</span></div>
                  <div className="tk-cell"><span>uPnL</span>
                    <b style={pnlCol(uPnl)}>{dollars(uPnl)} ({uPct >= 0 ? "+" : ""}{fmt(uPct, 1)}%)</b></div>
                  <div className="tk-cell"><span>{t("Прибыль")}</span>
                    <b style={pnlCol(totPnl)}>{dollars(totPnl)} ({totPct >= 0 ? "+" : ""}{fmt(totPct, 1)}%)</b></div>
                  <div className="tk-cell"><span>{t("Комиссии")}</span><b>{dollars(feesEth)}</b></div>
                </div>
              );
            })}
            </>)}
          </div>

          {state.launched.length > 0 && (
            <div className="bottom-card" style={{ marginTop: 18 }}>
              <div className="bt-tabs" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <input
                  className="tbl-search"
                  value={lq2}
                  onChange={(e) => setLq2(e.target.value)}
                  placeholder={t("Поиск: тикер или адрес…")}
                  spellCheck={false}
                />
                <div className="bt-tab on">{t("Мои запуски")}</div>
                {(() => {
                  const claimable = state.launched.reduce((s2, tk) => s2 + Number(formatEther(tk.feesAccrued)), 0);
                  return (
                    <button className="btn btn-primary" style={{ marginLeft: "auto" }}
                            disabled={claimable <= 0 || claiming === "__all__"}
                            onClick={claimAll}
                            title={t("Заберёт комиссии со всех токенов — по одной транзакции на каждый")}>
                      {claiming === "__all__" ? "…" : <>{t("Забрать все")} · {fmtEth(claimable)} ETH {U(claimable)}</>}
                    </button>
                  );
                })()}
              </div>
              <div className="prow6 hdr" style={{ gridTemplateColumns: "1.6fr 1fr 1fr 1.4fr 120px" }}>
                <span>{t("Токен")}</span>
                <SortH sort={lsort} setSort={setLsort} k="mcap" label={t("Капитализация")} />
                <SortH sort={lsort} setSort={setLsort} k="curve" label={t("Кривая")} />
                <SortH sort={lsort} setSort={setLsort} k="fees" label={t("Комиссии к выплате")} />
                <span></span>
              </div>
              {sortRows(
                state.launched.filter((tk) => {
                  const needle = lq2.trim().toLowerCase();
                  if (!needle) return true;
                  return tk.symbol.toLowerCase().includes(needle)
                    || tk.name.toLowerCase().includes(needle)
                    || tk.token.toLowerCase().includes(needle);
                }),
                lsort,
                (tk, k) =>
                  k === "mcap" ? Number(tk.price)
                  : k === "curve" ? Number((tk.sold * 10000n) / tk.cap)
                  : Number(tk.feesAccrued)
              ).map((tk) => {
                const mcapEth = Number(formatEther(tk.price)) * 1e9;
                const prog = Number((tk.sold * 10000n) / tk.cap) / 100;
                const fees = Number(formatEther(tk.feesAccrued));
                return (
                  <div className="prow6" key={tk.token} style={{ gridTemplateColumns: "1.6fr 1fr 1fr 1.4fr 120px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <a href={`#/token/${tk.token}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {tk.meta.image && <img src={tk.meta.image} style={{ width: 26, height: 26, borderRadius: 7 }} alt="" />}
                        <b>{tk.symbol}</b>
                      </a>
                      <span className="mono addr-copy" style={{ fontSize: 11.5 }}
                            title={t("Скопировать адрес")}
                            onClick={(e) => { e.preventDefault(); copyCA(tk.token); }}>
                        {short(tk.token)} {caCopied === tk.token ? "✓" : "⧉"}
                      </span>
                    </span>
                    <span>{usd(mcapEth * rate)}</span>
                    <span className="dim">{tk.graduated ? "🎯" : fmt(prog, 0) + "%"}</span>
                    <span style={{ color: fees > 0 ? "var(--leaf)" : "inherit" }}>
                      {fmtEth(fees)} ETH {U(fees)}
                    </span>
                    <span>
                      <button className="btn" disabled={fees <= 0 || claiming === tk.token}
                              onClick={() => claim(tk)}>
                        {claiming === tk.token ? "…" : t("Забрать")}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

        </>
      )}
    </>
  );
}
