import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { fmt, fmtEth } from "../lib/web3.js";
import { useEthUsd, usd } from "../lib/price.js";
import { timeAgo, loadTokens, useClock } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";

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
  const [cp, setCp] = useState(false);
  const progress = Number((t.sold * 10000n) / t.cap) / 100;
  const mcapEth = Number(formatEther(t.price)) * 1_000_000_000;
  const copyCA = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(t.token); } catch (err) { /* ignore */ }
    setCp(true); setTimeout(() => setCp(false), 1200);
  };
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
        <span className="mono addr-copy" title={tr("Скопировать адрес")} onClick={copyCA}>
          {t.token.slice(0, 6)}…{t.token.slice(-4)} {cp ? "✓" : "⧉"}
        </span>
        <span>{t.createdAt ? timeAgo(t.createdAt) : `${fmtEth(Number(formatEther(t.reserve)))} / 6.5 ETH`}</span>
      </div>
    </a>
  );
}

export default function Home({ onSearch }) {
  const { t } = useLang();
  useClock(1000); // «Nс назад» на карточках тикает каждую секунду
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
      {error && <div className="error">{error}</div>}
      {!tokens && !error && <div className="center">{t("Загружаю токены из блокчейна…")}</div>}

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
        {grad.length === 0 ? null : (
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
