import React, { useEffect, useState } from "react";
import { formatEther } from "viem";
import { loadTokens, subgraphStats24 } from "../lib/data.js";
import { useEthUsd, usd } from "../lib/price.js";
import { fmtEth, fmt } from "../lib/web3.js";
import { useLang } from "../lib/i18n.jsx";

// Боковой список монет на странице токена: поиск, избранное,
// сортировки по объёму/росту в %/капе с переключением направления.
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
  const [st, setSt] = useState({ vol: {}, first: {} });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "vol", d: -1 }); // d: -1 убывание, 1 возрастание
  const [favs, setFavs] = useState(loadFavs);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      loadTokens().then((x) => alive && setTokens(x)).catch(() => {});
      subgraphStats24().then((v) => alive && setSt(v)).catch(() => {});
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

  const volOf = (tok) => st.vol[(tok.pool || "").toLowerCase()] || 0;
  const mcapOf = (tok) => Number(formatEther(tok.price)) * 1e9;
  const chgOf = (tok) => {
    const p0 = st.first[(tok.pool || "").toLowerCase()];
    if (!p0) return null;
    const cur = Number(formatEther(tok.price));
    return (cur / p0 - 1) * 100;
  };

  const pick = (k) => setSort((s) => (s.k === k ? { k, d: -s.d } : { k, d: -1 }));

  let list = tokens ?? [];
  if (q.trim()) {
    const s = q.trim().toLowerCase();
    list = list.filter((x) => x.name.toLowerCase().includes(s) || x.symbol.toLowerCase().includes(s));
  }
  if (sort.k === "fav") list = list.filter((x) => favs.has(x.token));
  list = [...list];
  const dir = sort.d;
  if (sort.k === "vol") list.sort((a, b) => (volOf(a) - volOf(b)) * dir * -1);
  if (sort.k === "chg") list.sort((a, b) => ((chgOf(a) ?? -1e18) - (chgOf(b) ?? -1e18)) * dir * -1);
  if (sort.k === "mcap") list.sort((a, b) => (mcapOf(a) - mcapOf(b)) * dir * -1);
  if (sort.k === "raised") list.sort((a, b) => Number(a.reserve - b.reserve) * dir * -1);
  if (sort.k === "new" && dir === 1) list.reverse(); // базово новые первыми

  const arrow = (k) => (sort.k === k ? (sort.d === -1 ? " ▼" : " ▲") : "");

  return (
    <div className="tok-sidebar">
      <input className="ts-search" placeholder={t("Поиск токенов")}
             value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ts-pills">
        {[["vol", t("Объём")], ["chg", "Δ%"], ["mcap", t("Капа")], ["new", t("Новые")], ["raised", t("Собрано")], ["fav", "★"]].map(([k, lbl]) => (
          <div key={k} className={`fpill ${sort.k === k ? "on" : ""}`} onClick={() => pick(k)}>
            {lbl}{arrow(k)}
          </div>
        ))}
      </div>
      <div className="ts-list">
        {!tokens && <div className="dim" style={{ padding: 12 }}>{t("Загружаю…")}</div>}
        {tokens && list.length === 0 && <div className="dim" style={{ padding: 12 }}>{t("Ничего не найдено")}</div>}
        {list.slice(0, 60).map((x) => {
          const active = current && x.token.toLowerCase() === current.toLowerCase();
          const v = volOf(x);
          const ch = chgOf(x);
          return (
            <a key={x.token} className={`ts-row ${active ? "on" : ""}`} href={`#/token/${x.token}`}>
              {x.meta.image ? <img src={x.meta.image} alt="" /> : <span className="ts-ph">🖼️</span>}
              <span className="ts-name">
                <b>${x.symbol}</b>
                <span className="dim">{usd(mcapOf(x) * rate)}</span>
              </span>
              <span className="ts-metrics">
                <span className="dim" title={t("Объём 24ч")}>{v > 0 ? `${fmtEth(v)} ETH` : "—"}</span>
                {ch != null ? (
                  <span className={ch >= 0 ? "side-buy" : "side-sell"} style={{ fontSize: 10.5 }}
                        title={t("Изменение цены за 24ч")}>
                    {ch >= 0 ? "+" : ""}{fmt(ch, 1)}%
                  </span>
                ) : (
                  x.graduated && <span title={t("Градуировал")}>🎯</span>
                )}
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
