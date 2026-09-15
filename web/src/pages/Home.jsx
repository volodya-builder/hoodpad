import React, { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
import { formatEther, formatUnits } from "viem";
import { fmt, fmtEth } from "../lib/web3.js";
import { useEthUsd, useQuoteUsd, usd, moneyEth } from "../lib/price.js";
import { timeAgo, loadTokens, useClock, useSupport } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { useFavs, toggleFav } from "../lib/favs.js";
import { useArena } from "../lib/arena.js";
import { FEATURES } from "../lib/config.js";
import { modelLogo, makerOf } from "../lib/models.mjs";
import Who from "../components/Who.jsx";


function TokenCard({ t, fav, onFav, cushion = 0 }) {
  const { t: tr } = useLang();
  const rate = useEthUsd();
  const [cp, setCp] = useState(false);
  const progress = Number((t.sold * 10000n) / t.cap) / 100;
  // Монета за валюту: цена в знаках валюты, капитализацию в долларах
  // считаем через её курс, а не через ETH. Курса нет — покажем в валюте.
  const q = t.q || null;
  const qPrice = useQuoteUsd(q?.addr);
  const priceUnits = q ? Number(formatUnits(t.price, q.dec)) : Number(formatEther(t.price));
  const mcapEth = q ? 0 : priceUnits * 1_000_000_000;
  const mcapQuote = q ? priceUnits * 1_000_000_000 : 0;
  const copyCA = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(t.token); } catch (err) { /* ignore */ }
    setCp(true); setTimeout(() => setCp(false), 1200);
  };
  return (
    <a className="tcard" href={`#/token/${t.token}`}>
      <div className="timg">
        {t.meta.image ? <img src={t.meta.image} alt="" /> : <Icon name="image" size={22} style={{ margin: 0, opacity: .6 }} />}
        {t.graduated && <span className="grad-chip">{tr("Градуировал")}</span>}
        {cushion > 0 && (
          <span className="cushion-chip" title={tr("Казна потратила на выкуп этого токена")}>
            <Icon name="shield" size={12} /> {fmtEth(cushion)} ETH
          </span>
        )}
        <button className={`fav-btn ${fav ? "on" : ""}`}
                title={tr(fav ? "Убрать из избранного" : "В избранное")}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(t.token); }}>
          {fav ? "★" : "☆"}
        </button>
      </div>
      <div className="tname">{t.name}</div>
      <div className="ttick">${t.symbol}</div>
      <div className="tmc">
        {q
          ? (qPrice > 0 ? usd(mcapQuote * qPrice) : "…")
          : usd(mcapEth * rate)}<span>MC</span>
        {/* Дивиденды холдерам — ставка. Символ акции на карточке не пишем:
            деньги на сайте в ETH и долларах (решение владельца 15.09.2026). */}
        {q && t.divBps > 0 && <em className="tq" title={tr("дивиденды холдерам с каждой сделки")}><Icon name="droplet" size={11} /> {t.divBps / 100}%</em>}
      </div>
      {/* Модель ИИ монеты — выбор создателя, лежит в метадате. Показываем
          только известного разработчика: чужая строка на карточку не попадает. */}
      {FEATURES.ai && t.meta?.ai && makerOf(String(t.meta.ai)) && (
        <div className="tai" title={String(t.meta.ai)}>
          <img className="q-logo" src={modelLogo(String(t.meta.ai))} alt="" loading="lazy"
               onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span>{String(t.meta.aiName || String(t.meta.ai).split("/")[1] || t.meta.ai).slice(0, 28)}</span>
        </div>
      )}
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
        <span>{t.createdAt ? timeAgo(t.createdAt) : q ? moneyEth(formatUnits(t.reserve, q.dec), qPrice, rate) : `${fmtEth(Number(formatEther(t.reserve)))} / 6.5 ETH`}</span>
      </div>
    </a>
  );
}

/** Строка списка — как в Launches у Pons: логотип, имя и тикер, создатель ·
 *  возраст, прогресс кривой, капа, статус. Сетка/список — выбор пользователя. */
function TokenRow({ t, fav, onFav, cushion = 0 }) {
  const { t: tr } = useLang();
  const rate = useEthUsd();
  const progress = Number((t.sold * 10000n) / t.cap) / 100;
  const q = t.q || null;
  const qPrice = useQuoteUsd(q?.addr);
  const priceUnits = q ? Number(formatUnits(t.price, q.dec)) : Number(formatEther(t.price));
  const mcap = q ? (qPrice > 0 ? priceUnits * 1e9 * qPrice : null) : priceUnits * 1e9 * rate;
  return (
    <a className="lt-row home-row" href={`#/token/${t.token}`}>
      <button className={`fav-btn inline ${fav ? "on" : ""}`} title={tr(fav ? "Убрать из избранного" : "В избранное")}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(t.token); }}>{fav ? "★" : "☆"}</button>
      <span className="lt-logo">{t.meta.image ? <img src={t.meta.image} alt="" loading="lazy" /> : <Icon name="image" size={16} style={{ margin: 0, opacity: .5 }} />}</span>
      <span className="lt-tok">
        <span className="lt-name">{t.name} <em>${t.symbol}</em></span>
        <span className="lt-sub">
          {t.creator && <Who addr={t.creator} size={14} />}
          {t.creator && t.createdAt ? " · " : ""}{t.createdAt ? timeAgo(t.createdAt) : ""}
          {q && t.divBps > 0 && <> · <Icon name="droplet" size={11} style={{ margin: 0 }} /> {t.divBps / 100}%</>}
        </span>
      </span>
      <span className="lt-prog"><span className="pbar"><span style={{ width: `${Math.min(progress, 100)}%` }} /></span><em>{fmt(Math.min(progress, 100), 0)}%</em></span>
      <span className="lt-num">{mcap === null ? "…" : usd(mcap)}</span>
      <span className="lt-st">
        {t.graduated ? <span className="lt-tag gold">{tr("Градуировал")}</span>
          : cushion > 0 ? <span className="dim"><Icon name="shield" size={12} style={{ margin: 0 }} /> {fmtEth(cushion)} ETH</span>
          : <span className="dim">{tr("на кривой")}</span>}
      </span>
    </a>
  );
}

const VIEW_LS = "hood_home_view";

export default function Home({ onSearch }) {
  const { t } = useLang();
  const rate = useEthUsd();
  useClock(1000); // «Nс назад» на карточках тикает каждую секунду
  const [gpage, setGpage] = useState(1);
  const GRAD_PER_PAGE = 10;
  const [lpage, setLpage] = useState(1);
  const LIVE_PER_PAGE = 24; // страницами: вёрстка не тонет при тысячах токенов
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("new");
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_LS) === "list" ? "list" : "grid"; } catch (e) { return "grid"; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem(VIEW_LS, v); } catch (e) { /* ignore */ } };
  const List = ({ items }) => (
    <div className="lt home-lt">
      <div className="lt-h"><span /><span /><span>{t("Токен")}</span><span>{t("Кривая")}</span><span className="r">{t("Капа")}</span><span className="r" /></div>
      {items.map((t2) => <TokenRow key={t2.token} t={t2} fav={favs.has(t2.token)} onFav={toggleFav} cushion={cushionOf(t2.token)} />)}
    </div>
  );
  const favs = useFavs();
  const support = useSupport(FEATURES.treasury);
  const arena = useArena(FEATURES.arena && FEATURES.arenaBanner); // без баннера главная не тянет все сделки
  const cushionOf = (addr) => support.per[addr.toLowerCase()]?.eth || 0;


  useEffect(() => {
    let alive = true;
    loadTokens()
      .then((t) => alive && setTokens(t))
      .catch((e) => alive && setError(e.shortMessage || e.message));
    // 25-35с со случайным сдвигом: тысячи вкладок не бьют в индексатор синхронно
    const id = setInterval(() => {
      loadTokens().then((t) => alive && setTokens(t)).catch(() => {});
    }, 25000 + Math.random() * 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const bySort = (arr) => {
    let a = [...arr];
    if (sort === "fav") a = a.filter((x) => favs.has(x.token));
    if (sort === "mcap") a.sort((x, y) => Number(y.price - x.price));
    if (sort === "raised") a.sort((x, y) => Number(y.reserve - x.reserve));
    if (sort === "cushion") { a = a.filter((x) => cushionOf(x.token) > 0); a.sort((x, y) => cushionOf(y.token) - cushionOf(x.token)); }
    if (sort === "old") a.reverse(); // базовый порядок — новые первыми
    return a; // "new": loader already returns newest first
  };
  const live = bySort(tokens?.filter((t) => !t.graduated) ?? []);
  const grad = bySort(tokens?.filter((t) => t.graduated) ?? []);

  return (
    <>
      {/* шапка как в аналитике: заголовок, тихая подпись, один сегментный
          переключатель сортировки. Никаких чипов и коробок. */}
      <div className="ana-head home-head">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t("Обзор")}</h1>
          <div className="ana-panel-sub">
            {tokens ? <>{tokens.length} {t("запущено")}{grad.length > 0 && <> · {grad.length} {t("градуировали")}</>}</> : t("Загружаю токены из блокчейна…")}
            {" · "}{t("Токены, летящие к градации на Robinhood Chain.")}
          </div>
        </div>
        <div className="home-controls">
          <div className="seg">
            {[["new", t("Новые")], ["old", t("Старые")], ["raised", t("Недавние покупки")], ["mcap", t("Капитализация")], ...(FEATURES.treasury ? [["cushion", t("Выкуп казны")]] : []), ["fav", t("Избранное")]].map(([k, lbl]) => (
              <button key={k} type="button" className={`seg-btn ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{lbl}</button>
            ))}
          </div>
          <div className="seg seg-icons" title={t("Сетка или список")}>
            <button type="button" className={`seg-btn ${view === "list" ? "on" : ""}`} onClick={() => pickView("list")} aria-label={t("Список")}><Icon name="list" size={15} style={{ margin: 0 }} /></button>
            <button type="button" className={`seg-btn ${view === "grid" ? "on" : ""}`} onClick={() => pickView("grid")} aria-label={t("Сетка")}><Icon name="grid" size={15} style={{ margin: 0 }} /></button>
          </div>
        </div>
      </div>
      <div className="search-row">
        <div className="big-search" onClick={onSearch}>
          <Icon name="search" size={15} style={{ margin: 0 }} /> {t("Поиск токенов")} <span className="kbd">Ctrl K</span>
        </div>
        <a className="btn btn-primary" style={{ padding: "0 26px", display: "flex", alignItems: "center" }} href="#/create">
          {t("+ Создать")}
        </a>
      </div>
      {FEATURES.arena && FEATURES.arenaBanner && arena && arena.participants.length > 0 && (
        <a className="cushion-banner arena-banner" href="#/arena">
          <Icon name="target" size={14} /> {t("Арена")}: {arena.alive.length > 1 ? (
            <>
              <b>{arena.alive.length}</b> {t("токенов в бою")} · {t("лидер")}{" "}
              <b>${arena.alive[0].symbol}</b> ·{" "}
              {t("выбывание через")}{" "}
              <b className="mono">
                {(() => {
                  const s = Math.max(0, Math.floor(((arena.nextCheckpoint || 0) - Date.now()) / 1000));
                  return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`;
                })()}
              </b>
            </>
          ) : (
            <><Icon name="crown" size={14} /> {t("Чемпион дня")}: <b>${arena.alive[0]?.symbol}</b></>
          )} →
        </a>
      )}
      {FEATURES.treasury && <a className="cushion-banner" href="#/treasury">
        <Icon name="shield" /> {t("Казна вернула рынку")}: <b>{support.totalEth * rate >= 1000 ? usd(support.totalEth * rate) : "$" + (support.totalEth * rate).toFixed(2)}</b> <span className="dim">({fmtEth(support.totalEth)} ETH)</span>
        {support.totalEth === 0 && <span className="dim"> · {t("копится с каждой сделки — выкупы начнутся, когда наберётся сумма")}</span>} →
      </a>}
      {error && <div className="error">{error}</div>}
      {!tokens && !error && <div className="tgrid">{Array.from({ length: 10 }, (_, i) => <div key={i} className="tcard tcard-skel" />)}</div>}

      {grad.length > 0 && <div className="grad-sec">
        <div className="sec-head">
          <div>
            <h2 className="sec-h2">{t("Градуировали")} <span className="dim">{grad.length}</span></h2>
            <div className="ana-panel-sub">{t("Прошли порог градации — ликвидность заперта на DEX.")}</div>
          </div>
        </div>
        {(
          <>
            {view === "list" ? <List items={grad.slice((gpage - 1) * GRAD_PER_PAGE, gpage * GRAD_PER_PAGE)} /> : (
            <div className="tgrid">
              {grad.slice((gpage - 1) * GRAD_PER_PAGE, gpage * GRAD_PER_PAGE)
                   .map((t2) => <TokenCard key={t2.token} t={t2} fav={favs.has(t2.token)} onFav={toggleFav} cushion={cushionOf(t2.token)} />)}
            </div>)}
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
      </div>}

      {grad.length > 0 && <div className="sec-head" style={{ marginTop: 34 }}>
        <div><h2 className="sec-h2">{t("В пути к градации")}</h2></div>
      </div>}
      {!tokens && !error ? null : live.length === 0 ? (
        <div className="center" style={{ paddingBottom: 60 }}>
          {sort === "fav" ? (
            t("Пока нет избранных — нажмите ☆ на карточке токена.")
          ) : sort === "cushion" ? (
            t("Казна пока никого не выкупала — выкупленные токены появятся здесь.")
          ) : (
            <>
              {t("Токенов пока нет — станьте первым.")}{" "}
              <a href="#/create" style={{ color: "var(--gold)" }}>{t("Запустить токен →")}</a>
            </>
          )}
        </div>
      ) : (
        <>
          {view === "list" ? <List items={live.slice((lpage - 1) * LIVE_PER_PAGE, lpage * LIVE_PER_PAGE)} /> : (
          <div className="tgrid">
            {live.slice((lpage - 1) * LIVE_PER_PAGE, lpage * LIVE_PER_PAGE)
                 .map((t2) => <TokenCard key={t2.token} t={t2} fav={favs.has(t2.token)} onFav={toggleFav} cushion={cushionOf(t2.token)} />)}
          </div>)}
          <div className="pager" style={{ paddingBottom: 60 }}>
            {live.length > LIVE_PER_PAGE && (
              <>
                <div className="pg nav" onClick={() => setLpage(Math.max(1, lpage - 1))}>‹</div>
                {Array.from({ length: Math.ceil(live.length / LIVE_PER_PAGE) }, (_, k) => k + 1).map((p) => (
                  <div key={p} className={`pg ${p === lpage ? "on" : ""}`} onClick={() => setLpage(p)}>{p}</div>
                ))}
                <div className="pg nav"
                     onClick={() => setLpage(Math.min(Math.ceil(live.length / LIVE_PER_PAGE), lpage + 1))}>›</div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
