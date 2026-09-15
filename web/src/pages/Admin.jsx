import React, { useEffect, useState, useCallback, useMemo } from "react";
import { formatEther, parseEther } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { treasuryAbi, tokenAbi, poolExtraAbi, feeClaimerAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER, CHAT_DB_URL, FEE_CLAIMER_ADDRESS } from "../lib/config.js";
import { loadTokens, subgraphVotes, subgraphTreasuryOps, timeAgo, useClock, dataSource } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";
import Icon from "../components/Icon.jsx";

// Админка владельца — в том же принципе, что весь сайт (15.09.2026): полоса
// цифр казны, одна карточка аудитории с графиком как в аналитике (час /
// 24ч / неделя / месяц, наведение меняет цифру в шапке), вкладки текстом:
// выкуп и сжигание с казны, модерация чата.
//
// Аудитория считается по анонимным 5-минутным корзинам `activity/{корзина}`
// (пишет каждый открытый сайт, см. App.jsx): id браузера → 1, с кошельком → 2.
// Никаких IP и персональных данных. Корзины старше 31 дня админка сама чистит.

const EPOCH_LEN = 7 * 86400;
const BUCKET = 300_000;                 // 5 минут
const KEEP_MS = 31 * 86400_000;
const RANGES = [
  ["hour", "Час", 12, BUCKET],          // 12 × 5 мин
  ["day", "24ч", 24, 3_600_000],        // 24 × 1 ч
  ["week", "Неделя", 7, 86_400_000],    // 7 × 1 день
  ["month", "Месяц", 30, 86_400_000],   // 30 × 1 день
];

/** Столбики уникальных посетителей — как в аналитике. */
function Bars({ data, bins, hover, setHover, fmtAxis }) {
  const max = Math.max(...data, 0);
  const W = 1000, H = 220, PAD_R = 44, PAD_B = 24, TOP = 8;
  const n = data.length;
  const slot = (W - PAD_R) / n, gap = Math.max(3, Math.min(10, slot * 0.28)), bw = slot - gap;
  const yOf = (v) => TOP + (1 - (max > 0 ? v / max : 0)) * (H - PAD_B - TOP);
  const grid = max > 0 ? [0.5, 1] : [];
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
          <text x={W - PAD_R + 4} y={yOf(max * g) + 4} className="ana-grid-lbl">{Math.round(max * g)}</text>
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
  const [burnAmt, setBurnAmt] = useState("");
  const [burnPct, setBurnPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copiedCA, setCopiedCA] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [online, setOnline] = useState(null);
  const [bans, setBans] = useState({});
  const [banInput, setBanInput] = useState("");
  const [activity, setActivity] = useState(null);   // { bucket: { b, p: { pid: 1|2 } } }
  const [range, setRange] = useState("day");
  const [hover, setHover] = useState(null);
  const [tab, setTab] = useState("buyback");

  // онлайн, баны и корзины активности — из базы сайта
  useEffect(() => {
    if (!CHAT_DB_URL) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const [pr, br, ar] = await Promise.all([
          fetch(`${CHAT_DB_URL}/presence.json`).then((r) => r.json()).catch(() => ({})),
          fetch(`${CHAT_DB_URL}/bans.json`).then((r) => r.json()).catch(() => ({})),
          fetch(`${CHAT_DB_URL}/activity.json`).then((r) => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        const now = Date.now();
        setOnline(Object.values(pr || {}).filter((p) => p && now - (p.ts || 0) < 45_000).length);
        setBans(br || {});
        const act = ar || {};
        setActivity(act);
        // чистим корзины старше месяца, чтобы база не росла (и старые 12 слотов формата 0..11)
        const minB = Math.floor((now - KEEP_MS) / BUCKET);
        const stale = Object.keys(act).filter((k) => Number(k) < minB);
        if (stale.length) {
          fetch(`${CHAT_DB_URL}/activity.json`, { method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(stale.slice(0, 500).map((k) => [k, null]))) }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // график аудитории: уникальные id по корзинам выбранного периода
  const aud = useMemo(() => {
    if (!activity) return null;
    const [, , N, width] = RANGES.find(([k]) => k === range);
    const now = Date.now();
    const end = width >= 86_400_000 ? new Date(now).setHours(24, 0, 0, 0) : Math.floor(now / width) * width + width;
    const t0 = end - N * width;
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
  const fmtAxis = (ts) => {
    const d = new Date(ts); const p = (x) => String(x).padStart(2, "0");
    return aud && aud.width >= 86_400_000 ? `${d.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][d.getMonth()]}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  useEffect(() => { setHover(null); }, [range]);

  const banUser = async (who) => {
    const key = who.trim();
    if (!key || !CHAT_DB_URL) return;
    try {
      await fetch(`${CHAT_DB_URL}/bans.json`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: { ts: Date.now() } }) });
      setBans((b) => ({ ...b, [key]: { ts: Date.now() } }));
      setBanInput("");
      setOk(`${t("Забанен")}: ${key}`); setTimeout(() => setOk(""), 2500);
    } catch (e) { setError("Не удалось забанить: " + e.message); }
  };
  const unbanUser = async (who) => {
    if (!CHAT_DB_URL) return;
    try {
      await fetch(`${CHAT_DB_URL}/bans.json`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [who]: null }) });
      setBans((b) => { const c = { ...b }; delete c[who]; return c; });
    } catch (e) { setError("Не удалось разбанить: " + e.message); }
  };

  const copyAddr = (addr, e) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(addr); } catch (err) { /* ignore */ }
    setCopiedCA(addr); setTimeout(() => setCopiedCA(""), 1200);
  };
  const dollars = (e) => {
    const v = e * rate, a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    return a >= 1e3 ? usd(v) : "$" + v.toFixed(2);
  };

  const load = useCallback(async () => {
    const [tokens, bal, received, spent, ownerAddr] = await Promise.all([
      loadTokens(),
      publicClient.getBalance({ address: TREASURY_ADDRESS }),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => 0n),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => 0n),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "owner" }).catch(() => null),
    ]);
    const ep = BigInt(Math.floor(Date.now() / 1000 / EPOCH_LEN));
    const votes = await subgraphVotes(ep).catch(() => []);
    const tally = {};
    votes.forEach((v) => { tally[v.token] = (tally[v.token] ?? 0) + 1; });
    const held = await Promise.all(tokens.map((tk) =>
      publicClient.readContract({ address: tk.token, abi: tokenAbi, functionName: "balanceOf", args: [TREASURY_ADDRESS] }).catch(() => 0n)));
    const accrued = await Promise.all(tokens.map((tk) =>
      publicClient.readContract({ address: tk.pool, abi: poolExtraAbi, functionName: "protocolFeesAccrued" }).catch(() => 0n)));
    const ops = await subgraphTreasuryOps().catch(() => []);
    const list = tokens.map((tk, i) => ({ ...tk, held: held[i], accrued: accrued[i], voteCount: tally[tk.token.toLowerCase()] ?? 0 }))
      .sort((a, b) => b.voteCount - a.voteCount || Number(b.reserve - a.reserve));
    const unclaimed = accrued.reduce((s2, a) => s2 + a, 0n);
    setOwner(ownerAddr);
    setData({ list, bal, received, spent, unclaimed, ops: ops.slice(0, 12) });
  }, []);

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

  async function run(fn, okText) {
    setError(""); setOk(""); setBusy(true);
    try {
      const hash = await fn();
      await publicClient.waitForTransactionReceipt({ hash });
      setOk(okText + " · " + short(hash));
      setAmt(""); setBurnAmt("");
      await load();
      setTimeout(() => load().catch(() => {}), 3000);
    } catch (e) { setError(e.shortMessage || e.message); } finally { setBusy(false); }
  }
  const doBuyback = () => run(() => wallet.walletClient.writeContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "buyback", args: [selected.token, parseEther(amt), 0n] }), t("Выкуп исполнен"));
  const doBurn = () => run(() => wallet.walletClient.writeContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "burn", args: [selected.token, parseEther(burnAmt)] }), t("Сжигание исполнено"));
  async function claimAll() {
    setError(""); setOk(""); setBusy(true);
    try {
      const pools = data.list.filter((tk) => tk.accrued > 0n).map((tk) => tk.pool);
      let claimed = 0;
      if (FEE_CLAIMER_ADDRESS && pools.length > 1) {
        // одна транзакция на все пулы — через FeeClaimer
        const hash = await wallet.walletClient.writeContract({ address: FEE_CLAIMER_ADDRESS, abi: feeClaimerAbi, functionName: "claimAll", args: [pools] });
        await publicClient.waitForTransactionReceipt({ hash });
        claimed = pools.length;
      } else {
        for (const pool of pools) {
          const hash = await wallet.walletClient.writeContract({ address: pool, abi: poolExtraAbi, functionName: "claimProtocolFees" });
          await publicClient.waitForTransactionReceipt({ hash });
          claimed++;
        }
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

  const balEth = data ? Number(formatEther(data.bal)) : 0;
  const E = (wei) => Number(formatEther(wei));
  const hv = hover !== null && aud ? { v: aud.bars[hover], ts: aud.bins[hover] } : null;
  const rangeLbl = RANGES.find(([k]) => k === range)[1];

  return (
    <>
      <div className="ana-head">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t("Панель")}</h1>
          <div className="ana-panel-sub">
            {t("Казна, аудитория, модерация.")}{" "}
            <span className="dim">· {dataSource.v === "subgraph" ? "Goldsky" : dataSource.v === "rpc" ? "RPC" : "…"}</span>
          </div>
        </div>
        {data && data.unclaimed > 0n && (
          <button className="btn btn-primary" disabled={busy} onClick={claimAll}>
            {busy ? "…" : `${t("Собрать в казну")} · ${fmtEth(E(data.unclaimed))} ETH`}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="notice" style={{ margin: "0 0 14px" }}>{ok}</div>}

      {data && (
        <div className="ana-strip">
          <div className="ana-stat"><div className="n">{dollars(balEth)}</div><div className="l">{t("Баланс казны")} <span className="dim">· {fmtEth(balEth)} ETH</span></div></div>
          <div className="ana-stat"><div className="n">{dollars(E(data.received))}</div><div className="l">{t("Получено за всё время")}</div></div>
          <div className="ana-stat"><div className="n">{dollars(E(data.spent))}</div><div className="l">{t("Потрачено на выкупы")}</div></div>
          <div className="ana-stat"><div className="n">{dollars(E(data.unclaimed))}</div><div className="l">{t("Несобранные комиссии")}</div></div>
        </div>
      )}

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

      <div className="ttabs">
        <button type="button" className={`ttab ${tab === "buyback" ? "on" : ""}`} onClick={() => setTab("buyback")}>{t("Выкуп с казны")}</button>
        <button type="button" className={`ttab ${tab === "mod" ? "on" : ""}`} onClick={() => setTab("mod")}>{t("Модерация чата")}{Object.keys(bans).length > 0 && <span className="dim"> · {Object.keys(bans).length}</span>}</button>
        {tab === "buyback" && <span className="ttabs-right">{t("Голоса раунда — подсказка, решение за вами")}</span>}
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
              <div className="lt-h"><span /><span>{t("Токен")}</span><span className="r">{t("Голоса")}</span><span className="r">{t("Резерв")}</span><span className="r">{t("В казне")}</span></div>
              {filtered.length === 0 && <div className="lt-empty">{t("Ничего не найдено")}</div>}
              {filtered.map((tk) => (
                <div key={tk.token} className={`lt-row adm-row ${sel === tk.token ? "on" : ""}`}
                     onClick={() => { setSel(tk.token); setOk(""); setError(""); setAmt(""); setBuyPct(0); setBurnAmt(""); setBurnPct(0); }}>
                  <span className="lt-logo">{tk.meta.image ? <img src={tk.meta.image} alt="" loading="lazy" /> : <Icon name="image" size={16} style={{ margin: 0, opacity: .5 }} />}</span>
                  <span className="lt-tok">
                    <span className="lt-name">{tk.name} <em>${tk.symbol}</em>{tk.graduated && <em> · {t("градуировал")}</em>}</span>
                    <span className="lt-sub mono addr-copy" onClick={(e) => copyAddr(tk.token, e)} title={t("Скопировать адрес")}>{short(tk.token)} {copiedCA === tk.token ? "✓" : "⧉"}</span>
                  </span>
                  <span className="lt-num">{tk.voteCount || <span className="dim">—</span>}</span>
                  <span className="lt-num">{fmtEth(E(tk.reserve))} ETH</span>
                  <span className="lt-num">{tk.held > 0n ? fmt(E(tk.held), 0) : <span className="dim">—</span>}</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="ana-panel adm-aside">
            {!selected && <div className="dim">{t("Выберите токен слева, чтобы выкупить или сжечь.")}</div>}
            {selected && (
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
                      <span className="dim">{t("Выкуп")}</span>
                      <b style={{ color: "var(--gold)" }}>{buyPct}% {t("казны")}</b>
                    </div>
                    <input type="range" className="adm-slider" min="0" max="100" step="1" value={buyPct}
                           onChange={(e) => { const v = Number(e.target.value); setBuyPct(v); setAmt(v > 0 ? (balEth * v / 100).toFixed(8) : ""); }} />
                    <input value={amt} onChange={(e) => { setAmt(e.target.value); const n = Number(e.target.value); setBuyPct(balEth > 0 && n > 0 ? Math.min(100, Math.round((n / balEth) * 100)) : 0); }}
                           placeholder="0.001 ETH" inputMode="decimal" style={{ width: "100%", margin: "8px 0" }} />
                    <button className="btn btn-primary btn-block" disabled={busy || !amt} onClick={doBuyback}>
                      {busy ? "…" : `${t("Выкупить")} $${selected.symbol}${amt ? ` · ${dollars(Number(amt) || 0)}` : ""}`}
                    </button>
                  </>
                )}

                {selected.held > 0n && (
                  <>
                    <div className="slider-row" style={{ marginTop: 22 }}>
                      <span className="dim">{t("Сжечь")} · {t("в казне")} {fmt(E(selected.held), 0)}</span>
                      <b style={{ color: "var(--red)" }}>{burnPct}%</b>
                    </div>
                    <input type="range" className="adm-slider burn" min="0" max="100" step="1" value={burnPct}
                           onChange={(e) => { const v = Number(e.target.value); setBurnPct(v); setBurnAmt(v > 0 ? formatEther((selected.held * BigInt(v)) / 100n) : ""); }} />
                    <input value={burnAmt} onChange={(e) => { setBurnAmt(e.target.value); const heldN = E(selected.held); const n = Number(e.target.value); setBurnPct(heldN > 0 && n > 0 ? Math.min(100, Math.round((n / heldN) * 100)) : 0); }}
                           placeholder="0" inputMode="decimal" style={{ width: "100%", margin: "8px 0" }} />
                    <button className="btn btn-danger btn-block" disabled={busy || !burnAmt} onClick={doBurn}>{busy ? "…" : t("Сжечь")}</button>
                  </>
                )}
              </>
            )}

            {data.ops.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>{t("Последние операции")}</div>
                {data.ops.map((o, i) => (
                  <a key={i} className="adm-op" href={`${EXPLORER}/tx/${o.tx}`} target="_blank" rel="noreferrer">
                    <span>{o.kind === "received" ? t("получено") : o.kind === "buyback" ? t("выкуп") : t("сожжено")}</span>
                    <span className="mono">{o.kind === "burned" ? fmt(Number(o.tokenAmount) / 1e18, 0) : `${fmtEth(Number(o.ethAmount) / 1e18)} ETH`}</span>
                    <span className="dim">{timeAgo(Number(o.timestamp) * 1000)}</span>
                  </a>
                ))}
              </div>
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
            {Object.keys(bans).length === 0 ? <div className="lt-empty">{t("Никто не забанен.")}</div>
              : Object.entries(bans).map(([who, b]) => (
                <div className="lt-row adm-ban" key={who}>
                  <span className="mono">{who}</span>
                  <span className="dim">{b?.ts ? timeAgo(b.ts) : ""}</span>
                  <button className="btn" onClick={() => unbanUser(who)}>{t("Разбанить")}</button>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
