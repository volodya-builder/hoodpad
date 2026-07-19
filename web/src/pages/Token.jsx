import React, { useEffect, useState, useCallback, useMemo } from "react";
import { parseEther, formatEther } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { factoryAbi, poolAbi, tokenAbi, treasuryAbi, poolExtraAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS, TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { poolTrades } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import Chat from "./Chat.jsx";
import { useSplit, loadCreationTimes, timeAgo } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

const SLIPPAGE_CHOICES = [0.5, 1, 3, 5]; // %

function MiniChart({ points, rate }) {
  const [hover, setHover] = React.useState(null);
  const W = 640, H = 240, PADB = 22, PADT = 10, PADL = 6, PADR = 6;

  // Нет сделок — рисуем базовую линию стартовой капитализации
  const pts = (points && points.length >= 2)
    ? points
    : [{ i: 0, mcap: 1.625, ts: null }, { i: 1, mcap: 1.625, ts: null }];
  const empty = !(points && points.length >= 2);

  let mn = Infinity, mx = -Infinity;
  pts.forEach((p) => { mn = Math.min(mn, p.mcap); mx = Math.max(mx, p.mcap); });
  if (mx - mn < mx * 0.02) { mx *= 1.02; mn *= 0.98; }
  const X = (i) => PADL + (i / (pts.length - 1)) * (W - PADL - PADR);
  const Y = (v) => PADT + (1 - (v - mn) / (mx - mn)) * (H - PADT - PADB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.mcap).toFixed(1)}`).join(" ");
  const area = `${line} L${X(pts.length - 1).toFixed(1)} ${H - PADB} L${PADL} ${H - PADB} Z`;
  const last = pts[pts.length - 1];
  const usdV = (m) => usd(m * rate);
  const timeLbl = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const firstTs = pts.find((p) => p.ts)?.ts;
  const lastTs = [...pts].reverse().find((p) => p.ts)?.ts;

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const idx = Math.round(((x - PADL) / (W - PADL - PADR)) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, idx)));
  };

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", marginTop: 8 }}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="tokAreaG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b9c94b" stopOpacity=".25" />
            <stop offset="1" stopColor="#b9c94b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PADL} x2={W - PADR}
                y1={PADT + f * (H - PADT - PADB)} y2={PADT + f * (H - PADT - PADB)}
                stroke="currentColor" strokeOpacity="0.07" strokeDasharray="4 5" />
        ))}
        <path d={area} fill="url(#tokAreaG)" />
        <path d={line} fill="none" stroke="#b9c94b" strokeWidth="2"
              strokeLinejoin="round" strokeDasharray={empty ? "5 6" : "none"} />
        {!empty && (
          <circle cx={X(pts.length - 1)} cy={Y(last.mcap)} r="4" fill="#dcea5c" stroke="#0d0e0c" strokeWidth="2" />
        )}
        {hover !== null && !empty && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={PADT} y2={H - PADB}
                  stroke="currentColor" strokeOpacity="0.25" />
            <circle cx={X(hover)} cy={Y(pts[hover].mcap)} r="4.5"
                    fill="#dcea5c" stroke="#0d0e0c" strokeWidth="2" />
          </g>
        )}
        <text x={PADL} y={PADT + 4} className="chart-axis">{usdV(mx)}</text>
        <text x={PADL} y={H - PADB - 4} className="chart-axis">{usdV(mn)}</text>
        {firstTs && <text x={PADL} y={H - 6} className="chart-axis">{timeLbl(firstTs)}</text>}
        {lastTs && <text x={W - PADR} y={H - 6} className="chart-axis" textAnchor="end">{timeLbl(lastTs)}</text>}
      </svg>
      {hover !== null && !empty && (
        <div className="chart-tip"
             style={{ left: `${(X(hover) / W) * 100}%` }}>
          <b>{usdV(pts[hover].mcap)}</b>
          {pts[hover].ts ? <span> · {timeAgo(pts[hover].ts)}</span> : null}
        </div>
      )}
      {empty && (
        <div className="dim" style={{ position: "absolute", inset: 0, display: "flex",
             alignItems: "center", justifyContent: "center", fontSize: 13, pointerEvents: "none" }}>
          {window.__hoodT ? window.__hoodT("График появится после первых сделок.") : "График появится после первых сделок."}
        </div>
      )}
    </div>
  );
}

export default function TokenPage({ tokenAddress, wallet, onConnect }) {
  const { t } = useLang();
  const rate = useEthUsd();
  const split = useSplit();
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState({});
  const [tab, setTab] = useState("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null); // { trades, points }
  const [extra, setExtra] = useState({});       // creatorFees, treasuryOwner, treasuryHeld, burned
  const [bbAmt, setBbAmt] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCA, setCopiedCA] = useState(false);
  const [tf, setTf] = useState("all"); // таймфрейм графика
  const [tradePct, setTradePct] = useState(0); // ползунок суммы
  const [qpcts, setQpcts] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem("hood_qp") || "null");
      if (Array.isArray(v) && v.length === 4) return v;
    } catch (e) { /* ignore */ }
    return [25, 50, 75, 100];
  });
  const [qpEdit, setQpEdit] = useState(false);
  const [slip, setSlip] = useState(() => {
    try {
      const v = localStorage.getItem("hood_slip");
      if (v === null || v === "auto") return "auto";
      return Number(v) || "auto";
    } catch (e) { return "auto"; }
  });
  const setSlipSave = (s2) => {
    setSlip(s2);
    try { localStorage.setItem("hood_slip", String(s2)); } catch (e) { /* ignore */ }
  };

  // ETH → доллары мелким шрифтом
  const dollars = (e) => {
    const v = e * rate, a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    return (v < 0 ? "-" : "") + (a >= 1e3 ? usd(a) : "$" + a.toFixed(2));
  };

  // Топ держателей: восстанавливаем балансы из событий сделок
  const holders = useMemo(() => {
    if (!history || !data) return null;
    const m = {};
    for (const tr of history.trades) {
      const a = tr.addr.toLowerCase();
      m[a] = (m[a] ?? 0) + (tr.side === "buy" ? tr.tokens : -tr.tokens);
    }
    const TOTAL = 1e9;
    const unsold = Math.max(0, TOTAL - Number(formatEther(data.sold)));
    const list = Object.entries(m)
      .filter(([, v]) => v > 1e-6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([a, v]) => ({ addr: a, bal: v, pct: (v / TOTAL) * 100 }));
    return { list, unsold, unsoldPct: (unsold / TOTAL) * 100 };
  }, [history, data]);

  const chartPoints = useMemo(() => {
    if (!history) return null;
    if (tf === "all" || !history.now) return history.points;
    const cutoff = history.now - (tf === "24h" ? 86400e3 : 7 * 86400e3);
    const after = history.points.filter((p) => (p.ts ?? 0) >= cutoff);
    const before = history.points.filter((p) => (p.ts ?? 0) < cutoff);
    const base = before.length ? [before[before.length - 1]] : [];
    return [...base, ...after];
  }, [history, tf]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1500);
    } catch (e) { /* clipboard unavailable */ }
  }

  async function copyCA() {
    try {
      await navigator.clipboard.writeText(tokenAddress);
      setCopiedCA(true);
      setTimeout(() => setCopiedCA(false), 1500);
    } catch (e) { /* clipboard unavailable */ }
  }

  // Прайс-импакт: насколько сделка сдвинет цену относительно спота
  const impact = useMemo(() => {
    if (!quote || !data || !amount || Number(amount) <= 0) return null;
    const spot = Number(formatEther(data.price));
    if (spot <= 0) return null;
    if (tab === "buy" && quote.kind === "tokens") {
      const tokens = Number(formatEther(quote.value));
      if (tokens <= 0) return null;
      const eff = (Number(amount) * 0.99) / tokens; // за вычетом комиссии 1%
      return (eff / spot - 1) * 100;
    }
    if (tab === "sell" && quote.kind === "eth") {
      const eth = Number(formatEther(quote.value));
      const tokens = Number(amount);
      if (tokens <= 0) return null;
      const eff = eth / tokens;
      return (1 - eff / spot) * 100;
    }
    return null;
  }, [quote, data, amount, tab]);

  const load = useCallback(async () => {
    const pool = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "poolOf",
      args: [tokenAddress],
    });
    const [name, symbol, uri, price, sold, cap, reserve, graduated, migrated, creator] =
      await Promise.all([
        publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "name" }),
        publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "symbol" }),
        publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "metadataURI" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "spotPrice" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "tokensSold" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "saleCap" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "ethReserve" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "migrated" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "creator" }),
      ]);
    let balance = 0n;
    let walletEth = 0n;
    if (wallet) {
      [balance, walletEth] = await Promise.all([
        publicClient.readContract({
          address: tokenAddress,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [wallet.account],
        }),
        publicClient.getBalance({ address: wallet.account }).catch(() => 0n),
      ]);
    }
    setData({ pool, name, symbol, uri, price, sold, cap, reserve, graduated, migrated, creator, balance, walletEth });
    try {
      if (uri.startsWith("data:application/json;base64,")) {
        setMeta(JSON.parse(decodeURIComponent(escape(atob(uri.split(",")[1])))));
      }
    } catch { /* ignore malformed metadata */ }
  }, [tokenAddress, wallet]);

  useEffect(() => {
    load().catch((e) => setError(e.shortMessage || e.message));
    const id = setInterval(() => load().catch(() => {}), 12000);
    return () => clearInterval(id);
  }, [load]);

  // trades + chart from on-chain events; treasury/creator extras
  const loadExtras = useCallback(async () => {
    if (!data?.pool) return;
    const [h, creatorFees, treasuryOwner, treasuryHeld, burned, createdMap] = await Promise.all([
      poolTrades(data.pool),
      publicClient.readContract({ address: data.pool, abi: poolExtraAbi, functionName: "creatorFeesAccrued" }),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "owner" }).catch(() => null),
      publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [TREASURY_ADDRESS] }).catch(() => 0n),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "burnedOf", args: [tokenAddress] }).catch(() => 0n),
      loadCreationTimes([tokenAddress]).catch(() => ({})),
    ]);
    // Время сделок: интерполяция по блокам (2 RPC-вызова) — для таймфреймов графика
    if (h.trades.length > 0 && !h.trades[0].ts) {
      try {
        const blocks = h.trades.map((tr) => Number(tr.block));
        const minB = Math.min(...blocks);
        const [latestB, oldestB] = await Promise.all([
          publicClient.getBlock(),
          publicClient.getBlock({ blockNumber: BigInt(minB) }),
        ]);
        const span = Number(latestB.number) - minB;
        const avg = span > 0 ? (Number(latestB.timestamp) - Number(oldestB.timestamp)) / span : 0;
        for (const tr of h.trades) tr.ts = (Number(oldestB.timestamp) + (Number(tr.block) - minB) * avg) * 1000;
        const chrono = [...h.trades].reverse();
        h.points.forEach((p, k) => { p.ts = k === 0 ? chrono[0].ts : chrono[k - 1].ts; });
        h.now = Number(latestB.timestamp) * 1000;
      } catch (e) { /* график останется в режиме «всё время» */ }
    }
    setHistory(h);
    setExtra({ creatorFees, treasuryOwner, treasuryHeld, burned,
               createdAt: createdMap[tokenAddress.toLowerCase()] });
  }, [data?.pool, tokenAddress]);

  useEffect(() => {
    loadExtras().catch(() => {});
    const id = setInterval(() => loadExtras().catch(() => {}), 20000);
    return () => clearInterval(id);
  }, [loadExtras]);

  const isTreasuryOwner =
    wallet && extra.treasuryOwner &&
    wallet.account.toLowerCase() === extra.treasuryOwner.toLowerCase();
  const isCreator =
    wallet && data?.creator &&
    wallet.account.toLowerCase() === data.creator.toLowerCase();

  async function sendTx(address, abi, functionName, args = [], value) {
    setError(""); setBusy(true);
    try {
      const hash = await wallet.walletClient.writeContract({ address, abi, functionName, args, value });
      await publicClient.waitForTransactionReceipt({ hash });
      await load(); await loadExtras();
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally { setBusy(false); }
  }

  // live quote
  useEffect(() => {
    if (!data || !amount || Number(amount) <= 0) return setQuote(null);
    const t = setTimeout(async () => {
      try {
        if (tab === "buy") {
          const out = await publicClient.readContract({
            address: data.pool, abi: poolAbi, functionName: "quoteBuy",
            args: [parseEther(amount)],
          });
          setQuote({ kind: "tokens", value: out });
        } else {
          const gross = await publicClient.readContract({
            address: data.pool, abi: poolAbi, functionName: "quoteSell",
            args: [parseEther(amount)],
          });
          const net = gross - (gross * 100n) / 10000n;
          setQuote({ kind: "eth", value: net });
        }
      } catch { setQuote(null); }
    }, 250);
    return () => clearTimeout(t);
  }, [amount, tab, data]);

  async function trade() {
    setError("");
    if (!wallet) return onConnect();
    if (!quote) return;
    setBusy(true);
    try {
      const autoPct = impact !== null
        ? Math.min(30, Math.max(0.5, impact * 1.3 + 0.5))
        : 1;
      const slipPct = slip === "auto" ? autoPct : Number(slip);
      const slipBps = BigInt(Math.round(slipPct * 100));
      let hash;
      if (tab === "buy") {
        const minOut = quote.value - (quote.value * slipBps) / 10000n;
        hash = await wallet.walletClient.writeContract({
          address: data.pool, abi: poolAbi, functionName: "buy",
          args: [minOut, wallet.account],
          value: parseEther(amount),
        });
      } else {
        const tokensIn = parseEther(amount);
        const allowance = await publicClient.readContract({
          address: tokenAddress, abi: tokenAbi, functionName: "allowance",
          args: [wallet.account, data.pool],
        });
        if (allowance < tokensIn) {
          const approveHash = await wallet.walletClient.writeContract({
            address: tokenAddress, abi: tokenAbi, functionName: "approve",
            args: [data.pool, tokensIn],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        const minOut = quote.value - (quote.value * slipBps) / 10000n;
        hash = await wallet.walletClient.writeContract({
          address: data.pool, abi: poolAbi, functionName: "sell",
          args: [tokensIn, minOut],
        });
      }
      await publicClient.waitForTransactionReceipt({ hash });
      setAmount("");
      await load();
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function migrate() {
    setError("");
    if (!wallet) return onConnect();
    setBusy(true);
    try {
      const hash = await wallet.walletClient.writeContract({
        address: data.pool, abi: poolAbi, functionName: "migrate",
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="center">{error || t("Загружаю…")}</div>;

  const progress = Number((data.sold * 10000n) / data.cap) / 100;
  const mcapEth = Number(formatEther(data.price)) * 1_000_000_000;
  const mcapUsd = usd(mcapEth * rate);

  return (
    <>
    <a className="btn back-btn" href="#/">‹ {t("Назад")}</a>
    <div className="token-layout">
      <div>
        <div className="card" style={{ cursor: "default", transform: "none" }}>
          <div className="card-title">
            <h3 style={{ fontSize: 24 }}>
              {data.name} <span className="ticker">${data.symbol}</span>
            </h3>
            {data.graduated && <span className="badge">🎯 В яблочке</span>}
          </div>
          {meta.description && (
            <p className="dim" style={{ marginTop: 10 }}>{meta.description}</p>
          )}
          {(meta.x || meta.telegram || meta.website) && (
            <p className="dim" style={{ marginTop: 6 }}>
              {[
                meta.x && (
                  <a key="x" href={`https://x.com/${meta.x}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    x.com/{meta.x}
                  </a>
                ),
                meta.telegram && (
                  <a key="tg" href={`https://t.me/${meta.telegram}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    t.me/{meta.telegram}
                  </a>
                ),
                meta.website && (
                  <a key="web" href={meta.website} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    {meta.website.replace(/^https?:\/\//, "")}
                  </a>
                ),
              ]
                .filter(Boolean)
                .map((el, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && " · "}
                    {el}
                  </React.Fragment>
                ))}
            </p>
          )}
          {meta.image && (
            <img
              src={meta.image}
              alt=""
              style={{ maxWidth: 160, borderRadius: 12, marginTop: 8 }}
              onError={(e) => (e.target.style.display = "none")}
            />
          )}

          <div className="stats-grid">
            <div className="stat-card">
              <div className="k">{t("Цена")}</div>
              <div className="v">{fmt(formatEther(data.price), 9)} ETH</div>
            </div>
            <div className="stat-card">
              <div className="k">{t("Капитализация")}</div>
              <div className="v">{mcapUsd}</div>
            </div>
            <div className="stat-card">
              <div className="k">{t("Собрано")}</div>
              <div className="v">{fmt(formatEther(data.reserve), 3)} ETH</div>
            </div>
            <div className="stat-card">
              <div className="k">{t("До градации")}</div>
              <div className="v">{fmt(progress, 1)}%</div>
            </div>
          </div>

          {!data.graduated && (
            <div className="progress" style={{ marginTop: 18 }}>
              <div style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}

          <div className="stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <div className="k">{t("Комиссии создателя")}</div>
              <div className="v" style={{ color: "var(--gold)" }}>
                {fmt(formatEther(extra.creatorFees ?? 0n), 5)} ETH
              </div>
            </div>
            {extra.burned > 0n && (
              <div className="stat-card">
                <div className="k">{t("Сожжено казной")}</div>
                <div className="v">{fmt(formatEther(extra.burned), 0)}</div>
              </div>
            )}
          </div>
          {isCreator && (extra.creatorFees ?? 0n) > 0n && (
            <button
              className="btn"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => sendTx(data.pool, poolExtraAbi, "claimCreatorFees", [wallet.account])}
            >
              {t("Забрать комиссии создателя")}
            </button>
          )}

          <p className="dim" style={{ marginTop: 18 }}>
            {t("Токен:")}{" "}
            <a className="mono" href={`${EXPLORER}/address/${tokenAddress}`} target="_blank" rel="noreferrer">
              {short(tokenAddress)}
            </a>{" "}
            <button className="mini-btn" onClick={copyCA} title={t("Скопировать адрес")}>
              {copiedCA ? "✓" : "⧉"}
            </button>
            {" · "}{t("Пул:")}{" "}
            <a className="mono" href={`${EXPLORER}/address/${data.pool}`} target="_blank" rel="noreferrer">
              {short(data.pool)}
            </a>
            {" · "}{t("Создатель:")} <span className="mono">{short(data.creator)}</span>
            {extra.createdAt ? <> {" · "}{t("Запущен")} {timeAgo(extra.createdAt)}</> : null}
          </p>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn" onClick={copyLink}>
              {copiedLink ? `✓ ${t("Ссылка скопирована!")}` : `⧉ ${t("Скопировать ссылку")}`}
            </button>
            <a className="btn" target="_blank" rel="noreferrer"
               href={`https://x.com/intent/tweet?text=${encodeURIComponent(`$${data.symbol} — ${data.name} · hood`)}&url=${encodeURIComponent(window.location.href)}&via=hoodandarrow`}>
              𝕏 {t("Поделиться")}
            </a>
          </div>
        </div>

        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3>{t("Капитализация по сделкам")}</h3>
            <div className="pill-group">
              {[["24h", t("24ч")], ["7d", t("7д")], ["all", t("Всё")]].map(([k, lbl]) => (
                <div key={k} className={`fpill ${tf === k ? "on" : ""}`} onClick={() => setTf(k)}>{lbl}</div>
              ))}
            </div>
          </div>
          <MiniChart points={chartPoints} rate={rate} />
        </div>

        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="card-title"><h3>{t("Сделки из блокчейна")}</h3></div>
          {!history && <div className="dim" style={{ padding: "14px 0" }}>{t("Читаю события…")}</div>}
          {history && history.trades.length === 0 && (
            <div className="dim" style={{ padding: "14px 0" }}>{t("Пока нет сделок.")}</div>
          )}
          {history && history.trades.slice(0, 12).map((tr, i) => (
            <div className="trow" key={i}>
              <span className={tr.side === "buy" ? "side-buy" : "side-sell"}>
                {t(tr.side === "buy" ? "Купил" : "Продал")}
              </span>
              <span>{fmt(tr.eth, 5)} ETH <span className="usd-sub">({dollars(tr.eth)})</span></span>
              <span>{fmt(tr.tokens, 0)}</span>
              <a className="mono" href={`${EXPLORER}/tx/${tr.tx}`} target="_blank" rel="noreferrer">
                {short(tr.addr)}
              </a>
              <span className="dim">{t("блок")} {String(tr.block)}</span>
            </div>
          ))}
        </div>

        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="card-title"><h3>{t("Топ держателей")}</h3></div>
          {!holders && <div className="dim" style={{ padding: "14px 0" }}>{t("Читаю события…")}</div>}
          {holders && holders.list.length > 0 && (() => {
            const top10 = holders.list.reduce((s, h) => s + h.pct, 0);
            const cls = top10 >= 40 ? "bad" : top10 >= 20 ? "warn" : "ok";
            return (
              <div className={`conc-note ${cls}`}>
                {t("Топ-10 держат")} {fmt(top10, 1)}% {t("сапплая")}
              </div>
            );
          })()}
          {holders && (
            <div style={{ marginTop: 6 }}>
              <div className="holder-row">
                <span className="hr-rank dim">—</span>
                <span className="hr-who">📈 {t("Бондинг-кривая")}</span>
                <span className="hr-bar"><span style={{ width: `${Math.min(holders.unsoldPct, 100)}%` }} /></span>
                <span className="hr-pct">{fmt(holders.unsoldPct, 1)}%</span>
              </div>
              {holders.list.map((h, i) => {
                const isCre = h.addr === data.creator.toLowerCase();
                const isTre = h.addr === TREASURY_ADDRESS.toLowerCase();
                const isMe = wallet && h.addr === wallet.account.toLowerCase();
                return (
                  <div className="holder-row" key={h.addr}>
                    <span className="hr-rank dim">{i + 1}</span>
                    <span className="hr-who">
                      <a className="mono" href={`${EXPLORER}/address/${h.addr}`} target="_blank" rel="noreferrer">
                        {short(h.addr)}
                      </a>
                      {isCre && <span className="badge hr-badge">🏹 {t("Создатель")}</span>}
                      {isTre && <span className="badge hr-badge">🏦 {t("Казна")}</span>}
                      {isMe && <span className="badge hr-badge">{t("Вы")}</span>}
                    </span>
                    <span className="hr-bar"><span style={{ width: `${Math.min(h.pct * 4, 100)}%` }} /></span>
                    <span className="hr-pct">{fmt(h.pct, 2)}%</span>
                  </div>
                );
              })}
              {holders.list.length === 0 && (
                <div className="dim" style={{ padding: "8px 0" }}>{t("Пока нет сделок.")}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        {data.graduated ? (
          data.migrated ? (
            <div className="panel" style={{ margin: 0, maxWidth: "none" }}>
              <div className="notice">
                {t("Токен градуировал — торговля на DEX. Кривая закрыта.")}
              </div>
            </div>
          ) : (
            <div className="panel" style={{ margin: 0, maxWidth: "none" }}>
              <div className="notice">
                {t("Кривая заполнена! Кто угодно может запустить миграцию.")}
              </div>
              <button className="btn btn-primary btn-block" onClick={migrate} disabled={busy}>
                {busy ? t("Мигрирую…") : t("Мигрировать на DEX")}
              </button>
              {error && <div className="error">{error}</div>}
            </div>
          )
        ) : (
          <div className="panel" style={{ margin: 0, maxWidth: "none" }}>
            <div className="tabs">
              <div className={`tab ${tab === "buy" ? "active-buy" : ""}`} onClick={() => { setTab("buy"); setAmount(""); setTradePct(0); }}>
                {t("Купить")}
              </div>
              <div className={`tab ${tab === "sell" ? "active-sell" : ""}`} onClick={() => { setTab("sell"); setAmount(""); setTradePct(0); }}>
                {t("Продать")}
              </div>
            </div>

            <label>{tab === "buy" ? t("Вы платите (ETH)") : `${t("Вы продаёте")} (${data.symbol})`}</label>
            <input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                const n = Number(e.target.value);
                if (tab === "buy") {
                  const avail = Math.max(0, Number(formatEther(data.walletEth ?? 0n)) - 0.0003);
                  setTradePct(avail > 0 && n > 0 ? Math.min(100, Math.round((n / avail) * 100)) : 0);
                } else {
                  const bal = Number(formatEther(data.balance));
                  setTradePct(bal > 0 && n > 0 ? Math.min(100, Math.round((n / bal) * 100)) : 0);
                }
              }}
              placeholder="0.0"
              inputMode="decimal"
            />
            {wallet && (
              <>
                <div className="slider-row" style={{ marginTop: 10 }}>
                  <span className="dim">
                    {tab === "buy"
                      ? `${t("От баланса")} ${fmt(Number(formatEther(data.walletEth ?? 0n)), 4)} ETH`
                      : `${t("От баланса")} ${fmt(Number(formatEther(data.balance)), 0)} ${data.symbol}`}
                  </span>
                  <b style={{ color: tab === "buy" ? "var(--gold)" : "var(--red)" }}>{tradePct}%</b>
                </div>
                <input type="range" className={`adm-slider ${tab === "sell" ? "burn" : ""}`}
                       min="0" max="100" step="1" value={tradePct}
                       onChange={(e) => {
                         const v = Number(e.target.value);
                         setTradePct(v);
                         if (tab === "buy") {
                           const avail = Math.max(0, Number(formatEther(data.walletEth ?? 0n)) - 0.0003);
                           setAmount(v > 0 ? (avail * v / 100).toFixed(6) : "");
                         } else {
                           setAmount(v > 0 ? formatEther((data.balance * BigInt(v)) / 100n) : "");
                         }
                       }} />
              </>
            )}
            {tab === "sell" && wallet && (
              <p className="dim" style={{ margin: "6px 0 0" }}>
                {t("Баланс:")} {fmt(formatEther(data.balance), 2)}{" "}
                <a href="#/" onClick={(e) => { e.preventDefault(); setAmount(formatEther(data.balance)); }}>
                  {t("макс")}
                </a>
              </p>
            )}

            <div className="qa-row">
              {qpcts.map((p2, i2) => qpEdit ? (
                <input key={i2} className="qp-edit" inputMode="numeric" value={p2}
                       onChange={(e) => {
                         const v = e.target.value.replace(/[^0-9]/g, "");
                         setQpcts((arr) => {
                           const a = [...arr];
                           a[i2] = v === "" ? "" : Math.min(100, Number(v));
                           return a;
                         });
                       }} />
              ) : (
                <div key={i2} className="fpill qa-pill"
                     onClick={() => {
                       const v = Number(p2) || 0;
                       setTradePct(v);
                       if (tab === "buy") {
                         const avail = Math.max(0, Number(formatEther(data.walletEth ?? 0n)) - 0.0003);
                         setAmount(v > 0 ? (avail * v / 100).toFixed(6) : "");
                       } else {
                         setAmount(v > 0 ? formatEther((data.balance * BigInt(v)) / 100n) : "");
                       }
                     }}>
                  {p2}%
                </div>
              ))}
              <div className="fpill qa-pill" title={t("Настроить быстрые проценты")}
                   onClick={() => {
                     if (qpEdit) {
                       const clean = qpcts.map((x) => Math.min(100, Math.max(1, Number(x) || 25)));
                       setQpcts(clean);
                       try { localStorage.setItem("hood_qp", JSON.stringify(clean)); } catch (e) { /* ignore */ }
                     }
                     setQpEdit(!qpEdit);
                   }}>
                {qpEdit ? "✓" : "✎"}
              </div>
            </div>

            <div className="slip-row">
              <span className="dim">{t("Слиппедж")}</span>
              <div className={`fpill slip-pill ${slip === "auto" ? "on" : ""}`}
                   onClick={() => setSlipSave("auto")}
                   title={t("Подбирается автоматически под размер сделки")}>
                {t("Авто")}{slip === "auto" && impact !== null
                  ? ` · ${fmt(Math.min(30, Math.max(0.5, impact * 1.3 + 0.5)), 1)}%` : ""}
              </div>
              <input className={`slip-custom ${typeof slip === "number" ? "on" : ""}`}
                     inputMode="decimal"
                     placeholder="%"
                     value={typeof slip === "number" ? slip : ""}
                     onChange={(e) => {
                       const v = e.target.value.replace(",", ".");
                       if (v === "") { setSlipSave("auto"); return; }
                       const n = Number(v);
                       if (n > 0 && n <= 50) setSlipSave(n);
                     }} />
            </div>

            {quote && (
              <div className="quote-box">
                <span>{t("Вы получите (оценка)")}</span>
                <b>
                  {tab === "buy"
                    ? `${fmt(formatEther(quote.value), 2)} ${data.symbol}`
                    : `${fmt(formatEther(quote.value), 6)} ETH`}
                </b>
              </div>
            )}
            {impact !== null && impact > 0.05 && (
              <div className={`impact-note ${impact >= 5 ? "bad" : impact >= 2 ? "warn" : ""}`}>
                {t("влияние на цену")} ≈ {fmt(impact, 1)}%
                {impact >= 5 ? " ⚠" : ""}
              </div>
            )}

            <button
              className={`btn btn-block ${tab === "buy" ? "btn-primary" : "btn-danger"}`}
              onClick={trade}
              disabled={busy || (!quote && !!wallet)}
            >
              {busy
                ? t("Подтверждаю…")
                : !wallet
                ? t("Подключить кошелёк")
                : tab === "buy"
                ? `${t("Купить")} ${data.symbol}`
                : `${t("Продать")} ${data.symbol}`}
            </button>
            {error && <div className="error">{error}</div>}
          </div>
        )}


        <Chat tokenAddress={tokenAddress} wallet={wallet} onConnect={onConnect} />
      </div>
    </div>
    </>
  );
}

function TreasuryBalance() {
  const [bal, setBal] = useState(null);
  useEffect(() => {
    let alive = true;
    publicClient.getBalance({ address: TREASURY_ADDRESS })
      .then((b) => alive && setBal(b)).catch(() => {});
    return () => { alive = false; };
  }, []);
  return <span className="dim">{bal === null ? "…" : `${fmt(formatEther(bal), 5)} ${window.__hoodT ? window.__hoodT("ETH доступно") : "ETH доступно"}`}</span>;
}
