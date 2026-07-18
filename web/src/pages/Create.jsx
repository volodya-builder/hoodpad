import React, { useState } from "react";
import { parseEther, decodeEventLog } from "viem";
import { publicClient } from "../lib/web3.js";
import { factoryAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS } from "../lib/config.js";

export default function Create({ wallet, onConnect }) {
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    image: "",
    initialBuy: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!wallet) return onConnect();
    if (!form.name.trim() || !form.symbol.trim()) {
      return setError("Name and ticker are required.");
    }
    setBusy(true);
    try {
      // Metadata as a self-contained data URI (no external hosting needed).
      const metadata = {
        description: form.description.trim(),
        image: form.image.trim(),
      };
      const uri =
        "data:application/json;base64," +
        btoa(unescape(encodeURIComponent(JSON.stringify(metadata))));

      const value = form.initialBuy ? parseEther(form.initialBuy) : 0n;
      const hash = await wallet.walletClient.writeContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "createToken",
        args: [form.name.trim(), form.symbol.trim().toUpperCase(), uri],
        value,
      });
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      const created = rcpt.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((ev) => ev && ev.eventName === "TokenCreated");
      window.location.hash = `#/token/${created.args.token}`;
    } catch (err) {
      setError(err.shortMessage || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Launch a token</h2>
      <p className="dim">
        1B fixed supply · 80% sold on the bonding curve · graduates to a locked
        DEX pool at 6.5 ETH · you earn 50% of every trade fee.
      </p>

      <label>Name</label>
      <input value={form.name} onChange={set("name")} placeholder="Volodya Coin" maxLength={48} />

      <label>Ticker</label>
      <input value={form.symbol} onChange={set("symbol")} placeholder="VOLO" maxLength={12} />

      <label>Description (optional)</label>
      <textarea rows={3} value={form.description} onChange={set("description")} placeholder="What is this token about?" />

      <label>Image URL (optional)</label>
      <input value={form.image} onChange={set("image")} placeholder="https://…" />

      <label>Initial buy in ETH (optional — you get the first fill, snipe protection)</label>
      <input value={form.initialBuy} onChange={set("initialBuy")} placeholder="0.1" inputMode="decimal" />

      <div style={{ marginTop: 24 }}>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Launching…" : wallet ? "Launch token" : "Connect wallet to launch"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
