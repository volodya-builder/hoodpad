import React, { useEffect, useState, useCallback } from "react";
import { parseEther, formatEther } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { factoryAbi, poolAbi, tokenAbi, treasuryAbi, poolExtraAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS, TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";
import { poolTrades } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import Chat from "./Chat.jsx";
import { useSplit } from "../lib/data.js";

const SLIPPAGE_BPS = 300n; // 3%

function MiniChart({ points }) {
  if (!points || points.length < 2) {
    return <div className="dim" style={{ padding: "20px 0" }}>График появится после первых сделок.</div>;
  }
  const W = 640, H = 180, PADB = 6, PADT = 8;
  let mn = Infinity, mx = -Infinity;
  points.forEach((p) => { mn = Math.min(mn, p.mcap); mx = Math.max(mx, p.mcap); });
  if (mx - mn < mx * 0.02) { mx *= 1.01; mn *= 0.99; }
  const X = (i) => (i / (points.length - 1)) * (W - 8) + 4;
  const Y = (v) => PADT + (1 - (v - mn) / (mx - mn)) * (H - PADT - PADB);
  const line = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.mcap).toFixed(1)}`).join(" ");
  const area = `${line} L${X(points.length - 1).toFixed(1)} ${H - PADB} L4 ${H - PADB} Z`;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", marginTop: 8 }}>
      <defs>
        <linearGradient id="tokAreaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9c94b" stopOpacity=".25" />
          <stop offset="1" stopColor="#b9c94b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tokAreaG)" />
      <path d={line} fill="none" stroke="#b9c94b" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={X(points.length - 1)} cy={Y(last.mcap)} r="4" fill="#dcea5c" stroke="#0d0e0c" strokeWidth="2" />
    </svg>
  );
}

export default function TokenPage({ tokenAddress, wallet, onConnect }) {
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
    if (wallet) {
      balance = await publicClient.readContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [wallet.account],
      });
    }
    setData({ pool, name, symbol, uri, price, sold, cap, reserve, graduated, migrated, creator, balance });
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
    const [h, creatorFees, treasuryOwner, treasuryHeld, burned] = await Promise.all([
      poolTrades(data.pool),
      publicClient.readContract({ address: data.pool, abi: poolExtraAbi, functionName: "creatorFeesAccrued" }),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "owner" }).catch(() => null),
      publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [TREASURY_ADDRESS] }).catch(() => 0n),
      publicClient.readContract({ address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "burnedOf", args: [tokenAddress] }).catch(() => 0n),
    ]);
    setHistory(h);
    setExtra({ creatorFees, treasuryOwner, treasuryHeld, burned });
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
      let hash;
      if (tab === "buy") {
        const minOut = quote.value - (quote.value * SLIPPAGE_BPS) / 10000n;
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
        const minOut = quote.value - (quote.value * SLIPPAGE_BPS) / 10000n;
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

  if (!data) return <div className="center">{error || "Loading token…"}</div>;

  const progress = Number((data.sold * 10000n) / data.cap) / 100;
  const mcapEth = Number(formatEther(data.price)) * 1_000_000_000;
  const mcapUsd = usd(mcapEth * rate);

  return (
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
              <div className="k">Price</div>
              <div className="v">{fmt(formatEther(data.price), 9)} ETH</div>
            </div>
            <div className="stat-card">
              <div className="k">Капитализация</div>
              <div className="v">{mcapUsd}</div>
            </div>
            <div className="stat-card">
              <div className="k">Raised</div>
              <div className="v">{fmt(formatEther(data.reserve), 3)} ETH</div>
            </div>
            <div className="stat-card">
              <div className="k">Curve progress</div>
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
              <div className="k">Комиссии создателя</div>
              <div className="v" style={{ color: "var(--gold)" }}>
                {fmt(formatEther(extra.creatorFees ?? 0n), 5)} ETH
              </div>
            </div>
            {extra.burned > 0n && (
              <div className="stat-card">
                <div className="k">Сожжено казной</div>
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
              Забрать комиссии создателя
            </button>
          )}

          <p className="dim" style={{ marginTop: 18 }}>
            Токен:{" "}
            <a className="mono" href={`${EXPLORER}/address/${tokenAddress}`} target="_blank" rel="noreferrer">
              {short(tokenAddress)}
            </a>
            {" · "}Пул:{" "}
            <a className="mono" href={`${EXPLORER}/address/${data.pool}`} target="_blank" rel="noreferrer">
              {short(data.pool)}
            </a>
            {" · "}Создатель: <span className="mono">{short(data.creator)}</span>
          </p>
        </div>

        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="card-title"><h3>Капитализация по сделкам</h3></div>
          <MiniChart points={history?.points} />
        </div>

        <div className="card" style={{ cursor: "default", transform: "none", marginTop: 18 }}>
          <div className="card-title"><h3>Сделки из блокчейна</h3></div>
          {!history && <div className="dim" style={{ padding: "14px 0" }}>Читаю события…</div>}
          {history && history.trades.length === 0 && (
            <div className="dim" style={{ padding: "14px 0" }}>Пока нет сделок.</div>
          )}
          {history && history.trades.slice(0, 12).map((tr, i) => (
            <div className="trow" key={i}>
              <span className={tr.side === "buy" ? "side-buy" : "side-sell"}>
                {tr.side === "buy" ? "Купил" : "Продал"}
              </span>
              <span>{fmt(tr.eth, 5)} ETH</span>
              <span>{fmt(tr.tokens, 0)}</span>
              <a className="mono" href={`${EXPLORER}/tx/${tr.tx}`} target="_blank" rel="noreferrer">
                {short(tr.addr)}
              </a>
              <span className="dim">блок {String(tr.block)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        {data.graduated ? (
          data.migrated ? (
            <div className="panel" style={{ margin: 0, maxWidth: "none" }}>
              <div className="notice">
                This token graduated — liquidity is locked on the DEX. Trade it there.
              </div>
            </div>
          ) : (
            <div className="panel" style={{ margin: 0, maxWidth: "none" }}>
              <div className="notice">
                Curve complete! Anyone can trigger the liquidity migration.
              </div>
              <button className="btn btn-primary btn-block" onClick={migrate} disabled={busy}>
                {busy ? "Migrating…" : "Migrate liquidity to DEX"}
              </button>
              {error && <div className="error">{error}</div>}
            </div>
          )
        ) : (
          <div className="panel" style={{ margin: 0, maxWidth: "none" }}>
            <div className="tabs">
              <div className={`tab ${tab === "buy" ? "active-buy" : ""}`} onClick={() => { setTab("buy"); setAmount(""); }}>
                Buy
              </div>
              <div className={`tab ${tab === "sell" ? "active-sell" : ""}`} onClick={() => { setTab("sell"); setAmount(""); }}>
                Sell
              </div>
            </div>

            <label>{tab === "buy" ? "You pay (ETH)" : `You sell (${data.symbol})`}</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
            />
            {tab === "sell" && wallet && (
              <p className="dim" style={{ margin: "6px 0 0" }}>
                Balance: {fmt(formatEther(data.balance), 2)}{" "}
                <a href="#/" onClick={(e) => { e.preventDefault(); setAmount(formatEther(data.balance)); }}>
                  max
                </a>
              </p>
            )}

            {quote && (
              <div className="quote-box">
                <span>You receive (est.)</span>
                <b>
                  {tab === "buy"
                    ? `${fmt(formatEther(quote.value), 2)} ${data.symbol}`
                    : `${fmt(formatEther(quote.value), 6)} ETH`}
                </b>
              </div>
            )}

            <button
              className={`btn btn-block ${tab === "buy" ? "btn-primary" : "btn-danger"}`}
              onClick={trade}
              disabled={busy || (!quote && !!wallet)}
            >
              {busy
                ? "Confirming…"
                : !wallet
                ? "Connect wallet"
                : tab === "buy"
                ? `Buy ${data.symbol}`
                : `Sell ${data.symbol}`}
            </button>
            <p className="dim" style={{ marginTop: 12 }}>
              Комиссия 1% · слиппедж 3% · {split.creator}% создателю{split.team > 0 ? ` · ${split.team}% команде` : ""} · {split.buyback}% на выкуп
            </p>
            {error && <div className="error">{error}</div>}
          </div>
        )}

        {isTreasuryOwner && !data.graduated && (
          <div className="panel" style={{ margin: "18px 0 0", maxWidth: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 14 }}>Выкуп из казны</b>
              <TreasuryBalance />
            </div>
            <p className="dim" style={{ margin: "8px 0 10px" }}>
              Режим владельца платформы: казна купит этот токен с рынка.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={bbAmt}
                onChange={(e) => setBbAmt(e.target.value)}
                placeholder="0.001"
                inputMode="decimal"
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                disabled={busy || !bbAmt}
                onClick={() => sendTx(TREASURY_ADDRESS, treasuryAbi, "buyback", [tokenAddress, parseEther(bbAmt), 0n])}
              >
                Выкупить
              </button>
            </div>
            <div className="dim" style={{ marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>В казне: {fmt(formatEther(extra.treasuryHeld ?? 0n), 0)} {data.symbol}</span>
              {(extra.treasuryHeld ?? 0n) > 0n && (
                <a
                  style={{ color: "var(--red)", cursor: "pointer" }}
                  onClick={() => sendTx(TREASURY_ADDRESS, treasuryAbi, "burn", [tokenAddress, extra.treasuryHeld])}
                >
                  Сжечь 🔥
                </a>
              )}
            </div>
          </div>
        )}

        <Chat tokenAddress={tokenAddress} wallet={wallet} onConnect={onConnect} />
      </div>
    </div>
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
  return <span className="dim">{bal === null ? "…" : `${fmt(formatEther(bal), 5)} ETH доступно`}</span>;
}
