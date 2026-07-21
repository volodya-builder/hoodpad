import React, { useEffect, useState } from "react";
import { formatEther, parseAbiItem } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { treasuryAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { loadTokens, timeAgo, subgraphTreasuryOps, loadSupport, useClock, recentFromBlock } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

const evReceived = parseAbiItem("event Received(address indexed from, uint256 amount)");
const evBuyback = parseAbiItem("event Buyback(address indexed token, address indexed pool, uint256 ethIn, uint256 tokensOut)");
const evBurned = parseAbiItem("event Burned(address indexed token, uint256 amount)");

// Память вкладки между заходами (+ localStorage, чтобы не было "Читаю блокчейн" после перезагрузки)
let _tresState = null;
const TRES_LS = "hood_cache_treasury_v1";
const _bigR = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v);
const _bigV = (k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v);
try {
  const raw = localStorage.getItem(TRES_LS);
  if (raw) _tresState = JSON.parse(raw, _bigV);
} catch (e) { /* ignore */ }

export default function Treasury() {
  useClock(5000);
  const { t } = useLang();
  const rate = useEthUsd();
  const [state, setState] = useState(_tresState);
  const [error, setError] = useState("");

  const dollars = (e) => {
    const v = e * rate, a = Math.abs(v);
    if (a > 0 && a < 0.01) return "<$0.01";
    return (a >= 1e3 ? usd(v) : "$" + v.toFixed(2));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const [tokens, bal, received, spent] = await Promise.all([
        loadTokens().catch(() => []),
        publicClient.getBalance({ address: TREASURY_ADDRESS }).catch(() => _tresState?.bal ?? 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => _tresState?.received ?? 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => _tresState?.spent ?? 0n),
      ]);
      const symByAddr = {};
      for (const tk of tokens) symByAddr[tk.token.toLowerCase()] = tk.symbol;

      // Сжигания суммарно — из индексатора (1 кэшированный запрос вместо N контрактных)
      const burnedTotal = await loadSupport().then((s) => s.totalBurned ?? 0).catch(() => 0);

      // История операций: сначала индексатор, при ошибке — события из блокчейна
      let rows;
      try {
        const ops = await subgraphTreasuryOps();
        rows = ops.map((o) => {
          const ts = Number(o.timestamp) * 1000;
          if (o.kind === "received") {
            return { kind: "in", ts, tx: o.tx, block: 0n,
                     eth: Number(o.ethAmount) / 1e18, who: o.from };
          }
          if (o.kind === "buyback") {
            return { kind: "buy", ts, tx: o.tx, block: 0n,
                     eth: Number(o.ethAmount) / 1e18,
                     tokens: Number(o.tokenAmount) / 1e18,
                     sym: symByAddr[(o.token || "").toLowerCase()] ?? short(o.token || "") };
          }
          return { kind: "burn", ts, tx: o.tx, block: 0n,
                   tokens: Number(o.tokenAmount) / 1e18,
                   sym: symByAddr[(o.token || "").toLowerCase()] ?? short(o.token || "") };
        });
      } catch (subErr) {
        const logs = await publicClient.getLogs({
          address: TREASURY_ADDRESS,
          events: [evReceived, evBuyback, evBurned],
          fromBlock: await recentFromBlock(), toBlock: "latest",
        }).catch(() => []);
        logs.sort((a, b) => Number(b.blockNumber - a.blockNumber) || (b.logIndex - a.logIndex));
        let items = logs.map((l) => ({ l, ts: null }));
        if (logs.length > 0) {
          const minB = Number(logs[logs.length - 1].blockNumber);
          try {
            const [latest, oldest] = await Promise.all([
              publicClient.getBlock(),
              publicClient.getBlock({ blockNumber: BigInt(minB) }),
            ]);
            const span = Number(latest.number) - minB;
            const avg = span > 0 ? (Number(latest.timestamp) - Number(oldest.timestamp)) / span : 0;
            items = logs.map((l) => ({
              l,
              ts: (Number(oldest.timestamp) + (Number(l.blockNumber) - minB) * avg) * 1000,
            }));
          } catch (e) { /* останутся номера блоков */ }
        }
        rows = items.map(({ l, ts }) => {
          if (l.eventName === "Received") {
            return { kind: "in", ts, tx: l.transactionHash, block: l.blockNumber,
                     eth: Number(l.args.amount) / 1e18, who: l.args.from };
          }
          if (l.eventName === "Buyback") {
            return { kind: "buy", ts, tx: l.transactionHash, block: l.blockNumber,
                     eth: Number(l.args.ethIn) / 1e18,
                     tokens: Number(l.args.tokensOut) / 1e18,
                     sym: symByAddr[l.args.token.toLowerCase()] ?? short(l.args.token) };
          }
          return { kind: "burn", ts, tx: l.transactionHash, block: l.blockNumber,
                   tokens: Number(l.args.amount) / 1e18,
                   sym: symByAddr[l.args.token.toLowerCase()] ?? short(l.args.token) };
        });
      }

      if (!alive) return;
      const next = { bal, received, spent, burnedTotal, rows };
      _tresState = next;
      try { localStorage.setItem(TRES_LS, JSON.stringify(next, _bigR)); } catch (e) { /* ignore */ }
      setState(next);
    })().catch((e) => { if (alive && !_tresState) setError(e.shortMessage || e.message); });
    return () => { alive = false; };
  }, []);

  const KIND = {
    in:   { icon: "↓", cls: "tr-in",   label: "Пополнение" },
    buy:  { icon: "🛒", cls: "tr-buy",  label: "Выкуп" },
    burn: { icon: "🔥", cls: "tr-burn", label: "Сжигание" },
  };

  return (
    <>
      <div className="page-title">{t("Казна выкупа")}</div>
      <div className="page-sub" style={{ maxWidth: 760 }}>
        {t("Сюда автоматически поступает доля всех торговых комиссий. Вывести ETH из казны невозможно — в контракте нет такой функции, деньги могут только выкупать токены платформы. Всё, что происходит с казной, видно ниже — это публичные транзакции блокчейна.")}
      </div>

      {error && <div className="error">{error}</div>}
      {!state && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {state && (
        <>
          <div className="ana-grid" style={{ margin: "18px 0 8px" }}>
            <div className="ana-card">
              <div className="k">{t("Баланс казны")}</div>
              <div className="v" style={{ color: "var(--gold)", fontSize: 26 }}>
                {fmtEth(Number(formatEther(state.bal)))} ETH
              </div>
              <div className="s">{dollars(Number(formatEther(state.bal)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Получено за всё время")}</div>
              <div className="v" style={{ fontSize: 26 }}>{fmtEth(Number(formatEther(state.received)))} ETH</div>
              <div className="s">{dollars(Number(formatEther(state.received)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Потрачено на выкупы")}</div>
              <div className="v" style={{ fontSize: 26 }}>{fmtEth(Number(formatEther(state.spent)))} ETH</div>
              <div className="s">{dollars(Number(formatEther(state.spent)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Сожжено токенов")}</div>
              <div className="v" style={{ fontSize: 26 }}>{fmt(state.burnedTotal, 0)}</div>
              <div className="s">{t("отправлены на dead-адрес навсегда")}</div>
            </div>
          </div>

          <div className="verify-note" style={{ marginBottom: 18 }}>
            <b style={{ color: "var(--leaf)" }}>✓ {t("Код верифицирован")}</b> · {t("Не верьте на слово — откройте контракт казны в эксплорере и убедитесь сами:")}{" "}
            <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer">
              {t("Контракт казны")} →
            </a>
          </div>

          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs"><div className="bt-tab on">{t("История операций")}</div></div>
            {state.rows.length === 0 && <div className="center">{t("Операций пока нет.")}</div>}
            {state.rows.map((r, i) => {
              const k = KIND[r.kind];
              return (
                <a className="trs-row" key={i} href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer">
                  <span className={`trs-kind ${k.cls}`}>{k.icon} {t(k.label)}</span>
                  <span>
                    {r.kind === "burn"
                      ? <>{fmt(r.tokens, 0)} <b>${r.sym}</b></>
                      : <>{fmtEth(r.eth)} ETH <span className="usd-sub">({dollars(r.eth)})</span></>}
                  </span>
                  <span className="dim">
                    {r.kind === "in" && <span className="mono">{short(r.who)}</span>}
                    {r.kind === "buy" && <>→ {fmt(r.tokens, 0)} <b>${r.sym}</b></>}
                    {r.kind === "burn" && <>🔥</>}
                  </span>
                  <span className="dim" style={{ textAlign: "right" }}>
                    {r.ts ? timeAgo(r.ts) : `#${r.block}`}
                  </span>
                </a>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
