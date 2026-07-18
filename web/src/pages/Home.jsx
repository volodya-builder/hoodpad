import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt } from "../lib/web3.js";
import { useEthUsd, usd } from "../lib/price.js";
import { factoryAbi, poolAbi, tokenAbi } from "../lib/abi.js";
import { FACTORY_ADDRESS } from "../lib/config.js";

const PAGE = 48n;

function parseMeta(uri) {
  try {
    if (uri?.startsWith("data:application/json;base64,")) {
      return JSON.parse(decodeURIComponent(escape(atob(uri.split(",")[1]))));
    }
  } catch (e) { /* ignore malformed metadata */ }
  return {};
}

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
      const [name, symbol, uri, price, sold, cap, reserve, graduated] =
        await Promise.all([
          publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
          publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
          publicClient.readContract({ address: token, abi: tokenAbi, functionName: "metadataURI" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "spotPrice" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "tokensSold" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "saleCap" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "ethReserve" }),
          publicClient.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }),
        ]);
      return {
        token, pool, name, symbol, price, sold, cap, reserve, graduated,
        meta: parseMeta(uri),
      };
    })
  );
  return items.reverse(); // newest first
}

function TokenCard({ t }) {
  const rate = useEthUsd();
  const progress = Number((t.sold * 10000n) / t.cap) / 100;
  const mcapEth = Number(formatEther(t.price)) * 1_000_000_000;
  return (
    <a className="tcard" href={`#/token/${t.token}`}>
      <div className="timg">
        {t.meta.image ? <img src={t.meta.image} alt="" /> : "🖼️"}
        {t.graduated && <span className="grad-chip">Градуировал</span>}
      </div>
      <div className="tname">{t.name}</div>
      <div className="ttick">${t.symbol}</div>
      <div className="tmc">
        {usd(mcapEth * rate)}<span>MC</span>
      </div>
      <div className="prow">
        <div className="pbar">
          <div style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        <span className="pv">{fmt(Math.min(progress, 100), 0)}%</span>
      </div>
      <div className="tmeta">
        <span className="mono">{t.token.slice(0, 6)}…{t.token.slice(-4)}</span>
        <span>{fmt(Number(formatEther(t.reserve)), 3)} / 6.5 ETH</span>
      </div>
    </a>
  );
}

export default function Home({ onSearch }) {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("new");

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

  const bySort = (arr) => {
    const a = [...arr];
    if (sort === "mcap") a.sort((x, y) => Number(y.price - x.price));
    if (sort === "raised") a.sort((x, y) => Number(y.reserve - x.reserve));
    return a; // "new": loader already returns newest first
  };
  const live = bySort(tokens?.filter((t) => !t.graduated) ?? []);
  const grad = bySort(tokens?.filter((t) => t.graduated) ?? []);

  return (
    <>
      <div className="search-row">
        <div className="big-search" onClick={onSearch}>
          ⌕ Поиск токенов <span className="kbd">Ctrl K</span>
        </div>
        <a className="btn btn-primary" style={{ padding: "0 26px", display: "flex", alignItems: "center" }} href="#/create">
          + Создать
        </a>
      </div>
      <div className="page-sub">
        Токены с фиксированным сапплаем на Robinhood Chain — запуск в одну
        транзакцию, 20% комиссий создателю, 80% в казну выкупа, ликвидность
        запирается навсегда.
      </div>

      {error && <div className="error">{error}</div>}
      {!tokens && !error && <div className="center">Загружаю токены из блокчейна…</div>}
      {tokens && tokens.length === 0 && (
        <div className="center">
          Токенов пока нет — станьте первым.{" "}
          <a href="#/create" style={{ color: "var(--gold)" }}>Запустить токен →</a>
        </div>
      )}

      {grad.length > 0 && (
        <div className="grad-wrap">
          <div className="sec-head">
            <div>
              <h2 className="sec-h2">
                Градуировали <span className="count-chip">{grad.length}</span>
              </h2>
              <div className="page-sub" style={{ margin: "7px 0 0" }}>
                Прошли порог градации — ликвидность заперта на DEX.
              </div>
            </div>
          </div>
          <div className="tgrid">
            {grad.map((t) => <TokenCard key={t.token} t={t} />)}
          </div>
        </div>
      )}

      {live.length > 0 && (
        <>
          <div className="sec-head">
            <div>
              <h2 className="sec-h2">
                На кривой <span className="count-chip">{live.length}</span>
              </h2>
              <div className="page-sub" style={{ margin: "7px 0 0" }}>
                Летят к градации — сбор 6.5 ETH.
              </div>
            </div>
            <div className="pill-group">
              {[["new", "Новые"], ["raised", "Недавние покупки"], ["mcap", "Капитализация"]].map(([k, lbl]) => (
                <div key={k} className={`fpill ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>
                  {lbl}
                </div>
              ))}
            </div>
          </div>
          <div className="tgrid" style={{ paddingBottom: 60 }}>
            {live.map((t) => <TokenCard key={t.token} t={t} />)}
          </div>
        </>
      )}
    </>
  );
}
