import React, { useEffect, useMemo, useState } from "react";
import { formatEther, parseAbiItem } from "viem";
import { publicClient, fmt, fmtEth, short } from "../lib/web3.js";
import { parseAbi } from "viem";
import { treasuryAbi, poolExtraAbi } from "../lib/abi.js";

const poolExtraAbi2 = parseAbi(["function creator() view returns (address)"]);
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { useEthUsd, usd } from "../lib/price.js";
import { loadTokens, poolTrades, useSplit } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

const PERIODS = [
  ["24h", "24ч", 86400],
  ["week", "Неделя", 7 * 86400],
  ["month", "Месяц", 30 * 86400],
  ["all", "Всё время", 0],
];

const PERIOD_LABEL = {
  "24h": "за 24 часа", week: "за неделю", month: "за месяц", all: "за всё время",
};

const buybackEvent = parseAbiItem(
  "event Buyback(address indexed token, address indexed pool, uint256 ethIn, uint256 tokensOut)"
);

/** Мини-гистограмма как на карточках аналитики. */
function Bars({ data }) {
  const max = Math.max(...data, 0);
  return (
    <div className="ana-bars">
      {data.map((v, i) => (
        <div
          key={i}
          className={`ana-bar ${v > 0 ? "on" : ""}`}
          style={{ height: max > 0 && v > 0 ? `${Math.max(6, (v / max) * 100)}%` : "3px" }}
        />
      ))}
    </div>
  );
}

// Память вкладки между заходами
let _anaRaw = null;

export default function Analytics() {
  const { t } = useLang();
  const split = useSplit();
  const rate = useEthUsd();
  const [raw, setRaw] = useState(_anaRaw);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = await loadTokens();

      // Все сделки всех пулов + доля создателя конкретного пула на каждой сделке.
      const all = await Promise.all(tokens.map(async (tk) => {
        const [h, shareBps, creator] = await Promise.all([
          poolTrades(tk.pool).catch(() => ({ trades: [] })),
          publicClient.readContract({ address: tk.pool, abi: poolExtraAbi, functionName: "creatorFeeShareBps" }).catch(() => 2000),
          tk.creator
            ? Promise.resolve(tk.creator)
            : publicClient.readContract({ address: tk.pool, abi: poolExtraAbi2, functionName: "creator" }).catch(() => null),
        ]);
        return { tk, creator, shareBps: Number(shareBps),
                 trades: h.trades.map((tr) => ({ ...tr, shareBps: Number(shareBps) })) };
      }));
      const trades = all.flatMap((a) => a.trades);

      // Лидерборды: создатели по заработанным комиссиям, трейдеры по объёму
      const creatorsMap = {};
      for (const a of all) {
        if (!a.creator) continue;
        const key = a.creator.toLowerCase();
        const earned = a.trades.reduce((s, tr) => s + tr.fee, 0) * (a.shareBps / 10000);
        const c = creatorsMap[key] ?? { earned: 0, symbols: [] };
        c.earned += earned;
        c.symbols.push(a.tk.symbol);
        creatorsMap[key] = c;
      }
      const tradersMap = {};
      for (const tr of trades) {
        const k = tr.addr.toLowerCase();
        const x = tradersMap[k] ?? { volume: 0, count: 0 };
        x.volume += tr.eth + tr.fee;
        x.count += 1;
        tradersMap[k] = x;
      }
      const leaders = {
        creators: Object.entries(creatorsMap).sort((a, b) => b[1].earned - a[1].earned).slice(0, 10),
        traders: Object.entries(tradersMap).sort((a, b) => b[1].volume - a[1].volume).slice(0, 10),
      };

      // Оценка времени каждой сделки: интерполяция по номерам блоков
      // (2 RPC-вызова вместо сотен getBlock).
      let now = Date.now();
      if (trades.length > 0) {
        const blocks = trades.map((tr) => Number(tr.block));
        const minB = Math.min(...blocks);
        const [latest, oldest] = await Promise.all([
          publicClient.getBlock(),
          publicClient.getBlock({ blockNumber: BigInt(minB) }),
        ]);
        const span = Number(latest.number) - minB;
        const avg = span > 0
          ? (Number(latest.timestamp) - Number(oldest.timestamp)) / span
          : 0;
        for (const tr of trades) {
          tr.ts = (Number(oldest.timestamp) + (Number(tr.block) - minB) * avg) * 1000;
        }
        now = Number(latest.timestamp) * 1000;
      }

      // Казна: баланс, счётчики, сколько токенов куплено и сожжено.
      const [treBal, received, spent] = await Promise.all([
        publicClient.getBalance({ address: TREASURY_ADDRESS }),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalReceived" }).catch(() => 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "totalSpent" }).catch(() => 0n),
      ]);
      const bb = await Promise.all(tokens.map((tk) => Promise.all([
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "boughtOf", args: [tk.token] }).catch(() => 0n),
        publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "burnedOf", args: [tk.token] }).catch(() => 0n),
      ])));
      const bought = bb.reduce((s, [b]) => s + Number(formatEther(b)), 0);
      const burned = bb.reduce((s, [, x]) => s + Number(formatEther(x)), 0);
      const buybackCount = await publicClient
        .getLogs({ address: TREASURY_ADDRESS, event: buybackEvent, fromBlock: 0n, toBlock: "latest" })
        .then((l) => l.length)
        .catch(() => null);

      if (!alive) return;
      _anaRaw = {
        trades, now,
        launches: tokens.length,
        grads: tokens.filter((tk) => tk.graduated).length,
        treBal, received, spent, bought, burned, buybackCount, leaders,
      };
      setRaw(_anaRaw);
    })().catch((e) => alive && setError(e.shortMessage || e.message));
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => {
    if (!raw) return null;
    const secs = PERIODS.find(([k]) => k === period)[2];
    const cutoff = secs > 0 ? raw.now - secs * 1000 : 0;
    const filtered = raw.trades.filter((tr) => !cutoff || (tr.ts ?? 0) >= cutoff);

    const volume = filtered.reduce((s, tr) => s + tr.eth + tr.fee, 0);
    const creatorPaid = filtered.reduce((s, tr) => s + tr.fee * (tr.shareBps / 10000), 0);

    // 14 корзин для мини-графиков.
    const N = 14;
    const t0 = cutoff || (filtered.length
      ? Math.min(...filtered.map((tr) => tr.ts ?? raw.now))
      : raw.now - 86400 * 1000);
    const w = Math.max(1, (raw.now - t0) / N);
    const volBars = Array(N).fill(0);
    const cntBars = Array(N).fill(0);
    for (const tr of filtered) {
      const i = Math.min(N - 1, Math.max(0, Math.floor(((tr.ts ?? raw.now) - t0) / w)));
      volBars[i] += tr.eth + tr.fee;
      cntBars[i] += 1;
    }
    return { volume, creatorPaid, count: filtered.length, volBars, cntBars };
  }, [raw, period]);

  const gradRate = raw && raw.launches > 0
    ? Math.round((raw.grads / raw.launches) * 100) : 0;

  return (
    <>
      <div className="page-title">{t("Аналитика протокола")}</div>
      <div className="page-sub">{t("Все цифры читаются напрямую из контрактов hood в Robinhood Chain.")}</div>

      <div className="pill-group ana-tabs">
        {PERIODS.map(([k, lbl]) => (
          <div key={k} className={`fpill ${period === k ? "on" : ""}`} onClick={() => setPeriod(k)}>
            {t(lbl)}
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {!stats && !error && <div className="center">{t("Читаю блокчейн…")}</div>}

      {stats && raw && (
        <div className="ana-grid">
          <div className="ana-card">
            <div className="k">{t("Объём торгов")}</div>
            <div className="v">{fmtEth(stats.volume)} ETH</div>
            <div className="s">{stats.count} {t("сделок")} · {t(PERIOD_LABEL[period])}</div>
            <Bars data={stats.volBars} />
          </div>
          <div className="ana-card">
            <div className="k">{t("Сделки")}</div>
            <div className="v">{stats.count}</div>
            <div className="s">{t(PERIOD_LABEL[period])}</div>
            <Bars data={stats.cntBars} />
          </div>
          <div className="ana-card">
            <div className="k">{t("Запуски токенов")}</div>
            <div className="v">{raw.launches}</div>
            <div className="s">
              {raw.grads} {t("градаций")} · {t("доля градаций")} {gradRate}%
            </div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Выплачено создателям")}</div>
            <div className="v" style={{ color: "var(--gold)" }}>{fmtEth(stats.creatorPaid)} ETH</div>
            <div className="s">{split.creator}% {t("всех комиссий — с первого трейда")}</div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Казна выкупа")}</div>
            <div className="v" style={{ color: "var(--gold)" }}>{fmtEth(Number(formatEther(raw.treBal)))} ETH</div>
            <div className="s">
              {t("получено")} {fmtEth(Number(formatEther(raw.received)))} · {t("выкуплено на")} {fmtEth(Number(formatEther(raw.spent)))}
              {" · "}
              <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
                {t("контракт")}
              </a>
            </div>
          </div>
          <div className="ana-card">
            <div className="k">{t("Выкуплено и сожжено")}</div>
            <div className="v">{fmt(raw.burned, 0)}</div>
            <div className="s">
              {t("токенов сожжено навсегда")} · {t("куплено казной")} {fmt(raw.bought, 0)}
              {raw.buybackCount !== null && <> · {raw.buybackCount} {t("выкупов")}</>}
            </div>
          </div>
        </div>
      )}

      {raw?.leaders && (raw.leaders.creators.length > 0 || raw.leaders.traders.length > 0) && (
        <div className="lb-grid">
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs"><div className="bt-tab on">🏆 {t("Топ создателей")}</div></div>
            {raw.leaders.creators.length === 0 && <div className="center">{t("Пока пусто.")}</div>}
            {raw.leaders.creators.map(([addr, c], i) => (
              <a className="lb-row" key={addr} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <span className={i < 3 ? `rank-num rk${i + 1}` : "dim"}>{i + 1}</span>
                <span className="lb-who">
                  <span className="mono">{short(addr)}</span>
                  <span className="lb-syms">{c.symbols.map((s) => `$${s}`).join(" ")}</span>
                </span>
                <span className="lb-val" style={{ color: "var(--gold)" }}>
                  {fmtEth(c.earned)} ETH <span className="usd-sub">({usd(c.earned * rate)})</span>
                </span>
              </a>
            ))}
          </div>
          <div className="bottom-card" style={{ marginTop: 0 }}>
            <div className="bt-tabs"><div className="bt-tab on">⚡ {t("Топ трейдеров")}</div></div>
            {raw.leaders.traders.length === 0 && <div className="center">{t("Пока пусто.")}</div>}
            {raw.leaders.traders.map(([addr, x], i) => (
              <a className="lb-row" key={addr} href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <span className={i < 3 ? `rank-num rk${i + 1}` : "dim"}>{i + 1}</span>
                <span className="lb-who">
                  <span className="mono">{short(addr)}</span>
                  <span className="lb-syms">{x.count} {t("сделок")}</span>
                </span>
                <span className="lb-val">
                  {fmtEth(x.volume)} ETH <span className="usd-sub">({usd(x.volume * rate)})</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="ana-note">
        {t("Примечание: комиссии попадают в казну после вызова claimProtocolFees у пула — до этого они накапливаются в самом пуле.")}
      </div>
    </>
  );
}
