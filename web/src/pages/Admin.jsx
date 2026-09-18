import React, { useEffect, useState, useCallback, useMemo } from "react";
import { formatEther, formatUnits, parseUnits } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { tokenAbi, poolExtraAbi, feeSplitterAbi, erc20Abi } from "../lib/abi.js";
import { ARENA_TREASURY_ADDRESS, BUYBACK_TREASURY_ADDRESS, FEE_SPLITTER_ADDRESS, CHAT_DB_URL, EXPLORER, FACTORY_START_BLOCK } from "../lib/config.js";
import { loadTokens, allTrades, useClock, dataSource } from "../lib/data.js";
import { useEthUsd, usd, quoteUsd } from "../lib/price.js";
import { loadBans, saveBans } from "../lib/bans.js";
import { useLang } from "../lib/i18n.jsx";
import Icon from "../components/Icon.jsx";
import { parseAbi } from "viem";

// Админка владельца — в том же принципе, что весь сайт (15.09.2026): полоса
// цифр казны, карточки с графиком как в аналитике (час / 24ч / неделя /
// месяц, наведение меняет цифру в шапке), вкладки текстом: выкуп с казны
// арены, модерация чата.
//
// Перезапуск 16.09.2026: комиссия 1% → 70% создателю, 30% в сплиттер, тот
// делит на казну арены / казну выкупа hood / команду. Монеты за валюту
// (USDG, акции, крипта) платят комиссию в СВОЕЙ валюте — все суммы здесь
// считаются в долларах по курсу, а не «как будто это ETH».
//
// Аудитория считается по анонимным 5-минутным корзинам `activity/{корзина}`
// (пишет каждый открытый сайт, см. App.jsx): id браузера → 1, с кошельком → 2.
// Никаких IP и персональных данных. Корзины старше 31 дня админка сама чистит.

const BUCKET = 300_000;                 // 5 минут
const KEEP_MS = 31 * 86400_000;
const RANGES = [
  ["hour", "Час", 12, BUCKET],          // 12 × 5 мин
  ["day", "24ч", 24, 3_600_000],        // 24 × 1 ч
  ["week", "Неделя", 7, 86_400_000],    // 7 × 1 день
  ["month", "Месяц", 30, 86_400_000],   // 30 × 1 день
];
const ZERO = "0x0000000000000000000000000000000000000000";
const PLATFORM_SHARE = 0.3; // 30% комиссии — платформе (арена 10 / выкуп hood 10 / команда 10)
// Срезы графика комиссий: кому какая доля каждой сделки
const FEE_VIEWS = [
  ["all", "Все", 1],
  ["creators", "Создателям 70%", 0.7],
  ["team", "Команде 10%", 0.1],
  ["buyback", "Выкуп hood 10%", 0.1],
  ["arena", "Арена 10%", 0.1],
];

// ArenaTreasury (контракт казны арены и казны выкупа hood): выкуп и сжигание в одной транзакции
const treasuryAbi = parseAbi([
  "function owner() view returns (address)",
  "function totalEthSpent() view returns (uint256)",
  "function buybackEth(address token, uint256 ethAmount, uint256 minTokensOut, string note) returns (uint256)",
  "function buybackQuote(address token, uint256 quoteAmount, uint256 minTokensOut, string note) returns (uint256)",
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
]);

/** Столбики — как в аналитике. money=true: подписи оси в долларах. */
function Bars({ data, bins, hover, setHover, fmtAxis, money }) {
  const max = Math.max(...data, 0);
  const W = 1000, H = 220, PAD_R = money ? 64 : 44, PAD_B = 24, TOP = 8;
  const n = data.length;
  const slot = (W - PAD_R) / n, gap = Math.max(3, Math.min(10, slot * 0.28)), bw = slot - gap;
  const yOf = (v) => TOP + (1 - (max > 0 ? v / max : 0)) * (H - PAD_B - TOP);
  const grid = max > 0 ? [0.5, 1] : [];
  const lbl = (v) => (money ? (v >= 1000 ? usd(v) : `$${v.toFixed(v >= 10 ? 0 : 2)}`) : Math.round(v));
  return (
    <svg className="ana-svg adm-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="admBarGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e6e6e3" /><stop offset="1" stopColor="#7c7c79" /></linearGradient>
        <linearGradient id="admBarHl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#c9c9c5" /></linearGradient>
        <linearGradient id="admBarNow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c8f542" /><stop offset="1" stopColor="#a6d92e" /></linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g}>
          <line x1="0" x2={W - PAD_R - 6} y1={yOf(max * g)} y2={yOf(max * g)} className="ana-grid-line" />
          <text x={W - PAD_R + 4} y={yOf(max * g) + 4} className="ana-grid-lbl">{lbl(max * g)}</text>
        </g>
      ))}
      {data.map((v, i) => {
        const h = max > 0 ? Math.max(4, (v / max) * (H - PAD_B - TOP)) : 4;
        const x = i * (bw + gap);
        const cls = `ana-svg-bar ${i === n - 1 ? "now" : ""} ${hover === i ? "hl" : hover !== null ? "dim" : ""}`;
        return (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x} y={TOP} width={bw} height={H - PAD_B - TOP} fill="transparent" />
            <rect x={x} y={H - PAD_B - h} width={bw} height={h} rx={Math.min(6, bw / 2)} className={cls} style={{ fill: i === n - 1 ? "url(#admBarNow)" : hover === i ? "url(#admBarHl)" : "url(#admBarGrad)" }} />
          </g>
        );
      })}
      {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
        <text key={i} x={i === 0 ? 0 : i === n - 1 ? (n - 1) * (bw + gap) + bw : i * (bw + gap) + bw / 2}
              y={H - 6} className="ana-axis-lbl" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
          {fmtAxis(bins[i])}
        </text>
      ))}
    </svg>
  );
}

/** Границы корзин периода: [t0, end, N, width] */
function binsOf(range) {
  const [, , N, width] = RANGES.find(([k]) => k === range);
  const now = Date.now();
  const end = width >= 86_400_000 ? new Date(now).setHours(24, 0, 0, 0) : Math.floor(now / width) * width + width;
  return { t0: end - N * width, end, N, width };
}

/** Что казна держит: ETH + валюты монет за валюту, всё в долларах. */
async function treasuryHoldings(addr, quotes, rate) {
  const bal = await publicClient.getBalance({ address: addr });
  const eth = Number(bal) / 1e18;
  const assets = [];
  await Promise.all(quotes.map(async (q) => {
    try {
      const raw = await publicClient.readContract({ address: q.addr, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
      if (raw === 0n) return;
      const amt = Number(raw) / 10 ** (q.dec ?? 18);
      const px = await quoteUsd(q.addr).catch(() => 0);
      assets.push({ addr: q.addr, sym: q.sym, dec: q.dec ?? 18, raw, amt, usd: amt * (px || 0), px: px || 0 });
    } catch (e) { /* валюта не ответила */ }
  }));
  assets.sort((a, b) => b.usd - a.usd);
  return { addr, bal, eth, assets, usd: eth * rate + assets.reduce((s, a) => s + a.usd, 0) };
}

// ---------------------------------------------------------------- боты: таймеры
// Три бота площадки живут в GitHub Actions по расписанию: выкуп hood — в начале
// каждого часа (+2 мин), арена — в 00:25 UTC, дивиденды и сбор комиссий — на
// круглых отметках каждые 5 минут. Здесь — обратный отсчёт до каждого и
// последнее сделанное (по событиям в цепи: Buyback казн, SplitEth/SplitErc20
// сплиттера). Кольцо заполняется по мере ожидания; после срока, пока в цепи
// не появилось новое событие, карточка показывает «выполняется».
const botEvAbi = parseAbi([
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
  "event SplitEth(address indexed token, uint256 toArena, uint256 toBuyback, uint256 toTeam)",
  "event SplitErc20(address indexed token, address indexed asset, uint256 toArena, uint256 toBuyback, uint256 toTeam)",
]);
const nextHourly = (now) => { const h = 3_600_000; return Math.floor(now / h) * h + 120_000 > now ? Math.floor(now / h) * h + 120_000 : (Math.floor(now / h) + 1) * h + 120_000; };
const nextDaily = (now) => { const d = 86_400_000; const at = Math.floor(now / d) * d + 25 * 60_000; return at > now ? at : at + d; };
const nextFive = (now) => (Math.floor(now / 300_000) + 1) * 300_000;
const pad2 = (n) => String(n).padStart(2, "0");
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s >= 3600 ? `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };
const ago = (ts, t) => { const m = Math.max(0, Math.round((Date.now() - ts) / 60_000)); return m < 1 ? t("только что") : m < 60 ? `${m} ${t("мин назад")}` : `${Math.floor(m / 60)} ${t("ч назад")}`; };

function BotCard({ title, sub, due, period, last, busyFor, t }) {
  const now = Date.now();
  const left = due - now;
  const frac = Math.min(1, Math.max(0, 1 - left / period));
  // после срока: «выполняется», пока нет свежего события (не позже busyFor после срока)
  const busy = left <= 0 || (last && now - last.ts < 60_000 && now - due < busyFor);
  const R = 30, C = 2 * Math.PI * R;
  return (
    <div className={`tm-card ${busy ? "busy" : ""}`}>
      <div className="tm-ring">
        <svg viewBox="0 0 72 72" width="72" height="72">
          <circle cx="36" cy="36" r={R} className="tm-track" />
          <circle cx="36" cy="36" r={R} className="tm-fill" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
        </svg>
        <div className="tm-time">{busy ? <span className="tm-dot" /> : hms(left)}</div>
      </div>
      <div className="tm-text">
        <div className="tm-title">{title}</div>
        <div className="tm-sub">{busy ? t("выполняется…") : sub}</div>
        <div className="tm-last">{last ? <>{t("последний")}: {last.text} · {ago(last.ts, t)}</> : t("ещё не было")}</div>
      </div>
    </div>
  );
}

function BotTimers({ t, rate }) {
  useClock(1000);
  const [ev, setEv] = useState({ hood: null, arena: null, div: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [bb, ar, sp] = await Promise.all([
          publicClient.getLogs({ address: BUYBACK_TREASURY_ADDRESS, event: botEvAbi[0], fromBlock: FACTORY_START_BLOCK }),
          publicClient.getLogs({ address: ARENA_TREASURY_ADDRESS, event: botEvAbi[0], fromBlock: FACTORY_START_BLOCK }),
          publicClient.getLogs({ address: FEE_SPLITTER_ADDRESS, events: [botEvAbi[1], botEvAbi[2]], fromBlock: FACTORY_START_BLOCK }),
        ]);
        const pick = async (logs, text) => {
          const l = logs[logs.length - 1];
          if (!l) return null;
          const b = await publicClient.getBlock({ blockNumber: l.blockNumber });
          return { ts: Number(b.timestamp) * 1000, text: text(l) };
        };
        const usdEth = (wei) => rate > 0 ? usd(Number(formatEther(wei)) * rate) : `${fmtEth(Number(formatEther(wei)))} ETH`;
        const [hood, arena, div] = await Promise.all([
          pick(bb, (l) => `${usdEth(l.args.amountIn)} → ${t("сожжено")}`),
          pick(ar.filter((l) => String(l.args.note || "").startsWith("arena")), (l) => `${usdEth(l.args.amountIn)} · ${String(l.args.note).replace(/^arena \S+ /, "")}${t(" место")}`),
          pick(sp, (l) => l.eventName === "SplitEth" ? `${usdEth(l.args.toArena + l.args.toBuyback + l.args.toTeam)} ${t("в казны")}` : t("комиссия в валюте монеты")),
        ]);
        if (alive) setEv({ hood, arena, div });
      } catch (e) { /* узел молчит — покажем в следующий раз */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [rate, t]);
  const now = Date.now();
  return (
    <div className="ana-panel tm-panel">
      <div className="ana-panel-head" style={{ marginBottom: 12 }}>
        <div>
          <div className="ana-panel-val" style={{ fontSize: 18 }}>{t("Боты")}</div>
          <div className="ana-panel-sub">{t("Обратный отсчёт до следующего запуска · по времени UTC · последнее — из событий в цепи")}</div>
        </div>
      </div>
      <div className="tm-grid">
        <BotCard t={t} title={t("Выкуп hood")} sub={t("раз в час, в :02")} due={nextHourly(now)} period={3_600_000} last={ev.hood} busyFor={120_000} />
        <BotCard t={t} title={t("Арена — выплата подиуму")} sub={t("раз в сутки, 00:25 UTC")} due={nextDaily(now)} period={86_400_000} last={ev.arena} busyFor={180_000} />
        <BotCard t={t} title={t("Дивиденды и сбор комиссий")} sub={t("каждые 5 минут")} due={nextFive(now)} period={300_000} last={ev.div} busyFor={90_000} />
      </div>
    </div>
  );
}

export default function Admin({ wallet, onConnect }) {
  useClock(5000);
  const { t } = useLang();
  const rate = useEthUsd();
  const [owner, setOwner] = useState(null);
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [amt, setAmt] = useState("");
  const [buyPct, setBuyPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copiedCA, setCopiedCA] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [online, setOnline] = useState(null);
  const [bans, setBans] = useState([]); // подписанный бан-лист (lib/bans.js)
  const [banInput, setBanInput] = useState("");
  const [activity, setActivity] = useState(null);   // { bucket: { b, p: { pid: 1|2 } } }
  const [range, setRange] = useState("day");
  const [hover, setHover] = useState(null);
  const [feeRange, setFeeRange] = useState("day");
  const [feeView, setFeeView] = useState("all");
  const [feeHover, setFeeHover] = useState(null);
  const [trades, setTrades] = useState(null);
  const [tab, setTab] = useState("buyback");

  // владелец подтверждён по цепи (owner() казны) — только тогда грузим
  // тяжёлое: до этого страница #/admin для посетителя ничего не тянет
  const isOwner = !!(wallet && owner && wallet.account.toLowerCase() === owner.toLowerCase());

  // онлайн, баны и корзины активности — из базы сайта
  useEffect(() => {
    if (!CHAT_DB_URL || !isOwner) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const [pr, br, ar] = await Promise.all([
          fetch(`${CHAT_DB_URL}/presence.json`).then((r) => r.json()).catch(() => ({})),
          loadBans({ force: true }),
          fetch(`${CHAT_DB_URL}/activity.json`).then((r) => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        const now = Date.now();
        setOnline(Object.values(pr || {}).filter((p) => p && now - (p.ts || 0) < 45_000).length);
        setBans(br || []);
        const act = ar || {};
        setActivity(act);
        // чистим корзины старше месяца, чтобы база не росла (и старые 12 слотов формата 0..11)
        const minB = Math.floor((now - KEEP_MS) / BUCKET);
        const stale = Object.keys(act).filter((k) => Number(k) < minB);
        if (stale.length) {
          fetch(`${CHAT_DB_URL}/activity.json`, { method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(stale.slice(0, 500).map((k) => [k, null]))) }).catch(() => {});
        }
        // и протухшее присутствие (правила базы дают удалять записи старше часа)
        const stalePr = Object.entries(pr || {}).filter(([, p]) => !p || now - (p.ts || 0) > 3_600_000).map(([k]) => k);
        if (stalePr.length) {
          fetch(`${CHAT_DB_URL}/presence.json`, { method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(stalePr.slice(0, 500).map((k) => [k, null]))) }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [isOwner]);

  // график аудитории: уникальные id по корзинам выбранного периода
  const aud = useMemo(() => {
    if (!activity) return null;
    const { t0, end, N, width } = binsOf(range);
    const sets = Array.from({ length: N }, () => new Set());
    const all = new Set(); const withWallet = new Set();
    for (const [k, slot] of Object.entries(activity)) {
      const b = Number(slot?.b ?? k);
      if (!isFinite(b)) continue;
      const ts = b * BUCKET;
      if (ts < t0 || ts >= end) continue;
      const i = Math.min(N - 1, Math.floor((ts - t0) / width));
      for (const [pid, v] of Object.entries(slot.p || {})) { sets[i].add(pid); all.add(pid); if (v === 2) withWallet.add(pid); }
    }
    return { bars: sets.map((s) => s.size), bins: sets.map((_, i) => t0 + i * width), uniq: all.size, wallet: withWallet.size, width };
  }, [activity, range]);
  const axisFmt = (width) => (ts) => {
    const d = new Date(ts); const p = (x) => String(x).padStart(2, "0");
    return width >= 86_400_000 ? `${d.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][d.getMonth()]}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fmtAxis = axisFmt(aud ? aud.width : 3_600_000);
  useEffect(() => { setHover(null); }, [range]);
  useEffect(() => { setFeeHover(null); }, [feeRange]);

  // сделки платформы — для графика комиссий (fee уже в ETH-эквиваленте,
  // монеты за валюту пересчитаны по курсу в data.js → toEthEquivalent)
  useEffect(() => {
    if (!isOwner) return undefined;
    let alive = true;
    const pull = () => allTrades().then((v) => alive && setTrades(v)).catch(() => {});
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [isOwner]);

  // график комиссий: сумма комиссий по корзинам периода, в $, × доля выбранного среза
  const fees = useMemo(() => {
    if (!trades || !(rate > 0)) return null;
    const { t0, end, N, width } = binsOf(feeRange);
    const share = FEE_VIEWS.find(([k]) => k === feeView)[2];
    const bars = Array(N).fill(0);
    let period = 0, total = 0, count = 0;
    for (const tr of trades) {
      const v = (tr.fee || 0) * rate * share;
      total += v;
      if (tr.ts < t0 || tr.ts >= end) continue;
      const i = Math.min(N - 1, Math.floor((tr.ts - t0) / width));
      bars[i] += v; period += v; count++;
    }
    return { bars, bins: bars.map((_, i) => t0 + i * width), period, total, count, width, share, capped: trades.length >= 3000 };
  }, [trades, feeRange, feeView, rate]);
  const feeAxis = axisFmt(fees ? fees.width : 3_600_000);

  // Бан-лист подписывается кошельком владельца (без газа) — иначе базу не
  // убедить, что писал именно владелец. Ошибка записи показывается, а не
  // глотается: раньше «Забанен» горело, хотя база запись отклоняла.
  const banUser = async (who) => {
    const key = who.trim().toLowerCase();
    if (!key || !CHAT_DB_URL || !wallet) return;
    setError("");
    try {
      const next = await saveBans(wallet, [...bans, key]);
      setBans(next);
      setBanInput("");
      setOk(`${t("Забанен")}: ${key}`); setTimeout(() => setOk(""), 2500);
    } catch (e) { setError("Не удалось забанить: " + (e.shortMessage || e.message)); }
  };
  const unbanUser = async (who) => {
    if (!CHAT_DB_URL || !wallet) return;
    setError("");
    try {
      const next = await saveBans(wallet, bans.filter((b) => b !== who));
      setBans(next);
    } catch (e) { setError("Не удалось разбанить: " + (e.shortMessage || e.message)); }
  };

  const copyAddr = (addr, e) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(addr); } catch (err) { /* ignore */ }
    setCopiedCA(addr); setTimeout(() => setCopiedCA(""), 1200);
  };
  const dollars = (v) => {
    const a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    return a >= 1e3 ? usd(v) : "$" + v.toFixed(2);
  };
  /** Сумма в активе монеты: «0.0123 ETH» или «0.034 GME». */
  const inAsset = (tk, raw) => {
    if (tk.q) { const n = Number(formatUnits(raw, tk.q.dec)); return `${n >= 1000 ? Math.round(n) : +n.toPrecision(4)} ${tk.q.sym}`; }
    return `${fmtEth(Number(formatEther(raw)))} ETH`;
  };
  /** Состав казны подписью: «0.002 ETH · 0.03 GME». */
  const holdingsSub = (h) => [`${fmtEth(h.eth)} ETH`, ...h.assets.map((a) => `${a.amt >= 1000 ? Math.round(a.amt) : +a.amt.toPrecision(3)} ${a.sym}`)].join(" · ");

  // Сначала — только владелец казны (один дешёвый вызов): пока кошелёк не
  // подтверждён, страница ничего больше не читает.
  useEffect(() => {
    let alive = true;
    publicClient.readContract({ address: ARENA_TREASURY_ADDRESS, abi: treasuryAbi, functionName: "owner" })
      .then((o) => { if (alive) setOwner(o); })
      .catch((e) => { if (alive) setError(e.shortMessage || e.message); });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    if (!isOwner) return;
    const tokens = await loadTokens();
    // валюты, которыми торгуют на площадке — одна проверка на валюту
    const seen = new Map();
    for (const tk of tokens) if (tk.q?.addr && !seen.has(tk.q.addr)) seen.set(tk.q.addr, tk.q);
    const quotes = [...seen.values()];
    const teamAddr = await publicClient.readContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "team" }).catch(() => null);
    const [arena, buyback, team, accrued] = await Promise.all([
      treasuryHoldings(ARENA_TREASURY_ADDRESS, quotes, rate),
      BUYBACK_TREASURY_ADDRESS ? treasuryHoldings(BUYBACK_TREASURY_ADDRESS, quotes, rate) : null,
      teamAddr ? treasuryHoldings(teamAddr, quotes, rate) : null,
      Promise.all(tokens.map((tk) =>
        publicClient.readContract({ address: tk.pool, abi: poolExtraAbi, functionName: "protocolFeesAccrued" }).catch(() => 0n))),
    ]);
    // несобранное — в валюте пула; в доллары по курсу валюты (ETH — по курсу ETH)
    const px = {};
    await Promise.all(quotes.map(async (qq) => { px[qq.addr] = await quoteUsd(qq.addr).catch(() => 0); }));
    const list = tokens.map((tk, i) => {
      const raw = accrued[i];
      const accruedUsd = tk.q ? Number(formatUnits(raw, tk.q.dec)) * (px[tk.q.addr] || 0) : Number(formatEther(raw)) * rate;
      return { ...tk, accrued: raw, accruedUsd };
    }).sort((a, b) => b.accruedUsd - a.accruedUsd || Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const unclaimedUsd = list.reduce((s, x) => s + x.accruedUsd, 0);
    setData({ list, arena, buyback, team, unclaimedUsd });
  }, [isOwner, rate]);

  useEffect(() => {
    load().catch((e) => setError(e.shortMessage || e.message));
    const id = setInterval(() => load().catch(() => {}), 20000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    return data.list.filter((tk) => !n || tk.symbol.toLowerCase().includes(n) || tk.name.toLowerCase().includes(n) || tk.token.toLowerCase().includes(n));
  }, [data, q]);
  const selected = useMemo(() => (sel && data ? data.list.find((x) => x.token === sel) : null), [sel, data]);
  // из чего платится выкуп выбранной монеты: ETH казны или её валюта в казне
  const selAsset = useMemo(() => {
    if (!selected || !data) return null;
    if (!selected.q) return { sym: "ETH", dec: 18, bal: data.arena.eth, raw: data.arena.bal, px: rate };
    const a = data.arena.assets.find((x) => x.addr === selected.q.addr);
    return { sym: selected.q.sym, dec: selected.q.dec, bal: a ? a.amt : 0, raw: a ? a.raw : 0n, px: a ? a.px : 0 };
  }, [selected, data, rate]);

  async function run(fn, okText) {
    setError(""); setOk(""); setBusy(true);
    try {
      const hash = await fn();
      await publicClient.waitForTransactionReceipt({ hash });
      setOk(okText + " · " + short(hash));
      setAmt("");
      await load();
      setTimeout(() => load().catch(() => {}), 3000);
    } catch (e) { setError(e.shortMessage || e.message); } finally { setBusy(false); }
  }
  // выкуп с казны арены: ETH-монета — за ETH, монета за валюту — из той же
  // валюты. Сначала симуляция — сколько монет даст кривая, и не меньше 97%
  // от этого в minTokensOut (иначе казну можно зажать сэндвичем).
  const doBuyback = () => run(async () => {
    const value = parseUnits(amt, selAsset.dec);
    const fn = selected.q ? "buybackQuote" : "buybackEth";
    const note = `manual ${new Date().toISOString().slice(0, 10)}`;
    const { result } = await publicClient.simulateContract({
      account: wallet.account, address: ARENA_TREASURY_ADDRESS, abi: treasuryAbi, functionName: fn,
      args: [selected.token, value, 0n, note],
    });
    const minOut = (BigInt(result) * 97n) / 100n;
    return wallet.walletClient.writeContract({ address: ARENA_TREASURY_ADDRESS, abi: treasuryAbi, functionName: fn, args: [selected.token, value, minOut, note] });
  }, t("Выкуп исполнен"));

  // собрать долю платформы из пулов в сплиттер → казны. ETH-пул шлёт сам
  // (claimProtocolFees → receive сплиттера делит). Пул за валюту — через
  // сплиттер (claim), иначе валюта ляжет в сплиттер неразделённой.
  async function claimAll() {
    setError(""); setOk(""); setBusy(true);
    try {
      const pools = data.list.filter((tk) => tk.accrued > 0n);
      let claimed = 0;
      for (const tk of pools) {
        const hash = tk.q
          ? await wallet.walletClient.writeContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "claim", args: [tk.pool] })
          : await wallet.walletClient.writeContract({ address: tk.pool, abi: poolExtraAbi, functionName: "claimProtocolFees" });
        await publicClient.waitForTransactionReceipt({ hash });
        claimed++;
      }
      setOk(t("Комиссии собраны") + ` (${claimed})`);
      await load();
      setTimeout(() => load().catch(() => {}), 3000);
    } catch (e) { setError(e.shortMessage || e.message); } finally { setBusy(false); }
  }

  if (!wallet) {
    return (
      <div className="lt-empty">
        {t("Подключите кошелёк владельца платформы.")}{" "}
        <a style={{ color: "var(--gold)", cursor: "pointer" }} onClick={onConnect}>{t("Подключить →")}</a>
      </div>
    );
  }
  // fail-closed: пока владелец не подтверждён — доступа нет
  if (!owner || wallet.account.toLowerCase() !== owner.toLowerCase()) {
    return <div className="lt-empty">{t("Доступ только для владельца платформы.")}</div>;
  }

  const hv = hover !== null && aud ? { v: aud.bars[hover], ts: aud.bins[hover] } : null;
  const fhv = feeHover !== null && fees ? { v: fees.bars[feeHover], ts: fees.bins[feeHover] } : null;
  const rangeLbl = RANGES.find(([k]) => k === range)[1];
  const feeRangeLbl = RANGES.find(([k]) => k === feeRange)[1];

  return (
    <>
      <div className="ana-head">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t("Панель")}</h1>
          <div className="ana-panel-sub">
            {t("Казна, аудитория, модерация.")}{" "}
            <span className="dim">· {dataSource.v === "subgraph" ? "Goldsky" : dataSource.v === "rpc" ? "RPC" : "…"}</span>
            {import.meta.env.VITE_BUILD && (
              <span className="dim" title={import.meta.env.VITE_COMMIT || ""}>
                {" "}· {import.meta.env.BASE_URL !== "/" ? "staging" : t("сборка")} #{import.meta.env.VITE_BUILD}
                {import.meta.env.VITE_COMMIT ? ` · ${String(import.meta.env.VITE_COMMIT).slice(0, 7)}` : ""}
              </span>
            )}
          </div>
        </div>
        {data && data.unclaimedUsd > 0 && (
          <button className="btn btn-primary" disabled={busy} onClick={claimAll}>
            {busy ? "…" : `${t("Собрать в казну")} · ${dollars(data.unclaimedUsd)}`}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="notice" style={{ margin: "0 0 14px" }}>{ok}</div>}

      {data && (
        <div className="ana-strip">
          <div className="ana-stat"><div className="n">{dollars(data.arena.usd)}</div><div className="l">{t("Казна арены")} <span className="dim">· {holdingsSub(data.arena)}</span></div></div>
          <div className="ana-stat"><div className="n">{data.buyback ? dollars(data.buyback.usd) : "—"}</div><div className="l">{t("Казна выкупа hood")}{data.buyback && <span className="dim"> · {holdingsSub(data.buyback)}</span>}</div></div>
          <div className="ana-stat"><div className="n">{data.team ? dollars(data.team.usd) : "—"}</div><div className="l">{t("Кошелёк команды")}{data.team && <span className="dim"> · {holdingsSub(data.team)}</span>}</div></div>
          <div className="ana-stat"><div className="n">{dollars(data.unclaimedUsd)}</div><div className="l">{t("Несобранные комиссии")} <span className="dim">· {t("в пулах")}</span></div></div>
        </div>
      )}

      {/* комиссии платформы */}
      <div className="ana-panel">
        <div className="ana-panel-head">
          <div>
            <div className="ana-panel-val">
              {fhv ? dollars(fhv.v) : fees ? dollars(fees.period) : "…"}
              <span className="adm-val-sub"> {feeView === "all" ? t("комиссий") : t(FEE_VIEWS.find(([k]) => k === feeView)[1]).toLowerCase()} · {fhv ? feeAxis(fhv.ts) : feeRangeLbl.toLowerCase()}</span>
            </div>
            <div className="ana-panel-sub">
              {fees
                ? <>{t("за всё время")} {dollars(fees.total)} · {fees.count} {t("сделок")} {t("за период")}{feeView === "all" && <> · {t("создателям")} {dollars(fees.period * (1 - PLATFORM_SHARE))} · {t("платформе")} {dollars(fees.period * PLATFORM_SHARE)}</>}</>
                : t("Загружаю…")}
            </div>
          </div>
          <div className="seg">
            {RANGES.map(([k, lbl]) => (
              <button key={k} type="button" className={`seg-btn ${feeRange === k ? "on" : ""}`} onClick={() => setFeeRange(k)}>{t(lbl)}</button>
            ))}
          </div>
        </div>
        <div className="seg adm-fee-views">
          {FEE_VIEWS.map(([k, lbl]) => (
            <button key={k} type="button" className={`seg-btn ${feeView === k ? "on" : ""}`} onClick={() => setFeeView(k)}>{t(lbl)}</button>
          ))}
        </div>
        {fees ? <Bars data={fees.bars} bins={fees.bins} hover={feeHover} setHover={setFeeHover} fmtAxis={feeAxis} money /> : <div className="ana-svg" />}
        <div className="ana-panel-sub" style={{ marginTop: 6 }}>
          {t("Комиссия 1% с каждой сделки, все монеты, в долларах по курсу на сейчас")} · {t("создателю 70% · арена 10% · выкуп hood 10% · команда 10%")}
          {fees?.capped && <> · {t("показаны последние 3000 сделок")}</>}
        </div>
      </div>

      {/* аудитория */}
      <div className="ana-panel">
        <div className="ana-panel-head">
          <div>
            <div className="ana-panel-val">
              {hv ? hv.v : online === null ? "…" : online}
              <span className="adm-val-sub"> {hv ? t("уникальных") : t("онлайн")}</span>
            </div>
            <div className="ana-panel-sub">
              {hv ? fmtAxis(hv.ts) : aud ? <>{aud.uniq} {t("уникальных")} {t("за период")} · {aud.wallet} {t("с кошельком")}</> : t("Загружаю…")}
            </div>
          </div>
          <div className="seg">
            {RANGES.map(([k, lbl]) => (
              <button key={k} type="button" className={`seg-btn ${range === k ? "on" : ""}`} onClick={() => setRange(k)}>{t(lbl)}</button>
            ))}
          </div>
        </div>
        {aud ? <Bars data={aud.bars} bins={aud.bins} hover={hover} setHover={setHover} fmtAxis={fmtAxis} /> : <div className="ana-svg" />}
        <div className="ana-panel-sub" style={{ marginTop: 6 }}>{t("Уникальные браузеры по корзинам")} · {rangeLbl.toLowerCase()} · {t("без IP и персональных данных")}</div>
      </div>

      <BotTimers t={t} rate={rate} />

      <div className="ttabs">
        <button type="button" className={`ttab ${tab === "buyback" ? "on" : ""}`} onClick={() => setTab("buyback")}>{t("Выкуп с казны")}</button>
        <button type="button" className={`ttab ${tab === "mod" ? "on" : ""}`} onClick={() => setTab("mod")}>{t("Модерация чата")}{bans.length > 0 && <span className="dim"> · {bans.length}</span>}</button>
        {tab === "buyback" && <span className="ttabs-right">{t("Ручной выкуп из казны арены — сверх ежедневного подиума")}</span>}
      </div>

      {!data && !error && (
        <div className="lt">{Array.from({ length: 5 }, (_, i) => <div key={i} className="lt-row skel"><span /><span className="lt-logo" /><span className="lt-tok"><span className="lt-name" /><span className="lt-sub" /></span><span /><span /><span /><span /></div>)}</div>
      )}

      {data && tab === "buyback" && (
        <div className="adm-layout">
          <div>
            <div className="big-search adm-search">
              <Icon name="search" size={15} style={{ margin: 0 }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Поиск: тикер, имя или адрес…")} spellCheck={false} />
            </div>
            <div className="lt adm-lt">
              <div className="lt-h"><span /><span>{t("Токен")}</span><span className="r">{t("Валюта")}</span><span className="r">{t("Резерв")}</span><span className="r">{t("Несобрано")}</span></div>
              {filtered.length === 0 && <div className="lt-empty">{t("Ничего не найдено")}</div>}
              {filtered.map((tk) => (
                <div key={tk.token} className={`lt-row adm-row ${sel === tk.token ? "on" : ""}`}
                     onClick={() => { setSel(tk.token); setOk(""); setError(""); setAmt(""); setBuyPct(0); }}>
                  <span className="lt-logo">{tk.meta.image ? <img src={tk.meta.image} alt="" loading="lazy" /> : <Icon name="image" size={16} style={{ margin: 0, opacity: .5 }} />}</span>
                  <span className="lt-tok">
                    <span className="lt-name">{tk.name} <em>${tk.symbol}</em>{tk.graduated && <em> · {t("градуировал")}</em>}</span>
                    <span className="lt-sub mono addr-copy" onClick={(e) => copyAddr(tk.token, e)} title={t("Скопировать адрес")}>{short(tk.token)} {copiedCA === tk.token ? "✓" : "⧉"}</span>
                  </span>
                  <span className="lt-num">{tk.q ? tk.q.sym : "ETH"}</span>
                  <span className="lt-num">{inAsset(tk, tk.reserve)}</span>
                  <span className="lt-num">{tk.accrued > 0n ? <>{dollars(tk.accruedUsd)} <span className="dim">· {inAsset(tk, tk.accrued)}</span></> : <span className="dim">—</span>}</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="ana-panel adm-aside">
            {!selected && <div className="dim">{t("Выберите монету слева, чтобы выкупить и сжечь из казны арены.")}</div>}
            {selected && selAsset && (
              <>
                <div className="adm-aside-head">
                  {selected.meta.image && <img src={selected.meta.image} alt="" />}
                  <div>
                    <div className="lt-name">{selected.name} <em>${selected.symbol}</em></div>
                    <div className="lt-sub mono addr-copy" onClick={(e) => copyAddr(selected.token, e)}>{short(selected.token)} {copiedCA === selected.token ? "✓" : "⧉"}</div>
                  </div>
                </div>

                {selected.graduated ? (
                  <div className="dim" style={{ margin: "14px 0" }}>{t("Токен градуировал — кривая закрыта, выкуп с казны недоступен.")}</div>
                ) : (
                  <>
                    <div className="slider-row" style={{ marginTop: 18 }}>
                      <span className="dim">{t("Выкуп")} · {t("в казне")} {+selAsset.bal.toPrecision(4)} {selAsset.sym}</span>
                      <b style={{ color: "var(--gold)" }}>{buyPct}% {t("казны")}</b>
                    </div>
                    <input type="range" className="adm-slider" min="0" max="100" step="1" value={buyPct}
                           onChange={(e) => { const v = Number(e.target.value); setBuyPct(v); setAmt(v > 0 ? formatUnits((selAsset.raw * BigInt(v)) / 100n, selAsset.dec) : ""); }} />
                    <input value={amt} onChange={(e) => { setAmt(e.target.value); const n = Number(e.target.value); setBuyPct(selAsset.bal > 0 && n > 0 ? Math.min(100, Math.round((n / selAsset.bal) * 100)) : 0); }}
                           placeholder={`0.001 ${selAsset.sym}`} inputMode="decimal" style={{ width: "100%", margin: "8px 0" }} />
                    <button className="btn btn-primary btn-block" disabled={busy || !amt || selAsset.bal <= 0} onClick={doBuyback}>
                      {busy ? "…" : `${t("Выкупить")} $${selected.symbol}${amt ? ` · ${dollars((Number(amt) || 0) * selAsset.px)}` : ""}`}
                    </button>
                    {selAsset.bal <= 0 && <div className="dim" style={{ marginTop: 8, fontSize: 13 }}>{t("В казне арены нет")} {selAsset.sym} — {t("комиссии этой монеты ещё не приходили.")}</div>}
                    <div className="dim" style={{ marginTop: 10, fontSize: 13 }}>{t("Купленное сжигается в той же транзакции.")}</div>
                  </>
                )}
                <a className="dim" style={{ display: "block", marginTop: 16, fontSize: 13 }} href={`${EXPLORER}/address/${ARENA_TREASURY_ADDRESS}`} target="_blank" rel="noreferrer">{t("Казна арены в эксплорере")} →</a>
              </>
            )}
          </aside>
        </div>
      )}

      {data && tab === "mod" && (
        <div className="adm-mod">
          <div className="ana-panel-sub" style={{ marginBottom: 12 }}>{t("Забаньте кошелёк или ник — их сообщения скроются у всех, и писать они больше не смогут. Адрес берите в том виде, как он показан в чате.")}</div>
          <div className="adm-ban-row">
            <input value={banInput} onChange={(e) => setBanInput(e.target.value)} placeholder={t("Адрес (0x1234…abcd) или ник (гость-xxxx)…")} spellCheck={false}
                   onKeyDown={(e) => e.key === "Enter" && banUser(banInput)} />
            <button className="btn btn-danger" onClick={() => banUser(banInput)} disabled={!banInput.trim()}>{t("Забанить")}</button>
          </div>
          <div className="lt" style={{ marginTop: 14 }}>
            {bans.length === 0 ? <div className="lt-empty">{t("Никто не забанен.")}</div>
              : bans.map((who) => (
                <div className="lt-row adm-ban" key={who}>
                  <span className="mono">{who}</span>
                  <span className="dim" />
                  <button className="btn" onClick={() => unbanUser(who)}>{t("Разбанить")}</button>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
