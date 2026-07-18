import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { publicClient, fmt, short } from "../lib/web3.js";
import { useEthUsd, usd } from "../lib/price.js";
import { useSplit, timeAgo, loadTokens, tradeEvents } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

/** Живая лента последних сделок по всем пулам платформы. */
function LiveFeed({ tokens }) {
  const { t } = useLang();
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;
    let alive = true;
    const byPool = {};
    tokens.forEach((tk) => { byPool[tk.pool.toLowerCase()] = { sym: tk.symbol, token: tk.token }; });
    const pools = tokens.map((tk) => tk.pool);

    async function pull() {
      const logs = await publicClient.getLogs({
        address: pools, events: tradeEvents, fromBlock: 0n, toBlock: "latest",
      });
      if (logs.length === 0) { if (alive) setItems([]); return; }
      logs.sort((a, b) => Number(b.blockNumber - a.blockNumber) || (b.logIndex - a.logIndex));
      const top = logs.slice(0, 12);
      const minB = Number(top[top.length - 1].blockNumber);
      const [latest, oldest] = await Promise.all([
        publicClient.getBlock(),
        publicClient.getBlock({ blockNumber: BigInt(minB) }),
      ]);
      const span = Number(latest.number) - minB;
      const avg = span > 0 ? (Number(latest.timestamp) - Number(oldest.timestamp)) / span : 0;
      const list = top.map((l) => {
        const isBuy = l.eventName === "Buy";
        const info = byPool[l.address.toLowerCase()] ?? {};
        return {
          side: isBuy ? "buy" : "sell",
          addr: isBuy ? l.args.buyer : l.args.seller,
          eth: Number(isBuy ? l.args.ethIn : l.args.ethOut) / 1e18,
          sym: info.sym, token: info.token,
          ts: (Number(oldest.timestamp) + (Number(l.blockNumber) - minB) * avg) * 1000,
          key: l.transactionHash + String(l.logIndex),
        };
      }).filter((x) => x.token);
      if (alive) setItems(list);
    }
    pull().catch(() => {});
    const id = setInterval(() => pull().catch(() => {}), 15000);
    return () => { alive = false; clearInterval(id); };
  }, [tokens]);

  if (!items || items.length === 0) return null;
  return (
    <div className="feed-strip">
      <span className="feed-label">⚡ {t("Лента сделок")}</span>
      <div className="feed-scroll">
        {items.map((x) => (
          <a className="feed-chip" key={x.key} href={`#/token/${x.token}`}>
            <span className={x.side === "buy" ? "side-buy" : "side-sell"}>{x.side === "buy" ? "▲" : "▼"}</span>
            <span className="mono dim">{short(x.addr)}</span>
            <span>{t(x.side === "buy" ? "купил" : "продал")}</span>
            <b>${x.sym}</b>
            <span>{t("за")} {fmt(x.eth, 4)} ETH</span>
            <span className="dim">· {timeAgo(x.ts)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Король горы — самый близкий к градации токен. */
function KingCard({ king }) {
  const { t } = useLang();
  const rate = useEthUsd();
  if (!king) return null;
  const progress = Number((king.sold * 10000n) / king.cap) / 100;
  const mcapEth = Number(formatEther(king.price)) * 1_000_000_000;
  return (
    <a className="king-card" href={`#/token/${king.token}`}>
      <div className="king-img">{king.meta.image ? <img src={king.meta.image} alt="" /> : "🖼️"}</div>
      <div className="king-info">
        <div className="king-tag">👑 {t("Король горы")}</div>
        <div className="king-name">
          {king.name} <span className="ticker">${king.symbol}</span>
        </div>
        <div className="king-stats">
          {usd(mcapEth * rate)} MC · {fmt(Number(formatEther(king.reserve)), 3)} / 6.5 ETH
          {king.createdAt ? <> · {timeAgo(king.createdAt)}</> : null}
        </div>
        <div className="pbar king-bar">
          <div style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      </div>
      <div className="king-pct">{fmt(Math.min(progress, 100), 0)}%</div>
    </a>
  );
}

function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem("hood_favs") || "[]")); }
  catch (e) { return new Set(); }
}
function saveFavs(s) {
  try { localStorage.setItem("hood_favs", JSON.stringify([...s])); } catch (e) { /* ignore */ }
}

function TokenCard({ t, fav, onFav }) {
  const { t: tr } = useLang();
  const rate = useEthUsd();
  const progress = Number((t.sold * 10000n) / t.cap) / 100;
  const mcapEth = Number(formatEther(t.price)) * 1_000_000_000;
  return (
    <a className="tcard" href={`#/token/${t.token}`}>
      <div className="timg">
        {t.meta.image ? <img src={t.meta.image} alt="" /> : "🖼️"}
        {t.graduated && <span className="grad-chip">{tr("Градуировал")}</span>}
        <button className={`fav-btn ${fav ? "on" : ""}`}
                title={tr(fav ? "Убрать из избранного" : "В избранное")}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(t.token); }}>
          {fav ? "★" : "☆"}
        </button>
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
        <span>{t.createdAt ? timeAgo(t.createdAt) : `${fmt(Number(formatEther(t.reserve)), 3)} / 6.5 ETH`}</span>
      </div>
    </a>
  );
}

export default function Home({ onSearch }) {
  const { t } = useLang();
  const split = useSplit();
  const [gpage, setGpage] = useState(1);
  const GRAD_PER_PAGE = 10;
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("new");
  const [favs, setFavs] = useState(loadFavs);

  const toggleFav = (addr) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr); else next.add(addr);
      saveFavs(next);
      return next;
    });
  };

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
    let a = [...arr];
    if (sort === "fav") a = a.filter((x) => favs.has(x.token));
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
          ⌕ {t("Поиск токенов")} <span className="kbd">Ctrl K</span>
        </div>
        <a className="btn btn-primary" style={{ padding: "0 26px", display: "flex", alignItems: "center" }} href="#/create">
          {t("+ Создать")}
        </a>
      </div>
      <div className="page-sub">
        {t("Токены с фиксированным сапплаем на Robinhood Chain")} — {t("запуск в одну транзакцию")},{" "}
        {split.creator}% {t("создателю")}{split.team > 0 ? `, ${split.team}% ${t("команде")}` : ""},{" "}
        {split.buyback}% {t("в казну выкупа")}, {t("ликвидность запирается навсегда")}.
      </div>

      {error && <div className="error">{error}</div>}
      {!tokens && !error && <div className="center">{t("Загружаю токены из блокчейна…")}</div>}

      <LiveFeed tokens={tokens} />
      <KingCard
        king={(tokens ?? [])
          .filter((x) => !x.graduated && x.reserve > 0n)
          .sort((a, b) => (b.reserve > a.reserve ? 1 : -1))[0]}
      />

      <div className="grad-wrap">
        <div className="sec-head">
          <div>
            <h2 className="sec-h2">
              {t("Градуировали")} <span className="count-chip">{grad.length}</span>
            </h2>
            <div className="page-sub" style={{ margin: "7px 0 0" }}>
              {t("Прошли порог градации — ликвидность заперта на DEX.")}
            </div>
          </div>
        </div>
        {grad.length === 0 ? (
          <div className="center" style={{ padding: "26px 0 14px" }}>
            {t("Пока никто не градуировал — первым здесь станет токен, собравший 6.5 ETH.")}
          </div>
        ) : (
          <>
            <div className="tgrid">
              {grad.slice((gpage - 1) * GRAD_PER_PAGE, gpage * GRAD_PER_PAGE)
                   .map((t2) => <TokenCard key={t2.token} t={t2} fav={favs.has(t2.token)} onFav={toggleFav} />)}
            </div>
            {grad.length > GRAD_PER_PAGE && (
              <div className="pager">
                <div className="pg nav" onClick={() => setGpage(Math.max(1, gpage - 1))}>‹</div>
                {Array.from({ length: Math.ceil(grad.length / GRAD_PER_PAGE) }, (_, k) => k + 1).map((p) => (
                  <div key={p} className={`pg ${p === gpage ? "on" : ""}`} onClick={() => setGpage(p)}>{p}</div>
                ))}
                <div className="pg nav"
                     onClick={() => setGpage(Math.min(Math.ceil(grad.length / GRAD_PER_PAGE), gpage + 1))}>›</div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="sec-head">
        <div>
          <h2 className="sec-h2">
            {t("Обзор")} <span className="count-chip">{tokens?.length ?? 0} {t("запущено")}</span>
          </h2>
          <div className="page-sub" style={{ margin: "7px 0 0" }}>
            {t("Токены, летящие к градации на Robinhood Chain.")}
          </div>
        </div>
        <div className="pill-group">
          {[["new", t("Новые")], ["raised", t("Недавние покупки")], ["mcap", t("Капитализация")], ["fav", "★ " + t("Избранное")]].map(([k, lbl]) => (
            <div key={k} className={`fpill ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>
              {lbl}
            </div>
          ))}
        </div>
      </div>
      {live.length === 0 ? (
        <div className="center" style={{ paddingBottom: 60 }}>
          {sort === "fav" ? (
            t("Пока нет избранных — нажмите ☆ на карточке токена.")
          ) : (
            <>
              {t("Токенов пока нет — станьте первым.")}{" "}
              <a href="#/create" style={{ color: "var(--gold)" }}>{t("Запустить токен →")}</a>
            </>
          )}
        </div>
      ) : (
        <div className="tgrid" style={{ paddingBottom: 60 }}>
          {live.map((t2) => <TokenCard key={t2.token} t={t2} fav={favs.has(t2.token)} onFav={toggleFav} />)}
        </div>
      )}
    </>
  );
}
