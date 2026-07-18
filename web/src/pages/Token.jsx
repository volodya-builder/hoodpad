import React, { useEffect, useState, useCallback } from "react";
import { parseEther, formatEther } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { factoryAbi, poolAbi, tokenAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS, EXPLORER } from "../lib/config.js";

const SLIPPAGE_BPS = 300n; // 3%

export default function TokenPage({ tokenAddress, wallet, onConnect }) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState({});
  const [tab, setTab] = useState("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="token-layout">
      <div>
        <div className="card" style={{ cursor: "default", transform: "none" }}>
          <div className="card-title">
            <h3 style={{ fontSize: 24 }}>
              {data.name} <span className="ticker">${data.symbol}</span>
            </h3>
            {data.graduated && <span className="badge">Graduated</span>}
          </div>
          {meta.description && (
            <p className="dim" style={{ marginTop: 10 }}>{meta.description}</p>
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
              <div className="k">Market cap</div>
              <div className="v">{fmt(mcapEth, 2)} ETH</div>
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

          <p className="dim" style={{ marginTop: 18 }}>
            Token:{" "}
            <a className="mono" href={`${EXPLORER}/address/${tokenAddress}`} target="_blank" rel="noreferrer">
              {short(tokenAddress)}
            </a>
            {" · "}Pool:{" "}
            <a className="mono" href={`${EXPLORER}/address/${data.pool}`} target="_blank" rel="noreferrer">
              {short(data.pool)}
            </a>
            {" · "}Creator: <span className="mono">{short(data.creator)}</span>
          </p>
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
              Fee 1% · slippage tolerance 3% · creator earns 50% of fees
            </p>
            {error && <div className="error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
