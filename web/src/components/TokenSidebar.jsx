import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { loadTokens, subgraphVolumes24 } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { fmtEth } from "../lib/web3.js";
import { useLang } from "../lib/i18n.jsx";

// Боковой список монет на странице токена: поиск, избранное, сортировки.
function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem("hood_favs") || "[]")); }
  catch (e) { return new Set(); }
}
function saveFavs(s) {
  try { localStorage.setItem("hood_favs", JSON.stringify([...s])); } catch (e) { /* ignore */ }
}

export default function TokenSidebar({ current }) {
  const { t } = useLang();
  const rate = useEthUsd();
  const [tokens, setTokens] = useState(null);
  const [vols, setVols] = useState({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("vol");
  const [favs, setFavs] = useState(loadFavs);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      loadTokens().then((x) => alive && setTokens(x)).catch(() => {});
      subgraphVolumes24().then((v) => alive && setVols(v)).catch(() => {});
    };
    pull();
    const id = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const toggleFav = (addr) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr); else next.add(addr);
      saveFavs(next);
      return next;
    });
  };

  const volOf = (tok) => vols[(tok.pool || "").toLowerCase()] || 0;
  const mcapOf = (tok) => Number(formatEther(tok.price)) * 1e9;

  let list = tokens ?? [];
  if (q.trim()) {
    const s = q.trim().toLowerCase();
    list = list.filter((x) => x.name.toLowerCase().includes(s) || x.symbol.toLowerCase().includes(s));
  }
  if (sort === "fav") list = list.filter((x) => favs.has(x.token));
  list = [...list];
  if (sort === "vol") list.sort((a, b) => volOf(b) - volOf(a));
  if (sort === "mcap") list.sort((a, b) => mcapOf(b) - mcapOf(a));
  if (sort === "raised") list.sort((a, b) => Number(b.reserve - a.reserve));
  // "new": загрузчик уже отдаёт новые первыми

  return (
    <div className="tok-sidebar">
      <input className="ts-search" placeholder={t("Поиск токенов")}
             value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ts-pills">
        {[["vol", t("Объём")], ["mcap", t("Капа")], ["new", t("Новые")], ["raised", t("Собрано")], ["fav", "★"]].map(([k, lbl]) => (
          <div key={k} className={`fpill ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{lbl}</div>
        ))}
      </div>
      <div className="ts-list">
        {!tokens && <div className="dim" style={{ padding: 12 }}>{t("Загружаю…")}</div>}
        {tokens && list.length === 0 && <div className="dim" style={{ padding: 12 }}>{t("Ничего не найдено")}</div>}
        {list.slice(0, 60).map((x) => {
          const active = current && x.token.toLowerCase() === current.toLowerCase();
          const v = volOf(x);
          return (
            <a key={x.token} className={`ts-row ${active ? "on" : ""}`} href={`#/token/${x.token}`}>
              {x.meta.image ? <img src={x.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
              <span className="ts-name">
                <b>${x.symbol}</b>
                <span className="dim">{usd(mcapOf(x) * rate)}</span>
              </span>
              <span className="ts-metrics">
                <span className="dim" title={t("Объём 24ч")}>{v > 0 ? `${fmtEth(v)} ETH` : "—"}</span>
                {x.graduated && <span title={t("Градуировал")}>🎯</span>}
              </span>
              <span className={`ts-fav ${favs.has(x.token) ? "on" : ""}`}
                    title={t(favs.has(x.token) ? "Убрать из избранного" : "В избранное")}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(x.token); }}>
                {favs.has(x.token) ? "★" : "☆"}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
