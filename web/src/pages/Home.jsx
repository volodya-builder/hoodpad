import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt } from "../lib/web3.js";
import { factoryAbi, poolAbi, tokenAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS } from "../lib/config.js";

const PAGE = 24n;

async function loadTokens() {
  const count = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "tokenCount",
  });
  if (count === 0n) return [];
  const offset = count > PAGE ? count - PAGE : 0n;
  const addrs = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "tokens",
    args: [offset, PAGE],
  });

  const items = await Promise.all(
    addrs.map(async (token) => {
      const pool = await publicClient.readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "poolOf",
        args: [token],
      });
      const [name, symbol, price, sold, cap, reserve, graduated] =
        await Promise.all([
          publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
          publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "spotPrice" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "tokensSold" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "saleCap" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "ethReserve" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }),
        ]);
      return { token, pool, name, symbol, price, sold, cap, reserve, graduated };
    })
  );
  return items.reverse(); // newest first
}

export default function Home() {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadTokens()
      .then((t) => alive && setTokens(t))
      .catch((e) => alive && setError(e.shortMessage || e.message));
    const id = setInterval(() => {
      loadTokens().then((t) => alive && setTokens(t)).catch(() => {});
    }, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Лаунчпад Robinhood Chain</div>
        <h1>
          Честный запуск —<br />
          <span className="gold">закон Шервуда</span>
        </h1>
        <p className="sub">
          Токен запускается одной транзакцией и живёт по правилам, которые не
          может изменить никто: фиксированный сапплай, прозрачная кривая цены,
          ликвидность заперта навсегда. Без пресейлов. Без привилегий. Для всех.
        </p>
        <div className="hero-cta">
          <a className="btn btn-primary" href="#/create" style={{ padding: "14px 30px" }}>
            Запустить свой токен
          </a>
        </div>
        <div className="feature-chips">
          <span className="chip">Запуск: <b>0 ETH</b></span>
          <span className="chip">Создателю: <b>20% комиссий</b></span>
          <span className="chip">Ликвидность: <b>заперта навсегда</b></span>
          <span className="chip">Защита от снайперов: <b>встроена</b></span>
        </div>
        <div className="forest"></div>
      </section>

      {error && <div className="error">{error}</div>}
      {!tokens && !error && <div className="center">Loading tokens…</div>}
      {tokens && tokens.length === 0 && (
        <div className="center">No tokens yet — be the first to launch.</div>
      )}

      <div className="grid">
        {tokens?.map((t) => {
          const progress = Number((t.sold * 10000n) / t.cap) / 100;
          const mcapEth =
            Number(formatEther(t.price)) * 1_000_000_000; // price per token * 1B supply
          return (
            <a key={t.token} className="card" href={`#/token/${t.token}`}>
              <div className="card-title">
                <h3>{t.name}</h3>
                <span className="ticker">${t.symbol}</span>
              </div>
              <div className="stat-row">
                <span>Market cap</span>
                <b>{fmt(mcapEth, 2)} ETH</b>
              </div>
              <div className="stat-row">
                <span>Raised</span>
                <b>{fmt(formatEther(t.reserve), 3)} / 6.5 ETH</b>
              </div>
              {t.graduated ? (
                <div style={{ marginTop: 14 }}>
                  <span className="badge">🎯 В яблочке · на DEX</span>
                </div>
              ) : (
                <div className="progress">
                  <div style={{ width: `${Math.min(progress, 100)}%` }} />
                </div>
              )}
            </a>
          );
        })}
      </div>
    </>
  );
}
