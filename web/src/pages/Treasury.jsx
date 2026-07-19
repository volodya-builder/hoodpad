import React, { useEffect, useState } from "react";
import { formatEther, parseAbiItem } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { treasuryAbi } from "../lib/abi.js";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { loadTokens, timeAgo } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useLang } from "../lib/i18n.jsx";

const evReceived = parseAbiItem("event Received(address indexed from, uint256 amount)");
const evBuyback = parseAbiItem("event Buyback(address indexed token, address indexed pool, uint256 ethIn, uint256 tokensOut)");
const evBurned = parseAbiItem("event Burned(address indexed token, uint256 amount)");

export default function Treasury() {
  const { t } = useLang();
  const rate = useEthUsd();
  const [state, setState] = useState(null);
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
        publicClient.getBalance({ address: TREASURY_ADDRESS }),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => 0n),
      ]);
      const symByAddr = {};
      for (const tk of tokens) symByAddr[tk.token.toLowerCase()] = tk.symbol;

      // Сжигания суммарно по данным контракта
      const burnedPer = await Promise.all(tokens.map((tk) =>
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "burnedOf", args: [tk.token] }).catch(() => 0n)
      ));
      const burnedTotal = burnedPer.reduce((s, b) => s + Number(formatEther(b)), 0);

      // Полная история событий казны из блокчейна
      const logs = await publicClient.getLogs({
        address: TREASURY_ADDRESS,
        events: [evReceived, evBuyback, evBurned],
        fromBlock: 0n, toBlock: "latest",
      }).catch(() => []);
      logs.sort((a, b) => Number(b.blockNumber - a.blockNumber) || (b.logIndex - a.logIndex));

      // время — интерполяцией по блокам (2 RPC-вызова)
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

      const rows = items.map(({ l, ts }) => {
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

      if (!alive) return;
      setState({ bal, received, spent, burnedTotal, rows });
    })().catch((e) => alive && setError(e.shortMessage || e.message));
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
                {fmt(Number(formatEther(state.bal)), 5)} ETH
              </div>
              <div className="s">{dollars(Number(formatEther(state.bal)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Получено за всё время")}</div>
              <div className="v" style={{ fontSize: 26 }}>{fmt(Number(formatEther(state.received)), 5)} ETH</div>
              <div className="s">{dollars(Number(formatEther(state.received)))}</div>
            </div>
            <div className="ana-card">
              <div className="k">{t("Потрачено на выкупы")}</div>
              <div className="v" style={{ fontSize: 26 }}>{fmt(Number(formatEther(state.spent)), 5)} ETH</div>
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
                      : <>{fmt(r.eth, 5)} ETH <span className="usd-sub">({dollars(r.eth)})</span></>}
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
