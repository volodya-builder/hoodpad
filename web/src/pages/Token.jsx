import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { parseEther, formatEther } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { factoryAbi, poolAbi, tokenAbi, treasuryAbi, poolExtraAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS, TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { poolTrades, invalidateTrades } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import Chat from "./Chat.jsx";
import { useSplit, loadCreationTimes, timeAgo, useClock, useSupport } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { bindRefIfNeeded } from "../lib/referral.js";
import CandleChart from "../components/CandleChart.jsx";

const SLIPPAGE_CHOICES = [0.5, 1, 3, 5]; // %

const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function smoothPath(xs, ys) {
  if (xs.length < 3) {
    return xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  }
  let d = `M${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[Math.max(0, i - 1)], y0 = ys[Math.max(0, i - 1)];
    const x1 = xs[i], y1 = ys[i];
    const x2 = xs[i + 1], y2 = ys[i + 1];
    const x3 = xs[Math.min(xs.length - 1, i + 2)], y3 = ys[Math.min(xs.length - 1, i + 2)];
    d += `C${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)} ` +
         `${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)} ` +
         `${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return d;
}

function MiniChart({ points, rate, marks }) {
  const [hover, setHover] = React.useState(null);
  const W = 680, H = 300, PADB = 30, PADT = 14, PADL = 8, PADR = 62;
  let en = false;
  try { en = localStorage.getItem("hood_lang") === "en"; } catch (e) { /* ignore */ }
  const MONTHS = en ? MONTHS_EN : MONTHS_RU;

  const pts = (points && points.length >= 2)
    ? points
    : [{ i: 0, mcap: 1.625, ts: null }, { i: 1, mcap: 1.625, ts: null }];
  const empty = !(points && points.length >= 2);

  let mn = Infinity, mx = -Infinity;
  pts.forEach((p) => { mn = Math.min(mn, p.mcap); mx = Math.max(mx, p.mcap); });
  if (mx - mn < mx * 0.02) { mx *= 1.03; mn *= 0.97; }
  const X = (i) => PADL + (i / (pts.length - 1)) * (W - PADL - PADR);
  const Y = (v) => PADT + (1 - (v - mn) / (mx - mn)) * (H - PADT - PADB);
  const xs = pts.map((_, i) => X(i));
  const ys = pts.map((p) => Y(p.mcap));
  const line = smoothPath(xs, ys);
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${H - PADB} L${PADL} ${H - PADB} Z`;
  const last = pts[pts.length - 1];
  const usdV = (m) => usd(m * rate);
  const tsLbl = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // тики времени по нижней оси
  const tsPts = pts.map((p, i) => ({ i, ts: p.ts })).filter((x) => x.ts);
  const ticks = [];
  if (tsPts.length >= 2) {
    const N = Math.min(5, tsPts.length);
    for (let k = 0; k < N; k++) {
      const idx = Math.round((k / (N - 1)) * (tsPts.length - 1));
      ticks.push(tsPts[idx]);
    }
  }

  // счётчики событий для легенды
  const nBuy = (marks ?? []).filter((m) => m.kind === "buyback").length;
  const nBurn = (marks ?? []).filter((m) => m.kind === "burned").length;

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const idx = Math.round(((x - PADL) / (W - PADL - PADR)) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, idx)));
  };

  return (
    <div style={{ position: "relative" }}>
      {(nBuy > 0 || nBurn > 0) && (
        <div className="ch-legend">
          {nBuy > 0 && <span className="ch-chip"><i className="cbuy">BUY</i> {en ? "Treasury buyback" : "Выкуп казны"} {nBuy}</span>}
          {nBurn > 0 && <span className="ch-chip"><i className="cburn">BRN</i> {en ? "Burn" : "Сжигание"} {nBurn}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", marginTop: 8 }}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="tokAreaG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c8f42b" stopOpacity=".28" />
            <stop offset="1" stopColor="#c8f42b" stopOpacity="0" />
          </linearGradient>
          <filter id="chGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PADL} x2={W - PADR}
                y1={PADT + f * (H - PADT - PADB)} y2={PADT + f * (H - PADT - PADB)}
                stroke="currentColor" strokeOpacity="0.08" strokeDasharray="4 5" />
        ))}
        <path d={area} fill="url(#tokAreaG)" />
        <path d={line} fill="none" stroke="#c8f42b" strokeWidth="3" strokeOpacity=".55"
              filter="url(#chGlow)" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line} fill="none" stroke="#dfff54" strokeWidth="2.2"
              strokeLinejoin="round" strokeLinecap="round"
              strokeDasharray={empty ? "5 6" : "none"} />
        {!empty && (
          <circle cx={xs[xs.length - 1]} cy={Y(last.mcap)} r="4.5" fill="#e2ff5c" stroke="#0b0b0b" strokeWidth="2" />
        )}
        {(marks ?? []).map((mk, k) => {
          if (!pts.some((pp) => pp.ts)) return null;
          let best = -1, bd = Infinity;
          pts.forEach((pp, ii) => {
            if (pp.ts) { const d = Math.abs(pp.ts - mk.ts); if (d < bd) { bd = d; best = ii; } }
          });
          if (best < 0) return null;
          const bx = X(best), by = Y(pts[best].mcap);
          const isBurn = mk.kind === "burned";
          const bw = 34;
          return (
            <g key={`mk${k}`}>
              <line x1={bx} x2={bx} y1={by} y2={by - 22}
                    stroke={isBurn ? "#c2502e" : "#c8f42b"} strokeWidth="1.5" strokeOpacity=".8" />
              <circle cx={bx} cy={by} r="3.5" fill={isBurn ? "#c2502e" : "#c8f42b"} stroke="#0b0b0b" strokeWidth="1.5" />
              <rect x={bx - bw / 2} y={by - 40} width={bw} height="18" rx="6"
                    fill={isBurn ? "#c2502e" : "#c8f42b"} />
              <text x={bx} y={by - 27} textAnchor="middle" fontSize="10" fontWeight="800"
                    fill={isBurn ? "#ffffff" : "#101100"}>
                {isBurn ? "BRN" : "BUY"}
              </text>
            </g>
          );
        })}
        {hover !== null && !empty && (
          <g>
            <line x1={xs[hover]} x2={xs[hover]} y1={PADT} y2={H - PADB}
                  stroke="currentColor" strokeOpacity="0.25" />
            <circle cx={xs[hover]} cy={ys[hover]} r="4.5"
                    fill="#e2ff5c" stroke="#0b0b0b" strokeWidth="2" />
          </g>
        )}
        <text x={W - 6} y={PADT + 4} className="chart-axis" textAnchor="end">{usdV(mx)}</text>
        <text x={W - 6} y={PADT + 0.5 * (H - PADT - PADB) + 3} className="chart-axis" textAnchor="end">{usdV((mx + mn) / 2)}</text>
        <text x={W - 6} y={H - PADB} className="chart-axis" textAnchor="end">{usdV(mn)}</text>
        {ticks.map((tk2, k) => (
          <text key={k} x={X(tk2.i)} y={H - 8} className="chart-axis"
                textAnchor={k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}>
            {tsLbl(tk2.ts)}
          </text>
        ))}
      </svg>
      {hover !== null && !empty && (
        <div className="chart-tip" style={{ left: `${(xs[hover] / W) * 100}%` }}>
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
  useClock(5000);
  const { t } = useLang();
  const rate = useEthUsd();
  const split = useSplit();
  const support = useSupport();
  const cushion = support.per[tokenAddress?.toLowerCase()]?.eth || 0;
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
  const [trSort, setTrSort] = useState({ key: "ts", dir: "desc" }); // сортировка таблицы сделок
  const [hSort, setHSort] = useState("desc"); // сортировка холдеров по доле
  const [tradePct, setTradePct] = useState(0); // ползунок суммы
  const [btTab, setBtTab] = useState("trades");
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

  // Статистика для полосы над графиком
  const tokStats = useMemo(() => {
    if (!history || !history.trades.length) return null;
    const now = history.now ?? Date.now();
    const vol24 = history.trades
      .filter((tr) => (tr.ts ?? 0) >= now - 86400e3)
      .reduce((s2, tr) => s2 + tr.eth + tr.fee, 0);
    const ath = Math.max(...history.points.map((pp) => pp.mcap));
    return { vol24, ath };
  }, [history]);

  const chartPoints = useMemo(() => {
    if (!history) return null;
    if (tf === "all" || !history.now) return history.points;
    const TF_MS = { "5m": 300000, "1h": 3600000, "6h": 21600000, "1d": 86400000 };
    const cutoff = history.now - (TF_MS[tf] ?? 86400000);
    const after = history.points.filter((p) => (p.ts ?? 0) >= cutoff);
    const before = history.points.filter((p) => (p.ts ?? 0) < cutoff);
    const base = before.length ? [before[before.length - 1]] : [];
    return [...base, ...after];
  }, [history, tf]);

  const tfChange = useMemo(() => {
    if (!chartPoints || chartPoints.length < 2) return null;
    const first = chartPoints[0].mcap, last = chartPoints[chartPoints.length - 1].mcap;
    if (!(first > 0)) return null;
    return ((last - first) / first) * 100;
  }, [chartPoints]);

  // Метки выкупов/сжиганий казны по этому токену — на график
  const [marks, setMarks] = useState([]);
  useEffect(() => {
    let alive = true;
    import("../lib/data.js").then((m) => m.subgraphTreasuryOps())
      .then((ops) => {
        if (!alive) return;
        setMarks(ops
          .filter((o) => (o.token || "").toLowerCase() === tokenAddress.toLowerCase()
                         && (o.kind === "buyback" || o.kind === "burned"))
          .map((o) => ({ ts: Number(o.timestamp) * 1000, kind: o.kind })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [tokenAddress]);

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
      const slipPct = slip === "auto" ? 40 : Number(slip);
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
      if (wallet) bindRefIfNeeded(wallet.account); // рефералка: закрепить трейдера (fire-and-forget)
      await load();
      // график и список сделок — сразу и с повторами, пока индексатор догоняет
      const bump = () => { if (data?.pool) invalidateTrades(data.pool); loadExtras().catch(() => {}); };
      bump();
      setTimeout(bump, 4000);
      setTimeout(bump, 12000);
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- перетаскивание блоков: порядок карточек хранится в localStorage ----
  const BLK_DEF = { chart: 1, trades: 2, about: 3, swap: 1, chat: 2 };
  const LEFT_BLKS = ["chart", "trades", "about"], RIGHT_BLKS = ["swap", "chat"];
  const [blkOrd, setBlkOrd] = useState(() => {
    try { return { ...BLK_DEF, ...(JSON.parse(localStorage.getItem("hood_tok_blocks")) || {}) }; }
    catch (e) { return BLK_DEF; }
  });
  const dragSrc = useRef(null);
  const startBlk = (k) => (e) => {
    dragSrc.current = k;
    try { e.dataTransfer.setData("text/plain", k); e.dataTransfer.effectAllowed = "move"; } catch (err) { /* ignore */ }
  };
  const dropBlk = (k) => (e) => {
    e.preventDefault();
    const a = dragSrc.current; dragSrc.current = null;
    if (!a || a === k) return;
    const same = (LEFT_BLKS.includes(a) && LEFT_BLKS.includes(k)) || (RIGHT_BLKS.includes(a) && RIGHT_BLKS.includes(k));
    if (!same) return;
    const next = { ...blkOrd, [a]: blkOrd[k], [k]: blkOrd[a] };
    setBlkOrd(next);
    try { localStorage.setItem("hood_tok_blocks", JSON.stringify(next)); } catch (err) { /* ignore */ }
  };
  const [overBlk, setOverBlk] = useState(null);
  const blkProps = (k) => ({
    className: `drag-card ${overBlk === k && dragSrc.current && dragSrc.current !== k ? "over" : ""}`,
    style: { order: blkOrd[k] },
    onDragOver: (e) => { e.preventDefault(); setOverBlk(k); },
    onDragLeave: () => setOverBlk((v) => (v === k ? null : v)),
    onDrop: (e) => { setOverBlk(null); dropBlk(k)(e); },
  });
  const Handle = ({ k }) => (
    <span className="drag-handle" draggable onDragStart={startBlk(k)}
          title={t("Перетащите, чтобы поменять блоки местами")}>⠿</span>
  );

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

  // сортировка таблицы сделок по клику на заголовок колонки
  const sortTrades = (arr) => {
    const { key, dir } = trSort;
    const m = dir === "asc" ? 1 : -1;
    return [...arr].sort((a, b) => {
      if (key === "side" || key === "addr") {
        const va = String(a[key]), vb = String(b[key]);
        return va < vb ? -m : va > vb ? m : 0;
      }
      const va = key === "ts" ? (a.ts || 0) : key === "block" ? Number(a.block) : Number(a[key]) || 0;
      const vb = key === "ts" ? (b.ts || 0) : key === "block" ? Number(b.block) : Number(b[key]) || 0;
      return (va - vb) * m;
    });
  };
  const Th = ({ k, children }) => (
    <span className="sort-h"
          onClick={() => setTrSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}>
      {children} <i>{trSort.key === k ? (trSort.dir === "desc" ? "▼" : "▲") : "↕"}</i>
    </span>
  );
  const tradesHeader = (
    <div className="trow hdr" style={{ marginTop: 8 }}>
      <Th k="ts">{t("Время")}</Th>
      <Th k="side">{t("Тип")}</Th>
      <Th k="eth">ETH</Th>
      <Th k="tokens">{t("Токены")}</Th>
      <Th k="addr">{t("Трейдер")}</Th>
      <Th k="block">{t("Блок")}</Th>
    </div>
  );

  const socials = (meta.x || meta.telegram || meta.website) ? (
    <div className="soc-row" style={{ margin: 0 }}>
      {meta.x && (
        <a className="soc-btn" title="X (Twitter)" target="_blank" rel="noreferrer"
           href={/^https?:\/\//.test(meta.x) ? meta.x : `https://x.com/${meta.x.replace(/^@/, "")}`}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 5.9-7zm-1.3 19.4h2L6.6 3.3H4.4l13.2 17.3z"/>
          </svg>
        </a>
      )}
      {meta.telegram && (
        <a className="soc-btn" title="Telegram" target="_blank" rel="noreferrer"
           href={/^https?:\/\//.test(meta.telegram) ? meta.telegram : `https://t.me/${meta.telegram.replace(/^@/, "")}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M21.9 3.4 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18.1 6.5c.4-.4-.1-.6-.6-.2L6 13.5l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.4 2c.9-.3 1.7.2 1.5 1.4z"/>
          </svg>
        </a>
      )}
      {meta.website && (
        <a className="soc-btn" title={t("Сайт")} target="_blank" rel="noreferrer"
           href={/^https?:\/\//.test(meta.website) ? meta.website : `https://${meta.website}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9"/>
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.7 8.2 12s1.3 6.4 3.8 9"/>
          </svg>
        </a>
      )}
    </div>
  ) : null;

  return (
    <>
    <a className="btn back-btn" href="#/">‹ {t("Назад")}</a>
    <div className="token-layout">
      <div>
        <div {...blkProps("about")}><Handle k="about" />
        <div className="card" style={{ cursor: "default", transform: "none" }}>
          <div className="card-title">
            <h3>{t("О токене")}</h3>
          </div>
          {meta.description && (
            <p className="dim" style={{ marginTop: 10 }}>{meta.description}</p>
          )}

          {!data.graduated && (
            <div className="progress" style={{ marginTop: 18 }}>
              <div style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}

          <div className="stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <div className="k">{t("Комиссии создателя")}</div>
              <div className="v" style={{ color: "var(--gold)" }}>
                {fmtEth(formatEther(extra.creatorFees ?? 0n))} ETH
              </div>
            </div>
            {cushion > 0 && (
              <div className="stat-card">
                <div className="k">🛡 {t("Выкуп казны")}</div>
                <div className="v" style={{ color: "var(--gold)" }}>{fmtEth(cushion)} ETH</div>
              </div>
            )}
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
            <a className="btn" target="_blank" rel="noreferrer" href={`${EXPLORER}/address/${tokenAddress}`}>
              {t("Контракт")} ↗
            </a>
            <a className="btn" target="_blank" rel="noreferrer" href={`${EXPLORER}/address/${data.pool}`}>
              {t("Пул")} ↗
            </a>
          </div>
        </div>
        </div>

        <div {...blkProps("chart")}><Handle k="chart" />
        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22 }}>
              {meta.image && (
                <img src={meta.image} alt="" style={{ width: 96, height: 96, borderRadius: 18 }}
                     onError={(e) => (e.target.style.display = "none")} />
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {data.name} <span className="ticker">${data.symbol}</span>
                  {data.graduated && <span className="badge">🎯 В яблочке</span>}
                  {socials}
                </div>
                <div className="mono th-addr" onClick={copyCA} title={t("Скопировать адрес")}>
                  {short(tokenAddress)} {copiedCA ? "✓" : "⧉"}
                </div>
              </div>
            </h3>
            <div className="pill-group">
              {[["5m", "5M"], ["1h", "1H"], ["6h", "6H"], ["1d", "1D"], ["all", "ALL"]].map(([k, lbl]) => (
                <div key={k} className={`fpill ${tf === k ? "on" : ""}`} onClick={() => setTf(k)}>{lbl}</div>
              ))}
            </div>
          </div>
          <div className="tk-strip">
            <div>
              <div className="tk-mcap">{mcapUsd}</div>
              {tfChange !== null && (
                <div className={`tk-chg ${tfChange >= 0 ? "up" : "down"}`}>
                  {tfChange >= 0 ? "+" : ""}{fmt(tfChange, 2)}%{" "}
                  <span className="dim">{tf.toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="tk-cells">
              <div className="tk-cell"><span>{t("Цена")}</span><b>{fmtEth(formatEther(data.price))} ETH</b></div>
              <div className="tk-cell"><span>{t("Собрано")}</span><b>{fmtEth(formatEther(data.reserve))} ETH</b></div>
              <div className="tk-cell"><span>{t("Объём 24ч")}</span><b>{tokStats ? fmtEth(tokStats.vol24) : "0"} ETH</b></div>
              <div className="tk-cell"><span>ATH</span><b>{tokStats ? usd(tokStats.ath * rate) : "—"}</b></div>
              {!data.graduated && (
                <div className="tk-cell"><span>{t("До градации")}</span><b>{fmt(progress, 1)}%</b></div>
              )}
            </div>
          </div>
          {history && history.points && history.points.filter((p) => p.ts).length >= 2 ? (
            <CandleChart points={history.points} trades={history.trades} rate={rate} marks={marks} />
          ) : (
            <MiniChart points={chartPoints} rate={rate} marks={marks} />
          )}
        </div>
        </div>

        <div {...blkProps("trades")}><Handle k="trades" />
        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="bt-tabs">
            <div className={`bt-tab ${btTab === "mine" ? "on" : ""}`} onClick={() => setBtTab("mine")}>
              {t("Мои позиции")}
            </div>
            <div className={`bt-tab ${btTab === "trades" ? "on" : ""}`} onClick={() => setBtTab("trades")}>
              {t("Сделки из блокчейна")}
            </div>
            <div className={`bt-tab ${btTab === "holders" ? "on" : ""}`} onClick={() => setBtTab("holders")}>
              {t("Топ держателей")}
            </div>
          </div>
          {btTab === "trades" && (<>

          {!history && <div className="dim" style={{ padding: "14px 0" }}>{t("Читаю события…")}</div>}
          {history && history.trades.length === 0 && (
            <div className="dim" style={{ padding: "14px 0" }}>{t("Пока нет сделок.")}</div>
          )}
          {history && history.trades.length > 0 && tradesHeader}
          {history && sortTrades(history.trades).slice(0, 12).map((tr, i) => {
            const isMine = wallet && tr.addr.toLowerCase() === wallet.account.toLowerCase();
            return (
            <div className={`trow ${isMine ? "mine" : ""}`} key={i}>
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
              <span>{fmt(tr.tokens, 0)}</span>
              <a className="mono" href={`${EXPLORER}/address/${tr.addr}`} target="_blank" rel="noreferrer"
                 title={t("Открыть адрес в эксплорере")}>
                {short(tr.addr)}{isMine && <span className="badge hr-badge">{t("Вы")}</span>}
              </a>
              <a className="dim" href={`${EXPLORER}/block/${tr.block}`} target="_blank" rel="noreferrer"
                 title={t("Открыть блок в эксплорере")}>
                {t("блок")} {String(tr.block)}
              </a>
            </div>
            );
          })}
          </>)}
          {btTab === "mine" && (<>
          {!wallet && (
            <div className="dim" style={{ padding: "14px 0" }}>
              {t("Подключите кошелёк, чтобы увидеть профиль.")}{" "}
              <a href="#/" onClick={(e) => { e.preventDefault(); onConnect(); }} style={{ color: "var(--gold)" }}>
                {t("Подключить →")}
              </a>
            </div>
          )}
          {wallet && !history && <div className="dim" style={{ padding: "14px 0" }}>{t("Читаю события…")}</div>}
          {wallet && history && (() => {
            const mine = history.trades.filter((tr) => tr.addr.toLowerCase() === wallet.account.toLowerCase());
            if (mine.length === 0) return <div className="dim" style={{ padding: "14px 0" }}>{t("Сделок пока нет.")}</div>;
            // сводка позиции (как у GMGN)
            const buys = mine.filter((x) => x.side === "buy");
            const sells = mine.filter((x) => x.side === "sell");
            const buysEth = buys.reduce((s, x) => s + x.eth, 0);
            const buysTok = buys.reduce((s, x) => s + x.tokens, 0);
            const sellsEth = sells.reduce((s, x) => s + x.eth, 0);
            const sellsTok = sells.reduce((s, x) => s + x.tokens, 0);
            const feesEth = mine.reduce((s, x) => s + (x.fee || 0), 0);
            const balTok = Number(formatEther(data.balance));
            const valEth = balTok * Number(formatEther(data.price));
            const pnlEth = valEth + sellsEth - buysEth;
            const pnlPct = buysEth > 0 ? (pnlEth / buysEth) * 100 : 0;
            const lastTs = mine.reduce((s, x) => Math.max(s, x.ts || 0), 0);
            return [(
              <div className="tk-cells" style={{ margin: "14px 0 2px" }} key="sum">
                <div className="tk-cell"><span>{t("Активность")}</span><b>{lastTs ? timeAgo(lastTs) : "—"}</b></div>
                <div className="tk-cell"><span>{t("Куплено")}</span><b>{dollars(buysEth)}</b><span>{fmt(buysTok, 0)}</span></div>
                <div className="tk-cell"><span>{t("Продано")}</span><b>{dollars(sellsEth)}</b><span>{fmt(sellsTok, 0)}</span></div>
                <div className="tk-cell"><span>{t("Баланс")}</span><b>{dollars(valEth)}</b><span>{fmt(balTok, 0)} ({fmt(balTok / 1e7, 2)}%)</span></div>
                <div className="tk-cell"><span>uPnL</span>
                  <b style={{ color: pnlEth >= 0 ? "var(--leaf)" : "var(--red)" }}>
                    {dollars(pnlEth)} ({pnlPct >= 0 ? "+" : ""}{fmt(pnlPct, 1)}%)
                  </b>
                </div>
                <div className="tk-cell"><span>{t("Комиссии")}</span><b>{dollars(feesEth)}</b></div>
              </div>
            ), (
              <React.Fragment key="hdr">{tradesHeader}</React.Fragment>
            ), ...sortTrades(mine).slice(0, 20).map((tr, i) => (
              <div className="trow" key={i}>
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
                <span>{fmt(tr.tokens, 0)}</span>
                <a className="mono" href={`${EXPLORER}/address/${tr.addr}`} target="_blank" rel="noreferrer"
                   title={t("Открыть адрес в эксплорере")}>
                  {short(tr.addr)}
                </a>
                <a className="dim" href={`${EXPLORER}/block/${tr.block}`} target="_blank" rel="noreferrer"
                   title={t("Открыть блок в эксплорере")}>
                  {t("блок")} {String(tr.block)}
                </a>
              </div>
            ))];
          })()}
          </>)}
          {btTab === "holders" && (<>

          {!holders && <div className="dim" style={{ padding: "14px 0" }}>{t("Читаю события…")}</div>}
          {holders && holders.list.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {(() => {
                const top10 = holders.list.reduce((s, h) => s + h.pct, 0);
                const cls = top10 >= 40 ? "bad" : top10 >= 20 ? "warn" : "ok";
                return (
                  <div className={`conc-note ${cls}`}>
                    {t("Топ-10 держат")} {fmt(top10, 1)}% {t("сапплая")}
                  </div>
                );
              })()}
              <span className="sort-h dim" style={{ fontSize: 12, fontWeight: 700 }}
                    onClick={() => setHSort((s) => (s === "desc" ? "asc" : "desc"))}>
                {t("Доля")} <i>{hSort === "desc" ? "▼" : "▲"}</i>
              </span>
            </div>
          )}
          {holders && (
            <div style={{ marginTop: 6 }}>
              <div className="holder-row">
                <span className="hr-rank dim">—</span>
                <span className="hr-who">📈 {t("Бондинг-кривая")}</span>
                <span className="hr-bar"><span style={{ width: `${Math.min(holders.unsoldPct, 100)}%` }} /></span>
                <span className="hr-pct">{fmt(holders.unsoldPct, 1)}%</span>
              </div>
              {(hSort === "desc" ? holders.list : [...holders.list].reverse()).map((h, i) => {
                const isCre = h.addr === data.creator.toLowerCase();
                const isTre = h.addr === TREASURY_ADDRESS.toLowerCase();
                const isMe = wallet && h.addr === wallet.account.toLowerCase();
                return (
                  <div className="holder-row" key={h.addr}>
                    <span className="hr-rank dim">{hSort === "desc" ? i + 1 : holders.list.length - i}</span>
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
          </>)}
        </div>
        </div>
      </div>

      <div>
        <div {...blkProps("swap")}><Handle k="swap" />
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
                      ? `${t("От баланса")} ${fmtEth(Number(formatEther(data.walletEth ?? 0n)))} ETH`
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

            <div className="slip-row" style={{ marginTop: 12 }}>
              <span className="dim">{t("Слиппедж")}</span>
              <div className="slip-seg">
                <div className={`slip-opt ${slip === "auto" ? "on" : ""}`}
                     onClick={() => setSlipSave("auto")}
                     title={t("Подбирается автоматически под размер сделки")}>
                  ⚡ {t("Авто")} 40%
                </div>
                <div className="slip-div" />
                <label className={`slip-opt slip-opt-custom ${typeof slip === "number" ? "on" : ""}`}>
                  <input inputMode="decimal" placeholder="1.0"
                         value={typeof slip === "number" ? slip : ""}
                         onChange={(e) => {
                           const v = e.target.value.replace(",", ".");
                           if (v === "") { setSlipSave("auto"); return; }
                           const n = Number(v);
                           if (n > 0 && n <= 50) setSlipSave(n);
                         }} />
                  <span>%</span>
                </label>
              </div>
            </div>

            {quote && (
              <div className="quote-box">
                <span>{t("Вы получите (оценка)")}</span>
                <b>
                  {tab === "buy"
                    ? `${fmt(formatEther(quote.value), 2)} ${data.symbol}`
                    : `${fmtEth(formatEther(quote.value))} ETH`}
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
              style={{ marginTop: 18 }}
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
        </div>

        <div {...blkProps("chat")}><Handle k="chat" />
        <Chat tokenAddress={tokenAddress} wallet={wallet} onConnect={onConnect} />
        </div>
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
  return <span className="dim">{bal === null ? "…" : `${fmtEth(formatEther(bal))} ${window.__hoodT ? window.__hoodT("ETH доступно") : "ETH доступно"}`}</span>;
}
