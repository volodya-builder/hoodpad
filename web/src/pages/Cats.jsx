import React, { useMemo, useState, useEffect } from "react";
import { useLang } from "../lib/i18n.jsx";
import { RWA_POPULAR, stockLogo } from "../lib/rwa.js";
import * as SB from "../lib/catstate.js";
import * as CL from "../lib/clicker.js";
import { isTeam } from "../lib/config.js";
import CandleChart from "../components/CandleChart.jsx";
import CatsGuide from "./CatsGuide.jsx";
import { useEthUsd } from "../lib/price.js";

/** Коты-брокеры β — NFT-коты, привязанные к акциям, платят дивиденды из
 *  казны в токенизированных акциях; редкость даёт больший вес выплат.
 *  Контракты BrokerCats + CatStockVault готовы и оттестированы; пока не
 *  задеплоены — страница объясняет механику и собирает waitlist на аирдроп. */

const RARITIES = [
  { key: "Common", ru: "Обычный", chance: 60, mult: 1, color: "#8b93a7" },
  { key: "Rare", ru: "Редкий", chance: 24, mult: 2, color: "#4aa3e0" },
  { key: "Epic", ru: "Эпический", chance: 10, mult: 3, color: "#a06bff" },
  { key: "Mythic", ru: "Мифический", chance: 5, mult: 5, color: "#e0559a", img: "./cats/mythic.webp" },
  { key: "Legendary", ru: "Легендарный", chance: 1, mult: 8, color: "#f5b544", img: "./cats/legendary.webp" },
];

// Арт уровня: фирменная картинка (мем-кот) для старших редкостей,
// пиксель-кот в цвете уровня — для остальных
function TierArt({ tier, size = 72 }) {
  const r = RARITIES[tier];
  if (r.img) {
    return <img src={r.img} alt={r.key} className="cats-tier-img"
                style={{ width: size, height: size, borderColor: r.color + "88" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  }
  return <CatArt color={r.color} size={size} />;
}

// пиксель-кот в фирменном цвете тикера/редкости (SVG, без внешних ассетов)
function CatArt({ color = "#7c88ff", size = 96 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} style={{ imageRendering: "pixelated" }} aria-hidden="true">
      <rect width="32" height="32" fill="#12131a" rx="6" />
      <g fill={color}>
        <rect x="8" y="6" width="4" height="5" />
        <rect x="20" y="6" width="4" height="5" />
        <rect x="8" y="10" width="16" height="12" rx="2" />
        <rect x="10" y="22" width="12" height="4" />
      </g>
      <rect x="12" y="14" width="2" height="2" fill="#0b0d12" />
      <rect x="18" y="14" width="2" height="2" fill="#0b0d12" />
      <rect x="15" y="17" width="2" height="1" fill="#0b0d12" />
      <rect x="13" y="24" width="6" height="3" fill="#0b0d12" opacity=".35" />
    </svg>
  );
}

// Демо-лоты биржи (детерминированно): id, тикер, редкость, цена, дивиденды на коте
function demoListings() {
  const syms = RWA_POPULAR;
  let x = 42;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 24 }, (_, i) => {
    const r = rnd();
    const tier = r < 0.55 ? 0 : r < 0.78 ? 1 : r < 0.9 ? 2 : r < 0.98 ? 3 : 4;
    const base = [0.012, 0.035, 0.09, 0.28, 1.2][tier];
    return {
      id: 101 + i,
      sym: syms[Math.floor(rnd() * syms.length)],
      tier,
      price: Math.round(base * (0.8 + rnd() * 0.6) * 1000) / 1000,
      divs: Math.round([1, 2, 3, 5, 8][tier] * (2 + rnd() * 9) * 100) / 100,
      seller: "0x" + Math.floor(rnd() * 0xffff).toString(16).padStart(4, "0") + "…" + Math.floor(rnd() * 0xffff).toString(16).padStart(4, "0"),
    };
  });
}
const DEMO_LOTS = demoListings();

// «5м назад» / «2ч» / «3д» — короткий возраст кота
function timeAgoShort(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч`;
  return `${Math.floor(h / 24)}д`;
}

// История средней цены по редкостям (демо, детерминированно; после деплоя —
// из событий Bought контракта биржи)
function priceHistory(days = 30) {
  let x = 991;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const base = [0.012, 0.035, 0.09, 0.28, 1.2];
  const series = base.map((b) => {
    let v = b * (0.75 + rnd() * 0.2);
    return Array.from({ length: days }, () => {
      v = Math.max(b * 0.35, v * (0.96 + rnd() * 0.1));
      return Math.round(v * 10000) / 10000;
    });
  });
  return series;
}
const PRICE_HISTORY = priceHistory(30);

// Объём торгов по дням: сколько котов этой редкости продано (демо; после
// деплоя — count событий Bought за сутки). Редкие торгуются реже.
function volumeHistory(days = 30) {
  let x = 4177;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const peak = [34, 22, 12, 6, 2];
  return peak.map((p) =>
    Array.from({ length: days }, () => Math.max(p <= 2 ? 0 : 1, Math.round(p * (0.25 + rnd() * 0.95))))
  );
}
const VOL_HISTORY = volumeHistory(30);

// Свечной график котов — тот же компонент, что на странице токена:
// TradingView Lightweight Charts со свечами, объёмом, таймфреймами,
// логарифмической шкалой и полноэкранным режимом.
function CatChart({ t, tier, live, sb, rate }) {
  const r = RARITIES[tier];
  const { points, trades } = useMemo(() => {
    if (live) {
      // настоящие сделки песочницы: цена лота = точка, она же объём сделки
      const rows = (sb.trades || []).filter((x) => x.tier === tier).sort((a, b) => a.ts - b.ts);
      return {
        points: rows.map((x) => ({ ts: x.ts, mcap: x.price })),
        trades: rows.map((x) => ({ ts: x.ts, eth: x.price })),
      };
    }
    // демо-витрина: 30 дней истории по редкости
    const DAY = 86400000, series = PRICE_HISTORY[tier], vols = VOL_HISTORY[tier];
    const t0 = Date.now() - (series.length - 1) * DAY;
    return {
      points: series.map((p, i) => ({ ts: t0 + i * DAY, mcap: p })),
      trades: series.map((p, i) => ({ ts: t0 + i * DAY, eth: p * vols[i] })),
    };
  }, [live, sb, tier]);

  if (live && points.length === 0) {
    return (
      <div className="pc-wrap">
        <div className="pc-head"><span style={{ color: r.color }}>{t(r.ru)}</span><b>— ETH</b></div>
        <div className="pc-empty">
          {t("Сделок пока не было — выстави кота и нажми «Продать», график оживёт.")}
        </div>
      </div>
    );
  }

  const last = points[points.length - 1].mcap, first = points[0].mcap;
  const chg = first ? ((last - first) / first) * 100 : 0;

  return (
    <div className="pc-wrap">
      <div className="pc-head">
        <span style={{ color: r.color }}>{t(r.ru)}</span>
        <b>{last} ETH</b>
        <span className={chg >= 0 ? "pc-up" : "pc-down"}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}%</span>
        <span className="dim">{live ? t("по твоим сделкам") : t("за 30 дней")}</span>
      </div>
      <CandleChart points={points} trades={trades} rate={rate} defaultIv={live ? 60 : 86400} />
    </div>
  );
}

// Старый лёгкий график остаётся для узких мест (не используется на бирже)
function LiveChart({ t, tier, rows }) {
  const r = RARITIES[tier];
  const W = 640, H = 150, P = 8, VH = 52, VP = 4;
  if (rows.length < 2) {
    return (
      <div className="pc-wrap">
        <div className="pc-head">
          <span style={{ color: r.color }}>{t(r.ru)}</span>
          <b>{rows.length ? `${rows[0].price} ETH` : "— ETH"}</b>
          {rows.length === 1 && <span className="dim">{t("1 сделка")}</span>}
        </div>
        <div className="pc-empty">
          {rows.length === 0
            ? t("Сделок пока не было — выстави кота и нажми «Продать», график оживёт.")
            : t("Нужна ещё одна сделка, чтобы построить линию цены.")}
        </div>
      </div>
    );
  }
  const data = rows.map((x) => x.price);
  const vol = rows.map((x) => x.n);
  const mx = Math.max(...data), mn = Math.min(...data);
  const X = (i) => P + (i / (data.length - 1)) * (W - P * 2);
  const Y = (v) => H - P - ((v - mn) / Math.max(mx - mn, 1e-9)) * (H - P * 2);
  const line = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(data.length - 1).toFixed(1)},${H} L${X(0).toFixed(1)},${H} Z`;
  const last = data[data.length - 1], first = data[0];
  const chg = ((last - first) / first) * 100;
  const vMax = Math.max(...vol, 1);
  const bw = Math.max(3, ((W - P * 2) / vol.length) * 0.62);

  return (
    <div className="pc-wrap">
      <div className="pc-head">
        <span style={{ color: r.color }}>{t(r.ru)}</span>
        <b>{last} ETH</b>
        <span className={chg >= 0 ? "pc-up" : "pc-down"}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}%</span>
        <span className="dim">{t("по твоим сделкам")}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pc-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`lcg${tier}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={r.color} stopOpacity=".28" />
            <stop offset="1" stopColor={r.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#lcg${tier})`} />
        <path d={line} fill="none" stroke={r.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="2.6" fill={r.color} />)}
      </svg>
      <div className="pc-vol-h">
        <span>{t("объём")}</span>
        <span className="dim">{vol.reduce((a, b) => a + b, 0)} {t("сделок")}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${VH}`} className="pc-vol" preserveAspectRatio="none">
        {vol.map((v, i) => {
          const up = i === 0 ? true : data[i] >= data[i - 1];
          const h = Math.max(2, (v / vMax) * (VH - VP * 2));
          return <rect key={i} x={X(i) - bw / 2} y={VH - VP - h} width={bw} height={h} rx="1"
                       fill={up ? "#3fbf7f" : "#ff5b6a"} fillOpacity=".8" />;
        })}
      </svg>
      <div className="pc-foot"><span>{t("мин")} {mn} ETH</span><span>{t("макс")} {mx} ETH</span></div>
    </div>
  );
}

function PriceChart({ t, tier, live, sb }) {
  // live = включён тестовый режим: показываем только настоящие сделки
  if (live) return <LiveChart t={t} tier={tier} rows={SB.tradeSeries(sb, tier)} />;
  const data = PRICE_HISTORY[tier];
  const vol = VOL_HISTORY[tier];
  const r = RARITIES[tier];
  const W = 640, H = 150, P = 8;
  // нижняя панель объёма делит с графиком ось X: те же W и P
  const VH = 52, VP = 4;
  const vMax = Math.max(...vol, 1);
  const vSum = vol.reduce((a, b) => a + b, 0);
  const bw = ((W - P * 2) / vol.length) * 0.62;
  const mx = Math.max(...data), mn = Math.min(...data);
  const X = (i) => P + (i / (data.length - 1)) * (W - P * 2);
  const Y = (v) => H - P - ((v - mn) / Math.max(mx - mn, 1e-9)) * (H - P * 2);
  const line = data.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(data.length - 1).toFixed(1)},${H} L${X(0).toFixed(1)},${H} Z`;
  const last = data[data.length - 1], first = data[0];
  const chg = ((last - first) / first) * 100;

  return (
    <div className="pc-wrap">
      <div className="pc-head">
        <span style={{ color: r.color }}>{t(r.ru)}</span>
        <b>{last} ETH</b>
        <span className={chg >= 0 ? "pc-up" : "pc-down"}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}%</span>
        <span className="dim">{t("за 30 дней")}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pc-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`pcg${tier}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={r.color} stopOpacity=".28" />
            <stop offset="1" stopColor={r.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#pcg${tier})`} />
        <path d={line} fill="none" stroke={r.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(data.length - 1)} cy={Y(last)} r="3.5" fill={r.color} />
      </svg>

      {/* объём торгов: столбики по дням, цвет — по движению цены за день */}
      <div className="pc-vol-h">
        <span>{t("объём")}</span>
        <span className="dim">{vSum} {t("продаж за 30 дней")}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${VH}`} className="pc-vol" preserveAspectRatio="none">
        {vol.map((v, i) => {
          const up = i === 0 ? true : data[i] >= data[i - 1];
          const h = Math.max(1.5, (v / vMax) * (VH - VP * 2));
          return (
            <rect key={i} x={X(i) - bw / 2} y={VH - VP - h} width={bw} height={h} rx="1"
                  fill={up ? "#3fbf7f" : "#ff5b6a"} fillOpacity={i === vol.length - 1 ? ".95" : ".55"}>
              <title>{v} {t("продаж")}</title>
            </rect>
          );
        })}
      </svg>

      <div className="pc-foot"><span>{t("мин")} {mn} ETH</span><span>{t("макс")} {mx} ETH</span></div>
    </div>
  );
}

// Стакан заявок по редкости: биды (покупка) снизу, аски (продажа) сверху.
// Демо-книга детерминирована; после деплоя строится из активных лотов
// (аски = listings контракта) и офферов покупателей.
function orderBook(tier, myLots) {
  const base = PRICE_HISTORY[tier][PRICE_HISTORY[tier].length - 1];
  let x = 7000 + tier * 137;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const asks = Array.from({ length: 6 }, (_, i) => ({
    price: Math.round(base * (1 + (i + 1) * (0.04 + rnd() * 0.03)) * 10000) / 10000,
    qty: 1 + Math.floor(rnd() * 5),
  }));
  const bids = Array.from({ length: 6 }, (_, i) => ({
    price: Math.round(base * (1 - (i + 1) * (0.04 + rnd() * 0.03)) * 10000) / 10000,
    qty: 1 + Math.floor(rnd() * 5),
  }));
  // мои реальные лоты этой редкости добавляем в аски
  (myLots || []).filter((l) => l.tier === tier).forEach((l) => {
    asks.push({ price: l.price, qty: 1, mine: true });
  });
  asks.sort((a, b) => a.price - b.price);
  bids.sort((a, b) => b.price - a.price);
  return { asks: asks.slice(0, 7).reverse(), bids: bids.slice(0, 7) };
}

function OrderBook({ t, tier, myLots, live }) {
  // в тестовом режиме в стакане только настоящие лоты; заявок на покупку
  // без контракта офферов нет вовсе
  const { asks, bids } = useMemo(() => (
    live
      ? { asks: (myLots || []).filter((l) => l.tier === tier)
            .map((l) => ({ price: l.price, qty: 1, mine: true }))
            .sort((a, b) => a.price - b.price).reverse(),
          bids: [] }
      : orderBook(tier, myLots)
  ), [tier, myLots, live]);
  const maxQty = Math.max(...asks.map((a) => a.qty), ...bids.map((b) => b.qty), 1);
  const bestAsk = asks[asks.length - 1]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const spread = bestAsk && bestBid ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;

  return (
    <div className="ob">
      <div className="ob-head">
        <span>{t("Стакан заявок")}</span>
        <span className="dim">{t("цена")} · {t("кол-во")}</span>
      </div>

      {live && asks.length === 0 && (
        <div className="pc-empty" style={{ minHeight: 120 }}>
          {t("Заявок нет. Выстави кота на продажу — лот появится здесь.")}
        </div>
      )}

      <div className="ob-side">
        {asks.map((a, i) => (
          <div className="ob-row ask" key={`a${i}`}>
            <span className="ob-bar" style={{ width: `${(a.qty / maxQty) * 100}%` }} />
            <span className="ob-price">{a.price}</span>
            <span className="ob-qty">{a.qty}{a.mine && <b className="ob-mine">•</b>}</span>
          </div>
        ))}
      </div>

      <div className="ob-spread">
        <b>{bestBid} / {bestAsk}</b>
        <span className="dim">{t("спред")} {spread.toFixed(1)}%</span>
      </div>

      <div className="ob-side">
        {bids.map((b, i) => (
          <div className="ob-row bid" key={`b${i}`}>
            <span className="ob-bar" style={{ width: `${(b.qty / maxQty) * 100}%` }} />
            <span className="ob-price">{b.price}</span>
            <span className="ob-qty">{b.qty}</span>
          </div>
        ))}
      </div>

      <div className="ob-foot">
        <span className="ob-legend"><i className="ask" />{t("продажа")}</span>
        <span className="ob-legend"><i className="bid" />{t("покупка")}</span>
      </div>
    </div>
  );
}

function Market({ t, sb, setSb }) {
  const rate = useEthUsd();
  const [tier, setTier] = useState(-1); // -1 = все
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("price_asc");
  const [toast, setToast] = useState("");
  const [chartTier, setChartTier] = useState(0);
  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2400); };

  // мои коты, которые ещё НЕ выставлены — их можно выставить прямо отсюда
  const myIdle = sb.enabled ? sb.cats.filter((c) => !c.listed) : [];

  // Тестовая сделка: покупатель забирает лот по цене листинга.
  // Пишется в историю — из неё живёт график и объём.
  function doSell(l) {
    const { state, trade } = SB.sellNow(sb, l.id);
    if (!trade) return say(t("Лот не найден"));
    setSb(state);
    setChartTier(l.tier);
    say(t("Продано за {p} ETH · комиссия 2% в казну").replace("{p}", trade.price));
  }

  // Выкуп проданного кота обратно — проверка стороны покупателя
  function doBuyBack(c) {
    const raw = window.prompt(t("Цена покупки в ETH:"), String(c.soldPrice));
    if (raw === null) return;
    const price = parseFloat(String(raw).replace(",", "."));
    if (!price || price <= 0) return;
    const { state, trade, error } = SB.buyBack(sb, c.id, price);
    if (error === "no_funds") return say(t("Не хватает тестового ETH — сначала продай кота."));
    if (!trade) return say(t("Лот не найден"));
    setSb(state);
    setChartTier(c.tier);
    say(t("Куплен кот #{id} за {p} ETH").replace("{id}", c.id).replace("{p}", price));
  }

  function quickList(c) {
    const suggest = [0.012, 0.035, 0.09, 0.28, 1.2][c.tier];
    const raw = window.prompt(t("Цена в ETH:"), String(suggest));
    const price = parseFloat(String(raw).replace(",", "."));
    if (!price || price <= 0) return;
    setSb(SB.listCat(sb, c.id, price));
    say(t("Кот #{id} выставлен на биржу").replace("{id}", c.id));
  }

  // мои лоты из песочницы идут первыми и помечены
  const myLots = useMemo(() => (sb.enabled ? sb.cats.filter((c) => c.listed).map((c) => ({
    id: c.id, sym: c.sym, tier: c.tier, price: c.price, divs: c.divs, seller: t("я"), mine: true,
  })) : []), [sb, t]);

  // В тестовом режиме показываем ТОЛЬКО реально выставленных котов —
  // фейковые лоты мешают проверять функционал.
  const ALL = useMemo(() => (sb.enabled ? myLots : DEMO_LOTS), [myLots, sb.enabled]);

  const lots = useMemo(() => {
    let out = ALL.filter((l) =>
      (tier === -1 || l.tier === tier) && (!q || l.sym.includes(q))
    );
    const by = {
      price_asc: (a, b) => a.price - b.price,
      price_desc: (a, b) => b.price - a.price,
      rarity: (a, b) => b.tier - a.tier,
      divs: (a, b) => b.divs - a.divs,
    }[sort];
    return [...out].sort(by);
  }, [tier, q, sort, ALL]);

  const floor = (tr) => {
    const arr = ALL.filter((l) => l.tier === tr);
    return arr.length ? Math.min(...arr.map((l) => l.price)) : null;
  };

  return (
    <>
      {toast && <div className="rev-toast">{toast}</div>}
      <div className="rev-stats" style={{ justifyContent: "flex-start", marginTop: 4 }}>
        <div><b>{ALL.length}</b><span>{t("лотов на бирже")}</span></div>
        <div><b>{floor(0) ?? "—"} ETH</b><span>{t("флор Обычных")}</span></div>
        <div><b>{floor(4) ?? "—"} ETH</b><span>{t("флор Легендарных")}</span></div>
        <div><b>2%</b><span>{t("комиссия биржи — в казну")}</span></div>
        {sb.enabled && <div><b className="rev-gold">{(sb.balance || 0)} ETH</b><span>{t("тестовый баланс")}</span></div>}
        {sb.enabled && <div><b>{(sb.trades || []).length}</b><span>{t("сделок")}</span></div>}
      </div>

      {/* График истории цен по редкостям */}
      <div className="pc-block">
        <div className="pc-tabs quote-tabs" style={{ margin: 0, flexWrap: "wrap" }}>
          {RARITIES.map((r, i) => (
            <button type="button" key={r.key} className={`quote-tab qt-sm ${chartTier === i ? "on" : ""}`}
                    style={chartTier === i ? { borderColor: r.color, color: r.color } : {}}
                    onClick={() => setChartTier(i)}>{t(r.ru)}</button>
          ))}
        </div>
        <div className="pc-row">
          <CatChart t={t} tier={chartTier} live={sb.enabled} sb={sb} rate={rate} />
          <OrderBook t={t} tier={chartTier} myLots={myLots} live={sb.enabled} />
        </div>
      </div>

      {/* Мои коты прямо на бирже — быстро выставить */}
      {sb.enabled && (
        <div className="mm-block">
          <div className="mm-head">
            <b>{t("Мои коты")} <span className="dim">({myIdle.length} {t("свободно")})</span></b>
          </div>
          {myIdle.length === 0 ? (
            <div className="dim" style={{ fontSize: 13 }}>
              {sb.cats.length === 0
                ? t("Пока пусто — открой кейс во вкладке «Кейсы».")
                : t("Все коты уже выставлены на бирже.")}
            </div>
          ) : (
            <div className="mm-list">
              {myIdle.map((c) => {
                const r = RARITIES[c.tier];
                return (
                  <div className="mm-row" key={c.id}>
                    <TierArt tier={c.tier} size={38} />
                    <span className="mm-id">#{c.id}</span>
                    <span className="mm-tier" style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span>
                    <span className="mm-sym">
                      <img src={stockLogo(c.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      {c.sym}
                    </span>
                    <span className="mm-divs">${c.divs}</span>
                    <button className="btn btn-primary sm-btn" onClick={() => quickList(c)}>{t("Выставить")}</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* проданные коты: можно выкупить обратно и проверить покупку */}
      {sb.enabled && (sb.sold || []).length > 0 && (
        <div className="mm-block">
          <div className="mm-head">
            <b>{t("Продано")} <span className="dim">({sb.sold.length})</span></b>
            <span className="dim" style={{ fontSize: 12 }}>{t("выкупи обратно — сделка тоже попадёт в график")}</span>
          </div>
          <div className="mm-list">
            {sb.sold.map((c) => {
              const r = RARITIES[c.tier];
              return (
                <div className="mm-row" key={c.id}>
                  <TierArt tier={c.tier} size={38} />
                  <span className="mm-id">#{c.id}</span>
                  <span className="mm-tier" style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span>
                  <span className="mm-sym">
                    <img src={stockLogo(c.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    {c.sym}
                  </span>
                  <span className="mm-divs">{c.soldPrice} ETH</span>
                  <button className="btn btn-primary sm-btn" onClick={() => doBuyBack(c)}>{t("Выкупить")}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="cm-filters">
        <div className="quote-tabs" style={{ margin: 0, flexWrap: "wrap" }}>
          <button type="button" className={`quote-tab qt-sm ${tier === -1 ? "on" : ""}`} onClick={() => setTier(-1)}>{t("Все")}</button>
          {RARITIES.map((r, i) => (
            <button type="button" key={r.key} className={`quote-tab qt-sm ${tier === i ? "on" : ""}`}
                    style={tier === i ? { borderColor: r.color, color: r.color } : {}}
                    onClick={() => setTier(i)}>{t(r.ru)}</button>
          ))}
        </div>
        <input className="cm-search" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())}
               placeholder={t("Тикер: NVDA, AAPL…")} />
        <div className="quote-tabs" style={{ margin: 0 }}>
          <button type="button" className={`quote-tab qt-sm ${sort === "price_asc" ? "on" : ""}`} onClick={() => setSort("price_asc")}>{t("Дешевле")}</button>
          <button type="button" className={`quote-tab qt-sm ${sort === "rarity" ? "on" : ""}`} onClick={() => setSort("rarity")}>{t("Реже")}</button>
          <button type="button" className={`quote-tab qt-sm ${sort === "divs" ? "on" : ""}`} onClick={() => setSort("divs")}>{t("Дивиденднее")}</button>
        </div>
      </div>

      <div className="cm-grid">
        {lots.map((l) => {
          const r = RARITIES[l.tier];
          return (
            <div className={`cm-card ${l.mine ? "cm-mine" : ""}`} key={(l.mine ? "my" : "d") + l.id} style={{ borderColor: r.color + "55" }}>
              <div className="cm-card-head">
                <TierArt tier={l.tier} size={64} />
                <div>
                  <b>{t("Кот")} #{l.id} {l.mine && <span className="cm-mine-tag">{t("мой")}</span>}</b>
                  <span className="cm-tier" style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span>
                </div>
              </div>
              <div className="cm-kv">
                <span><img src={stockLogo(l.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />{l.sym}</span>
                <span className="cm-divs" title={t("Накопленные дивиденды уедут с котом к покупателю")}>${l.divs} {t("дивидендов внутри")}</span>
              </div>
              <div className="cm-foot">
                <b>{l.price} ETH</b>
                {l.mine ? (
                  <span className="cm-acts">
                    <button className="btn btn-primary sm-btn" onClick={() => doSell(l)}>{t("Продать")}</button>
                    <button className="btn sm-btn"
                            onClick={() => { setSb(SB.unlistCat(sb, l.id)); say(t("Снято с продажи")); }}>
                      {t("Снять")}
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-primary sm-btn"
                          onClick={() => { setToast(t("Биржа откроется с деплоем контрактов — кот пока не продаётся.")); setTimeout(() => setToast(""), 2600); }}>
                    {t("Купить")}
                  </button>
                )}
              </div>
              <div className="cm-seller">{t("продавец")}: {l.seller}</div>
            </div>
          );
        })}
        {lots.length === 0 && (
          <div className="center dim" style={{ gridColumn: "1/-1", padding: 30 }}>
            {sb.enabled && ALL.length === 0
              ? t("На бирже пусто — выстави кота из вкладки «Мои коты».")
              : t("Ничего не найдено")}
          </div>
        )}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {sb.enabled
          ? t("Тестовый режим: на бирже только твои реальные лоты. Контракт биржи готов (эскроу, 2% казне, дивиденды переезжают с котом).")
          : t("Демо-витрина. Контракт биржи готов (эскроу, 2% казне, дивиденды переезжают с котом) — включим с деплоем.")}
      </div>
    </>
  );
}

// Кейсы: рулетка открытия в стиле CS:GO
const ROLL_ITEM = 96, ROLL_GAP = 10, ROLL_PAD = 12, ROLL_WIN_INDEX = 36;

function Boxes({ t, sb, setSb }) {
  const [phase, setPhase] = useState("idle"); // idle | rolling | result
  const [result, setResult] = useState(null);
  const [strip, setStrip] = useState([]);
  const [offset, setOffset] = useState(0);
  const [anim, setAnim] = useState(false); // включаем transition только на саму прокрутку
  const wrapRef = React.useRef(null);
  const timerRef = React.useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const SOLD_DEMO = 1287; // демо-счётчик проданных боксов (когда песочница выключена)

  // Точный сдвиг ленты: центр выигрышной ячейки должен встать под маркер
  // (маркер — ровно посередине контейнера). В CSS проценты в translateX
  // считаются от ширины САМОЙ ленты, поэтому раньше лента останавливалась
  // на произвольном коте — считаем в пикселях по реальной ширине контейнера.
  function winOffset() {
    const w = wrapRef.current?.clientWidth || 640;
    const cellCenter = ROLL_PAD + ROLL_WIN_INDEX * (ROLL_ITEM + ROLL_GAP) + ROLL_ITEM / 2;
    return Math.round(w / 2 - cellCenter);
  }

  function rollRarity() {
    const r = Math.random() * 100;
    return r < 60 ? 0 : r < 84 ? 1 : r < 94 ? 2 : r < 99 ? 3 : 4;
  }

  function openBox() {
    if (phase === "rolling") return;
    // в песочнице бокс реально тратится и кот попадает в коллекцию
    let win, sym = null, catId = null;
    if (sb.enabled) {
      if (sb.myBoxes <= 0) return;
      const { state, cat } = SB.openBox(sb, RWA_POPULAR);
      setSb(state);
      win = cat.tier; sym = cat.sym; catId = cat.id;
    } else {
      win = rollRarity();
      sym = RWA_POPULAR[Math.floor(Math.random() * RWA_POPULAR.length)];
    }
    const items = Array.from({ length: 40 }, () => rollRarity());
    items[ROLL_WIN_INDEX] = win;
    clearTimeout(timerRef.current);
    setStrip(items);
    setResult(null);
    // ВАЖНО: сначала ставим ленту в ноль БЕЗ анимации. Раньше сброс и запуск
    // шли в одном кадре с включённым transition, поэтому на втором открытии
    // лента «ползла» из прошлой позиции в ту же самую и внешне зависала.
    setAnim(false);
    setOffset(0);
    setPhase("rolling");
    // прокрутку запускаем через кадр, когда нулевая позиция уже отрисована
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setAnim(true);
      setOffset(winOffset());
    }));
    timerRef.current = setTimeout(() => {
      setResult({ tier: win, sym, id: catId });
      setPhase("result");
      setAnim(false);
    }, 4200);
  }

  const left = sb.enabled ? sb.boxesLeft : 10000 - SOLD_DEMO;
  const pct = ((10000 - left) / 10000) * 100;

  return (
    <>
      <div className="box-hero">
        <div className="box-left">
          <div className="box-art">
            <div className="box-lid" />
            <div className="box-body">🐱</div>
          </div>
        </div>
        <div className="box-info">
          <h3>{t("Кейс с котом")}</h3>
          <p className="rev-sub" style={{ margin: "6px 0 12px" }}>
            {t("Внутри — случайный NFT-кот одной из пяти редкостей. Всего боксов 10 000, и больше не будет никогда.")}
          </p>
          <div className="box-supply">
            <div className="box-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="box-supply-kv"><b>{left.toLocaleString("ru-RU")}</b> {t("боксов осталось из 10 000")}</div>
          </div>
          <div className="box-odds">
            {RARITIES.map((r, i) => (
              <span key={r.key} style={{ color: r.color }}>{t(r.ru)} {r.chance}%</span>
            ))}
          </div>
          <div className="rev-cta" style={{ justifyContent: "flex-start", marginTop: 14 }}>
            <button className="btn btn-primary" onClick={openBox} disabled={phase === "rolling" || (sb.enabled && sb.myBoxes <= 0)}>
              {phase === "rolling" ? t("Открываем…")
                : sb.enabled ? `🎁 ${t("Открыть кейс")} · ${sb.myBoxes.toLocaleString("ru-RU")} ${t("шт. у меня")}`
                : `🎁 ${t("Открыть кейс")} · 0.02 ETH`}
            </button>
          </div>
          <div className="hint">
            {sb.enabled
              ? t("Тестовый режим: бокс списывается по-настоящему, кот попадает в «Мои коты» и на биржу.")
              : t("Демо-открытие: настоящие боксы включатся с деплоем. Рандом в контракте — commit-reveal: подкрутить результат не может ни игрок, ни валидатор.")}
          </div>
        </div>
      </div>

      {(phase === "rolling" || phase === "result") && (
        <div className="roll-wrap" ref={wrapRef}>
          <div className="roll-marker" />
          <div className="roll-strip"
               style={{ transform: `translateX(${offset}px)`,
                        transition: anim ? "transform 4.2s cubic-bezier(.12,.72,.11,1)" : "none" }}>
            {strip.map((tr, i) => (
              <div className="roll-item" key={i} style={{ borderColor: RARITIES[tr].color + "88" }}>
                <TierArt tier={tr} size={64} />
                <span style={{ color: RARITIES[tr].color }}>{t(RARITIES[tr].ru)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "result" && result && (
        <div className="roll-result" style={{ borderColor: RARITIES[result.tier].color }}>
          <TierArt tier={result.tier} size={96} />
          <div>
            <b style={{ color: RARITIES[result.tier].color }}>{t(RARITIES[result.tier].ru)} {t("кот")}{result.id ? ` #${result.id}` : ""}!</b>
            <div className="rr-sub">
              <img src={stockLogo(result.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              {result.sym} · {t("вес выплат")} ×{RARITIES[result.tier].mult}
            </div>
          </div>
          <button className="btn sm-btn" onClick={openBox}>{t("Ещё раз")}</button>
        </div>
      )}
    </>
  );
}

// Мои коты: коллекция, накопленный доход, клейм
const MY_DEMO = [
  { id: 118, tier: 4, sym: "NVDA", divs: 42.8, since: "12д" },
  { id: 207, tier: 3, sym: "TSLA", divs: 18.4, since: "9д" },
  { id: 341, tier: 2, sym: "AAPL", divs: 9.1, since: "6д" },
  { id: 502, tier: 1, sym: "COIN", divs: 4.3, since: "3д" },
  { id: 655, tier: 0, sym: "SPY", divs: 1.7, since: "1д" },
];

// История выплат кота (демо, детерминированно по id)
function catPayouts(cat) {
  let x = cat.id;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const mult = RARITIES[cat.tier].mult;
  const stocks = ["SPY", "NVDA", "AAPL", "QQQ", "MSFT"];
  const n = 4 + Math.floor(rnd() * 5);
  const rows = Array.from({ length: n }, (_, i) => {
    const sym = stocks[Math.floor(rnd() * stocks.length)];
    const usd = Math.round(mult * (0.6 + rnd() * 2.4) * 100) / 100;
    return {
      day: `${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}.08`,
      sym,
      usd,
      qty: (usd / (40 + rnd() * 400)).toFixed(4),
      status: i === 0 ? "pending" : "paid",
    };
  });
  return rows;
}

function CatModal({ t, cat, onClose }) {
  const r = RARITIES[cat.tier];
  const rows = useMemo(() => catPayouts(cat), [cat]);
  const byStock = useMemo(() => {
    const m = {};
    rows.forEach((x) => { m[x.sym] = (m[x.sym] || 0) + x.usd; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const total = rows.reduce((s, x) => s + x.usd, 0);
  const pending = rows.filter((x) => x.status === "pending").reduce((s, x) => s + x.usd, 0);

  return (
    <div className="modal-back open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rev-launch-modal cat-modal">
        <div className="rev-lm-head">
          <b>{t("Кот")} #{cat.id} · <span style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span></b>
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="cat-modal-top">
          <TierArt tier={cat.tier} size={92} />
          <div className="cat-modal-kv">
            <div><span>{t("тикер кота")}</span><b><img src={stockLogo(cat.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />{cat.sym}</b></div>
            <div><span>{t("всего выплачено")}</span><b className="rev-gold">${total.toFixed(2)}</b></div>
            <div><span>{t("ждёт клейма")}</span><b>${pending.toFixed(2)}</b></div>
            <div><span>{t("в коллекции")}</span><b>{cat.since}</b></div>
          </div>
        </div>

        <div className="cat-sec-title">{t("По акциям")}</div>
        <div className="cat-bystock">
          {byStock.map(([sym, usd]) => (
            <div className="cat-bystock-row" key={sym}>
              <span><img src={stockLogo(sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />{sym}</span>
              <span className="cat-bar"><i style={{ width: `${(usd / byStock[0][1]) * 100}%` }} /></span>
              <b>${usd.toFixed(2)}</b>
            </div>
          ))}
        </div>

        <div className="cat-sec-title">{t("История выплат")}</div>
        <div className="cat-payouts">
          <div className="cat-pay-head"><span>{t("дата")}</span><span>{t("акция")}</span><span>{t("количество")}</span><span>{t("сумма")}</span><span></span></div>
          {rows.map((x, i) => (
            <div className="cat-pay-row" key={i}>
              <span>{x.day}</span>
              <span><img src={stockLogo(x.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />{x.sym}</span>
              <span className="dim">{x.qty}</span>
              <b>${x.usd.toFixed(2)}</b>
              <span className={`cat-pay-status ${x.status}`}>{x.status === "paid" ? t("выплачено") : t("ждёт")}</span>
            </div>
          ))}
        </div>

        <div className="hint" style={{ marginTop: 12 }}>{t("Демо-история. После деплоя строится по событиям контракта выплат.")}</div>
      </div>
    </div>
  );
}

function MyCats({ t, sb, setSb }) {
  const [claimed, setClaimed] = useState(false);
  const [toast, setToast] = useState("");
  const [openCat, setOpenCat] = useState(null);
  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  // в песочнице показываем настоящую коллекцию, иначе демо
  const live = sb.enabled;
  const list = live
    ? sb.cats.map((c) => ({ ...c, since: timeAgoShort(c.mintedAt) }))
    : MY_DEMO;
  const pending = useMemo(() => list.reduce((s, c) => s + c.divs, 0), [list]);
  const weight = useMemo(() => list.reduce((s, c) => s + RARITIES[c.tier].mult, 0), [list]);
  const monthly = Math.round(pending * 0.42 * 100) / 100;

  function doList(c) {
    const raw = window.prompt(t("Цена в ETH:"), c.price || "0.05");
    const price = parseFloat(String(raw).replace(",", "."));
    if (!price || price <= 0) return;
    setSb(SB.listCat(sb, c.id, price));
    say(t("Кот #{id} выставлен на биржу").replace("{id}", c.id));
  }

  return (
    <>
      {toast && <div className="rev-toast">{toast}</div>}
      {openCat && <CatModal t={t} cat={openCat} onClose={() => setOpenCat(null)} />}
      <div className="rev-stats" style={{ justifyContent: "flex-start", marginTop: 4 }}>
        <div><b>{MY_DEMO.length}</b><span>{t("котов в коллекции")}</span></div>
        <div><b>×{weight}</b><span>{t("суммарный вес выплат")}</span></div>
        <div><b className="rev-gold">${pending.toFixed(2)}</b><span>{t("к клейму сейчас")}</span></div>
        <div><b>${monthly}</b><span>{t("в среднем в месяц")}</span></div>
      </div>

      <div className="my-claim">
        <div>
          <b>{t("Доступно к выводу")}: <span className="rev-gold">${live ? pending.toFixed(2) : (claimed ? "0.00" : pending.toFixed(2))}</span></b>
          <div className="hint" style={{ marginTop: 4 }}>{t("Дивиденды приходят в токенизированных акциях (SPY, NVDA и др.)")}</div>
        </div>
        <button className="btn btn-primary" disabled={live ? pending <= 0 : claimed}
                onClick={() => {
                  if (live) {
                    const { state, sum } = SB.claimAll(sb);
                    setSb(state);
                    say(t("Получено ${sum} в акциях").replace("{sum}", sum.toFixed(2)));
                  } else {
                    setClaimed(true);
                    say(t("Клейм откроется с деплоем контрактов."));
                  }
                }}>
          {t("Забрать всё")}
        </button>
      </div>

      <h2 className="rev-h2">{t("Мои коты")} {!live && <span className="rev-demo-tag">{t("демо")}</span>}</h2>
      {live && list.length === 0 && (
        <div className="center dim" style={{ padding: 30 }}>{t("Пока пусто — открой кейс во вкладке «Кейсы».")}</div>
      )}
      <div className="cm-grid">
        {list.map((c) => {
          const r = RARITIES[c.tier];
          return (
            <div className="cm-card cm-card-click" key={c.id} style={{ borderColor: r.color + "55" }}
                 onClick={() => setOpenCat(c)} role="button" tabIndex={0}
                 onKeyDown={(e) => e.key === "Enter" && setOpenCat(c)}>
              <div className="cm-card-head">
                <TierArt tier={c.tier} size={64} />
                <div>
                  <b>{t("Кот")} #{c.id}</b>
                  <span className="cm-tier" style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span>
                </div>
              </div>
              <div className="cm-kv">
                <span><img src={stockLogo(c.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />{c.sym}</span>
                <span className="cm-divs">${c.divs} {t("накоплено")}</span>
              </div>
              <div className="cm-foot">
                <span className="cm-seller">{c.listed ? `${t("на бирже")} · ${c.price} ETH` : `${t("выплаты")} →`}</span>
                {live ? (
                  c.listed ? (
                    <button className="btn sm-btn" onClick={(e) => { e.stopPropagation(); setSb(SB.unlistCat(sb, c.id)); say(t("Снято с продажи")); }}>
                      {t("Снять")}
                    </button>
                  ) : (
                    <button className="btn sm-btn" onClick={(e) => { e.stopPropagation(); doList(c); }}>{t("Продать")}</button>
                  )
                ) : (
                  <button className="btn sm-btn"
                          onClick={(e) => { e.stopPropagation(); say(t("Продажа откроется с деплоем контрактов.")); }}>
                    {t("Продать")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>{t("Демо-коллекция. Подключим к кошельку после деплоя контрактов.")}</div>
    </>
  );
}

// Рейтинг холдеров
function demoHolders() {
  let x = 7;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const cats = Math.max(1, Math.round(rnd() * 34) + (i < 3 ? 20 : 0));
    const legend = Math.round(rnd() * (i < 3 ? 4 : 1));
    const weight = Math.round(cats * (1.4 + rnd() * 1.6)) + legend * 8;
    return {
      addr: "0x" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0") + "…" + Math.floor(rnd() * 0xffff).toString(16).padStart(4, "0"),
      cats, legend, weight,
      earned: Math.round(weight * (3 + rnd() * 12) * 10) / 10,
    };
  });
  return rows.sort((a, b) => b.weight - a.weight);
}
const HOLDERS = demoHolders();

// Коллекция конкретного холдера (демо, детерминированно по адресу)
function holderCats(h) {
  if (h.list) return [...h.list].sort((a, b) => b.tier - a.tier); // настоящая коллекция
  let x = 0;
  for (const ch of h.addr) x = (x * 31 + ch.charCodeAt(0)) % 233280;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const n = Math.min(h.cats, 18);
  const rows = Array.from({ length: n }, (_, i) => {
    const r = rnd();
    let tier = r < 0.58 ? 0 : r < 0.8 ? 1 : r < 0.92 ? 2 : r < 0.985 ? 3 : 4;
    if (i < h.legend) tier = 4; // легендарные из рейтинга — первыми
    return {
      id: 100 + Math.floor(rnd() * 900),
      tier,
      sym: RWA_POPULAR[Math.floor(rnd() * RWA_POPULAR.length)],
      divs: Math.round(RARITIES[tier].mult * (1 + rnd() * 8) * 10) / 10,
    };
  });
  return rows.sort((a, b) => b.tier - a.tier);
}

function HolderModal({ t, holder, onClose }) {
  const rows = useMemo(() => holderCats(holder), [holder]);
  const byTier = useMemo(() => {
    const m = [0, 0, 0, 0, 0];
    rows.forEach((c) => { m[c.tier] += 1; });
    return m;
  }, [rows]);

  return (
    <div className="modal-back open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rev-launch-modal cat-modal">
        <div className="rev-lm-head">
          <b className="hold-addr" style={{ fontSize: 15 }}>{holder.addr}</b>
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="cat-modal-kv" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          <div><span>{t("котов")}</span><b>{holder.cats}</b></div>
          <div><span>{t("вес")}</span><b>×{holder.weight}</b></div>
          <div><span>{t("легендарных")}</span><b style={{ color: RARITIES[4].color }}>{holder.legend || "—"}</b></div>
          <div><span>{t("заработано")}</span><b className="rev-gold">${holder.earned}</b></div>
        </div>

        <div className="cat-sec-title">{t("Состав коллекции")}</div>
        <div className="hm-tiers">
          {RARITIES.map((r, i) => (
            <span key={r.key} style={{ color: byTier[i] ? r.color : "var(--text-dim)" }}>
              {t(r.ru)}: <b>{byTier[i]}</b>
            </span>
          ))}
        </div>

        <div className="cat-sec-title">
          {t("Коты холдера")} {rows.length < holder.cats && <span className="dim">({t("первые")} {rows.length})</span>}
        </div>
        <div className="hm-grid">
          {rows.map((c, i) => {
            const r = RARITIES[c.tier];
            return (
              <div className="hm-cat" key={i} style={{ borderColor: r.color + "55" }}>
                <TierArt tier={c.tier} size={48} />
                <div className="hm-cat-info">
                  <b>#{c.id}</b>
                  <span style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span>
                  <span className="hm-cat-sym">
                    <img src={stockLogo(c.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    {c.sym} · <span className="rev-gold">${c.divs}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hint" style={{ marginTop: 12 }}>{t("Демо-коллекция. После деплоя читается по он-чейн владению NFT.")}</div>
      </div>
    </div>
  );
}

function Holders({ t, sb }) {
  const [sort, setSort] = useState("weight");
  const [openHolder, setOpenHolder] = useState(null);

  // в тестовом режиме рейтинг строится ТОЛЬКО из настоящих владельцев
  // (пока это один кошелёк — мой); выдуманных холдеров не показываем
  const source = useMemo(() => {
    if (!sb?.enabled) return HOLDERS;
    if (!sb.cats.length) return [];
    const st = SB.stats(sb);
    return [{
      addr: t("я"),
      cats: st.count,
      legend: st.byTier[4],
      weight: st.weight,
      earned: Math.round(st.divs * 10) / 10,
      list: sb.cats.map((c) => ({ id: c.id, tier: c.tier, sym: c.sym, divs: c.divs })),
    }];
  }, [sb, t]);

  const rows = useMemo(() => {
    const by = { weight: (a, b) => b.weight - a.weight, cats: (a, b) => b.cats - a.cats, earned: (a, b) => b.earned - a.earned }[sort];
    return [...source].sort(by);
  }, [sort, source]);
  const totalCats = source.reduce((s, h) => s + h.cats, 0);

  return (
    <>
      {openHolder && <HolderModal t={t} holder={openHolder} onClose={() => setOpenHolder(null)} />}
      <div className="rev-stats" style={{ justifyContent: "flex-start", marginTop: 4 }}>
        <div><b>{source.length}</b><span>{t("холдеров")}</span></div>
        <div><b>{totalCats}</b><span>{t("котов у холдеров")}</span></div>
        <div><b>{source.reduce((s, h) => s + h.legend, 0)}</b><span>{t("легендарных на руках")}</span></div>
      </div>

      <div className="quote-tabs" style={{ margin: "16px 0 12px" }}>
        <button type="button" className={`quote-tab qt-sm ${sort === "weight" ? "on" : ""}`} onClick={() => setSort("weight")}>{t("По весу выплат")}</button>
        <button type="button" className={`quote-tab qt-sm ${sort === "cats" ? "on" : ""}`} onClick={() => setSort("cats")}>{t("По числу котов")}</button>
        <button type="button" className={`quote-tab qt-sm ${sort === "earned" ? "on" : ""}`} onClick={() => setSort("earned")}>{t("По заработку")}</button>
      </div>

      <div className="hold-table">
        <div className="hold-head">
          <span>#</span><span>{t("кошелёк")}</span><span>{t("котов")}</span>
          <span>{t("легендарных")}</span><span>{t("вес")}</span><span>{t("заработано")}</span>
        </div>
        {rows.map((h, i) => (
          <div className={`hold-row hold-row-click ${i < 3 ? "top" : ""}`} key={h.addr}
               onClick={() => setOpenHolder(h)} role="button" tabIndex={0}
               onKeyDown={(e) => e.key === "Enter" && setOpenHolder(h)}>
            <span className="hold-rank">{i + 1}</span>
            <span className="hold-addr">{h.addr}</span>
            <span><b>{h.cats}</b></span>
            <span style={{ color: h.legend ? RARITIES[4].color : "var(--text-dim)" }}>{h.legend || "—"}</span>
            <span>×{h.weight}</span>
            <span className="rev-gold">${h.earned}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="center dim" style={{ padding: 30 }}>
            {t("Холдеров пока нет — рейтинг наполнится, когда коты появятся на руках.")}
          </div>
        )}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {sb?.enabled
          ? t("Тестовый режим: в рейтинге только настоящие владельцы котов.")
          : t("Демо-рейтинг. После деплоя строится по он-чейн владельцам NFT.")}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- песочница
// Тестовый режим: 10 000 боксов себе, реальные открытия, листинги и дивиденды.
// Состояние живёт в localStorage — обкатываем весь цикл до деплоя контрактов.
// Док админки: панель уезжает влево за край экрана, наружу торчит язычок.
// Виден только команде — обычный игрок о песочнице даже не догадывается.
function AdminDock({ t, sb, setSb }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`adm-dock ${open ? "open" : ""}`}>
      <button className="adm-tab" onClick={() => setOpen(!open)} title={t("Админ-панель")}>
        <span>{open ? "‹" : "🧪"}</span>
      </button>
      <div className="adm-body">
        <SandboxPanel t={t} sb={sb} setSb={setSb} />
      </div>
    </div>
  );
}

function SandboxPanel({ t, sb, setSb }) {
  const [amount, setAmount] = useState(50);
  const st = SB.stats(sb);

  return (
    <div className="sbx">
      <div className="sbx-head">
        <b>🧪 {t("Тестовый режим")}</b>
        <span className="rev-demo-tag">{sb.enabled ? t("включён") : t("выключен")}</span>
      </div>
      {!sb.enabled ? (
        <>
          <p className="hint" style={{ margin: "0 0 10px" }}>
            {t("Выдаст тебе все 10 000 боксов, чтобы обкатать цикл: открытие кейсов, коллекция, биржа, дивиденды. Состояние хранится только в этом браузере.")}
          </p>
          <button className="btn btn-primary" onClick={() => setSb(SB.enableSandbox(RWA_POPULAR))}>
            {t("Выдать себе 10 000 боксов")}
          </button>
        </>
      ) : (
        <>
          <div className="sbx-grid">
            <div><b>{sb.myBoxes.toLocaleString("ru-RU")}</b><span>{t("боксов у меня")}</span></div>
            <div><b>{sb.opened.toLocaleString("ru-RU")}</b><span>{t("открыто")}</span></div>
            <div><b>{st.count}</b><span>{t("котов")}</span></div>
            <div><b>×{st.weight}</b><span>{t("вес")}</span></div>
            <div><b className="rev-gold">${st.divs}</b><span>{t("дивидендов")}</span></div>
            <div><b>{st.listed}</b><span>{t("на бирже")}</span></div>
          </div>
          <div className="sbx-actions">
            <div className="suffix-input" style={{ maxWidth: 180 }}>
              <input value={amount} onChange={(e) => setAmount(+e.target.value || 0)} inputMode="decimal" />
              <b>$</b>
            </div>
            <button className="btn" onClick={() => setSb(SB.distribute(sb, amount))} disabled={!st.count}>
              {t("Раздать дивиденды из казны")}
            </button>
            <button className="btn btn-danger" onClick={() => setSb(SB.reset())}>{t("Сбросить песочницу")}</button>
          </div>
          {sb.log?.length > 0 && (
            <div className="sbx-log">
              {sb.log.slice(0, 6).map((l, i) => (
                <div key={i}><span>{new Date(l.ts).toLocaleTimeString("ru-RU")}</span> {l.text}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- кликер
// Тапаешь легендарного кота — сыплются акции. Очки дают только билеты в
// розыгрыш: каждые 30 минут один NFT-кот уходит игроку. На дивиденды игра
// не влияет — это чистый маркетинг, раздача котов и хайп вокруг проекта.
// соперники и их очки берутся из clicker.js (roundPlayers) — детерминированно
// по номеру раунда, чтобы у всех игроков был один и тот же список

// Магазин прокачки: четыре ветки, покупка по 1 / 10 / максимум,
// закрытые улучшения показываются с требуемым уровнем — видно, к чему идти.
function Shop({ t, g, setG }) {
  const [cat, setCat] = useState("click");
  const [bulk, setBulk] = useState(1); // 1 | 10 | 0 (0 = максимум)
  const lvl = CL.levelOf(g.totalEarned || 0);
  const list = CL.UPGRADES.filter((u) => u.cat === cat);

  // сколько улучшений в ветке доступно к покупке прямо сейчас — точка на вкладке
  const ready = (id) => CL.UPGRADES.some((u) => u.cat === id && CL.unlocked(g, u)
    && !CL.maxed(g, u) && g.points >= CL.upgradeCost(u, g.levels[u.id] || 0));

  return (
    <aside className="ck-shop-col">
      <div className="ck-col-h">
        <span>{t("Улучшения")}</span>
        <span className="dim">{Math.floor(g.points).toLocaleString("ru-RU")} {t("очков")}</span>
      </div>

      <div className="ck-shop-tabs">
        {CL.UPGRADE_CATS.map((c) => (
          <button key={c.id} className={`ck-stab ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>
            <span>{c.icon}</span>{t(c.ru)}
            {ready(c.id) && <i className="ck-stab-dot" />}
          </button>
        ))}
      </div>

      <div className="ck-bulk">
        {[1, 10, 0].map((n) => (
          <button key={n} className={`ck-bulk-b ${bulk === n ? "on" : ""}`} onClick={() => setBulk(n)}>
            {n === 0 ? t("макс") : `×${n}`}
          </button>
        ))}
      </div>

      {list.map((u) => {
        const l = g.levels[u.id] || 0;
        const open = CL.unlocked(g, u);
        const full = CL.maxed(g, u);
        const aff = CL.affordable(g, u, bulk === 0 ? 100 : bulk);
        const count = bulk === 0 ? aff.n : Math.min(bulk, u.max ? u.max - l : bulk);
        const cost = count > 0 ? CL.bulkCost(u, l, count) : CL.upgradeCost(u, l);
        const can = open && !full && count > 0 && g.points >= cost;

        if (!open) {
          return (
            <div className="ck-upg locked" key={u.id}>
              <span className="ck-upg-ico">🔒</span>
              <span className="ck-upg-txt"><b>{t(u.ru)}</b><i>{t("откроется на уровне")} {u.req}</i></span>
              <span className="ck-upg-buy"><i>{t("ур.")} {lvl}/{u.req}</i></span>
            </div>
          );
        }
        return (
          <button className={`ck-upg ${can ? "" : "off"} ${u.kind} ${full ? "full" : ""}`} key={u.id}
                  disabled={!can} onClick={() => setG(CL.buy(g, u.id, count))}>
            <span className="ck-upg-ico">{u.icon}</span>
            <span className="ck-upg-txt">
              <b>{t(u.ru)}</b>
              <i>{t(u.desc)}{u.max ? ` · ${t("макс")} ${u.max}` : ""}</i>
            </span>
            <span className="ck-upg-buy">
              {full ? <b className="rev-gold">MAX</b> : <b>{cost.toLocaleString("ru-RU")}</b>}
              <i>{l > 0 ? `${t("ур.")} ${l}` : t("купить")}{!full && count > 1 ? ` · +${count}` : ""}</i>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

function Clicker({ t, sb, setSb }) {
  const [g, setG] = useState(() => CL.load());
  const [flyers, setFlyers] = useState([]);
  const [bump, setBump] = useState(false);
  const [toast, setToast] = useState("");
  const [golden, setGolden] = useState(null); // { x, y } — золотой кот на поле
  const [par, setPar] = useState({ x: 0, y: 0 }); // лёгкий параллакс фона
  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect();
    setPar({
      x: ((e.clientX - r.left) / r.width - 0.5) * -18,
      y: ((e.clientY - r.top) / r.height - 0.5) * -12,
    });
  }

  const [now, setNow] = useState(() => Date.now());
  // свежая песочница для колбэка внутри интервала
  const sbRef = React.useRef(sb);
  useEffect(() => { sbRef.current = sb; }, [sb]);

  // раз в секунду: автодобыча, таймер раунда и автозакрытие раунда розыгрыша
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setG((s) => {
        const ticked = CL.tick(s);
        const { state, drawn } = CL.settle(ticked, CL.roundPlayers(ticked.round), null);
        if (drawn.length) {
          const mine = drawn.find((d) => d.me);
          if (mine) {
            setTimeout(() => {
              if (sbRef.current.enabled) {
                const { state: s2 } = SB.openBox({ ...sbRef.current, myBoxes: sbRef.current.myBoxes + 1 }, RWA_POPULAR);
                setSb(s2);
              }
              say(t("🎉 Раунд закрыт — кот твой! Шанс был {c}%").replace("{c}", mine.chance));
            }, 0);
          }
        }
        return state;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // офлайн-доход: считаем один раз при открытии вкладки
  useEffect(() => {
    const { state, gain, away } = CL.collectOffline(CL.load());
    if (gain > 0) {
      setG(state);
      const h = Math.floor(away / 3600), m = Math.round((away % 3600) / 60);
      say(t("🌙 Ночная смена наработала +{n} очков за {tm}")
        .replace("{n}", gain.toLocaleString("ru-RU"))
        .replace("{tm}", h ? `${h} ч ${m} мин` : `${m} мин`));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // золотой кот сам исчезает через 4 секунды
  useEffect(() => {
    if (!golden) return;
    const id = setTimeout(() => setGolden(null), 4000);
    return () => clearTimeout(id);
  }, [golden]);

  // соперники текущего раунда: пересчитываем раз в 5 секунд, чтобы список
  // не дёргался каждый тик, но очки у людей на глазах росли
  const pool = useMemo(
    () => CL.roundPlayers(g.round, now),
    [g.round, Math.floor(now / 5000)] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalPoints = CL.poolTotal(pool) + (g.roundPoints || 0);
  // таблица раунда: соперники + я, по убыванию очков
  const board = useMemo(() => (
    [...pool, { addr: t("ты"), points: g.roundPoints || 0, me: true }]
      .map((p) => ({ ...p, pct: totalPoints > 0 ? (p.points / totalPoints) * 100 : 0 }))
      .sort((a, b) => b.points - a.points)
  ), [pool, g.roundPoints, totalPoints, t]);

  const perClick = CL.perClick(g);
  const perSec = CL.perSecond(g);
  const chance = CL.raffleChance(g, totalPoints);
  const combo = CL.comboMult(g);
  const crit = CL.critChance(g);
  const lvl = CL.levelProgress(g.totalEarned || 0);
  const goldenOn = CL.goldenActive(g);

  function addFlyer(x, y, text, cls) {
    const id = Date.now() + Math.random();
    const sym = RWA_POPULAR[Math.floor(Math.random() * RWA_POPULAR.length)];
    setFlyers((f) => [...f, { id, x, y, text, cls, sym, dx: (Math.random() - 0.5) * 110 }]);
    setTimeout(() => setFlyers((f) => f.filter((z) => z.id !== id)), 1100);
  }

  function onTap(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const res = CL.click(g);
    setG(res.state);
    setBump(true);
    setTimeout(() => setBump(false), 90);
    addFlyer(x, y, `+${res.gain}`, res.crit ? "crit" : res.mult > 1 ? "combo" : "");
    // шанс появления золотого кота
    if (!golden && Math.random() < CL.goldenChance(g)) {
      setGolden({ x: 12 + Math.random() * 70, y: 12 + Math.random() * 66 });
    }
  }

  function tapGolden(e) {
    e.stopPropagation();
    const { state, jackpot } = CL.catchGolden(g);
    setG(state);
    setGolden(null);
    say(t("🐱‍👤 Золотой кот пойман! +{n} очков и ×2 на 20 секунд").replace("{n}", jackpot.toLocaleString("ru-RU")));
  }

  // кнопка для теста: закрыть раунд немедленно, не дожидаясь таймера
  function doRaffle() {
    if ((g.roundPoints || 0) <= 0) return say(t("Сначала накликай очков — билеты дают очки текущего раунда."));
    const { state, drawn } = CL.settle(g, pool, null, true);
    setG(state);
    const mine = drawn.find((d) => d.me);
    if (mine) {
      if (sb.enabled) {
        const { state: s2 } = SB.openBox({ ...sb, myBoxes: sb.myBoxes + 1 }, RWA_POPULAR);
        setSb(s2);
      }
      say(t("🎉 Ты выиграл NFT-кота! (шанс был {c}%)").replace("{c}", mine.chance));
    } else {
      say(t("Кот ушёл другому игроку — шанс был {c}%. Следующий раунд через 30 минут.").replace("{c}", drawn[0].chance));
    }
  }

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {toast && <div className="rev-toast">{toast}</div>}

      {/* верхняя панель показателей */}
      <div className="ck-top">
        <div className="ck-stat big"><b>{Math.floor(g.points).toLocaleString("ru-RU")}</b><span>{t("очков")}</span></div>
        <div className="ck-stat"><b>+{perClick}</b><span>{t("за клик")}</span></div>
        <div className="ck-stat"><b>+{perSec}/{t("сек")}</b><span>{t("автодобыча")}</span></div>
        <div className="ck-stat"><b>{crit}% <em className="ck-stat-x">×{CL.critMult(g)}</em></b><span>{t("шанс крита")}</span></div>
        <div className="ck-stat"><b className="rev-gold">{chance.toFixed(1)}%</b><span>{t("шанс в раунде")}</span></div>
        <div className="ck-stat"><b>{g.wonCards}</b><span>{t("выиграно котов")}</span></div>
      </div>

      {/* уровень игрока */}
      <div className="ck-level">
        <span className="ck-lvl-badge">{t("Уровень")} {lvl.lvl}</span>
        <div className="ck-lvl-bar"><span style={{ width: `${lvl.pct}%` }} /></div>
        <span className="dim">{Math.floor(lvl.pct)}% {t("до")} {lvl.lvl + 1}</span>
      </div>

      <div className="ck-arena-wrap">
        {/* слева: прокачка — ветки, разблокировка по уровню, покупка пачками */}
        <Shop t={t} g={g} setG={setG} />

        {/* арена с котом */}
        <div className={`ck-arena ${goldenOn ? "boosted" : ""}`} onClick={onTap}
             onMouseMove={onMove} onMouseLeave={() => setPar({ x: 0, y: 0 })}>
          <div className="ck-bg" style={{
            backgroundImage: "url(./cats/arena-bg.webp)",
            transform: `scale(1.08) translate(${par.x}px, ${par.y}px)`,
          }} />
          <div className="ck-bg-veil" />
          {combo > 1 && <div className="ck-combo">COMBO ×{combo}{combo >= CL.comboCap(g) ? " MAX" : ""}</div>}
          {goldenOn && <div className="ck-boost-tag">×2 {t("буст активен")}</div>}
          {/* кот — фоновая картинка, а не <img>: браузеры вешают на картинки
              свою панель «поиск по изображению», которая мешает тапать */}
          <div className={`ck-img ${bump ? "bump" : ""}`} role="img" aria-label="cat"
               style={{ backgroundImage: "url(./cats/legendary.webp)" }} />
          <div className="ck-tap-hint">{t("Тапай кота")}</div>

          {golden && (
            <button className="ck-golden" style={{ left: `${golden.x}%`, top: `${golden.y}%` }} onClick={tapGolden}>
              <i style={{ backgroundImage: "url(./cats/mythic.webp)" }} />
              <span>{t("Лови!")}</span>
            </button>
          )}

          {/* прозрачная накладка поверх картинок: под курсором всегда обычный
              div, поэтому браузер не предлагает «поиск по изображению».
              Клики сквозь неё всплывают на арену и считаются тапами. */}
          <div className="ck-catch" />

          {flyers.map((f) => (
            <span key={f.id} className={`ck-fly ${f.cls}`} style={{ left: f.x, top: f.y, "--dx": `${f.dx}px` }}>
              <img src={stockLogo(f.sym)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              {f.text}{f.cls === "crit" ? " CRIT!" : ""}
            </span>
          ))}
        </div>

        {/* правая колонка: розыгрыш + итоги */}
        <div className="ck-side">
          <div className="ck-card">
            <div className="ck-card-h">
              <span>{t("Розыгрыш кота")}</span>
              <span className="ck-round-tag">{t("раунд")} #{(g.round ?? CL.roundId()) % 10000}</span>
            </div>

            {/* таймер до конца раунда */}
            <div className="ck-timer">
              <b>{CL.fmtLeft(CL.msLeft(now))}</b>
              <span>{t("до розыгрыша")}</span>
            </div>
            <div className="ck-timer-bar"><span style={{ width: `${CL.roundProgress(now)}%` }} /></div>

            <div className="clk-chance">
              <div className="clk-chance-bar"><span style={{ width: `${Math.min(100, chance)}%` }} /></div>
              <b>{chance.toFixed(1)}%</b>
            </div>
            <div className="clk-raffle-kv">
              <span>{t("мои очки раунда")}: <b>{Math.floor(g.roundPoints || 0).toLocaleString("ru-RU")}</b></span>
              <span>{t("всего у игроков")}: <b>{Math.round(totalPoints).toLocaleString("ru-RU")}</b></span>
              <span>{t("котов в сутки")}: <b>{CL.ROUNDS_PER_DAY}</b></span>
            </div>
            <button className="btn btn-block" onClick={doRaffle}>{t("Разыграть сейчас (тест)")}</button>
            {g.lastRaffle && (
              <div className="hint" style={{ marginTop: 6 }}>
                {g.lastRaffle.won
                  ? t("Последний розыгрыш: победа! Шанс был {c}%").replace("{c}", g.lastRaffle.chance)
                  : t("Последний розыгрыш: мимо. Шанс был {c}%").replace("{c}", g.lastRaffle.chance)}
              </div>
            )}
          </div>

          {/* кто сейчас в раунде и с каким шансом */}
          <div className="ck-card">
            <div className="ck-card-h">
              <span>{t("Игроки раунда")}</span>
              <span className="ck-round-tag">{board.length}</span>
            </div>
            <div className="ck-board">
              {board.map((p, i) => (
                <div className={`ck-bd ${p.me ? "me" : ""}`} key={`${p.addr}-${i}`}>
                  <span className="ck-bd-n">{i + 1}</span>
                  <span className="ck-bd-a">{p.addr}</span>
                  <span className="ck-bd-p">{Math.round(p.points).toLocaleString("ru-RU")}</span>
                  <span className="ck-bd-c">{p.pct.toFixed(1)}%</span>
                  <span className="ck-bd-bar" style={{ width: `${Math.min(100, p.pct)}%` }} />
                </div>
              ))}
            </div>
          </div>

          {/* победители последних раундов */}
          <div className="ck-card">
            <div className="ck-card-h">{t("Победители раундов")}</div>
            {(g.winners || []).length === 0 ? (
              <div className="hint">{t("Пока никто не выигрывал — первый раунд ещё идёт.")}</div>
            ) : (
              <div className="ck-winners">
                {(g.winners || []).slice(0, 8).map((wn, i) => (
                  <div className={`ck-win ${wn.me ? "me" : ""}`} key={`${wn.round}-${wn.ts}-${i}`}>
                    <img src="./cats/legendary.webp" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    <span className="ck-win-addr">{wn.me ? t("ты") : wn.addr}</span>
                    <span className="ck-win-pts">{wn.points.toLocaleString("ru-RU")} {t("оч.")}</span>
                    <span className="ck-win-ts">{fmtTime(wn.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ck-card">
            <div className="ck-card-h">{t("Рекорды")}</div>
            <div className="clk-raffle-kv">
              <span>{t("кликов всего")}: <b>{g.totalClicks.toLocaleString("ru-RU")}</b></span>
              <span>{t("лучшее комбо")}: <b>{g.bestCombo || 0}</b></span>
              <span>{t("золотых котов")}: <b className="rev-gold">{g.goldenCaught || 0}</b></span>
              <span>{t("всего заработано")}: <b>{Math.floor(g.totalEarned || 0).toLocaleString("ru-RU")}</b></span>
            </div>
            <button className="btn btn-block" onClick={() => setG(CL.reset())}>{t("Сбросить прогресс")}</button>
          </div>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 12 }}>
        {t("Комбо ×5 за быстрые тапы, криты ×10, золотой кот с джекпотом и ×2. Каждые 30 минут один NFT-кот разыгрывается среди игроков — билетов тем больше, чем больше очков ты набрал за раунд. На выплаты дивидендов игра не влияет: доля кота зависит только от его редкости.")}
      </div>
    </>
  );
}

export default function Cats({ wallet }) {
  const { t, lang } = useLang();
  const admin = isTeam(wallet?.account);
  const [tab, setTab] = useState("clicker"); // clicker | market | boxes | my | holders | guide | about
  // переход на вкладку с прокруткой к её началу
  const goTab = (id) => {
    setTab(id);
    setTimeout(() => document.getElementById("cats-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  const [sb, setSb] = useState(() => SB.load());
  const [ranges, setRanges] = useState({ tier: 2, per: 12, months: 6 });
  const set = (k) => (e) => setRanges({ ...ranges, [k]: +e.target.value });

  // простой калькулятор дивидендов кота
  const tierMult = RARITIES[ranges.tier].mult;
  const monthly = useMemo(() => Math.round(ranges.per * tierMult / 3 * 100) / 100, [ranges.per, tierMult]);
  const total = useMemo(() => Math.round(monthly * ranges.months * 100) / 100, [monthly, ranges.months]);

  const cards = RWA_POPULAR.slice(0, 8);

  const faq = [
    [t("Откуда берутся выплаты?"), t("Из казны платформы: часть реальных комиссий с торгов hood конвертируется в токенизированные акции и распределяется между всеми котами. Нет комиссий — нет выплат; контракт ничего не обещает и не печатает.")],
    [t("Как влияет редкость?"), t("Редкость задаёт вес кота при каждом распределении: Обычный ×1, Редкий ×2, Эпический ×3, Мифический ×5, Легендарный ×8. Легендарный кот (шанс 1%) получает в 8 раз больше акций с каждого транша, чем Обычный.")],
    [t("Что будет с дивидендами, если я продам кота?"), t("Дивиденды копятся на самом коте. Продал или подарил кота — невыплаченное уезжает вместе с ним новому владельцу. Кот — это актив с накопленной ценностью.")],
    [t("Зачем бесплатная раздача?"), t("Первые коты раздаются бесплатно ранним пользователям: держа кота, ты становишься совладельцем — тебе выгодно продвигать платформу, ведь чем больше на ней торгуют, тем больше акций падает твоему коту.")],
  ];

  return (
    <div className="rev-page">
      <div className="rev-hero">
        <h1>🐱 {t("Коты-брокеры")}</h1>
        <p className="rev-sub">
          {t("NFT-коты, привязанные к настоящим акциям. Казна платит держателям котов дивиденды в токенизированных акциях — чем выше редкость кота, тем больше его доля. Держишь кота — ты совладелец платформы.")}
        </p>
        <div className="rev-cta">
          <button className="btn btn-primary" onClick={() => document.getElementById("cats-wl")?.scrollIntoView({ behavior: "smooth" })}>{t("В список на бесплатного кота")}</button>
          <button className="btn" onClick={() => goTab("guide")}>{t("Как это работает")}</button>
        </div>
      </div>

      <div id="cats-tabs" className="quote-tabs" style={{ justifyContent: "center", margin: "10px 0 6px", flexWrap: "wrap" }}>
        <button type="button" className={`quote-tab ${tab === "clicker" ? "on" : ""}`} onClick={() => setTab("clicker")}>🐾 {t("Кликер")}</button>
        <button type="button" className={`quote-tab ${tab === "market" ? "on" : ""}`} onClick={() => setTab("market")}>🏪 {t("Биржа котов")}</button>
        <button type="button" className={`quote-tab ${tab === "boxes" ? "on" : ""}`} onClick={() => setTab("boxes")}>🎁 {t("Кейсы")}</button>
        <button type="button" className={`quote-tab ${tab === "my" ? "on" : ""}`} onClick={() => setTab("my")}>{t("Мои коты")}</button>
        <button type="button" className={`quote-tab ${tab === "holders" ? "on" : ""}`} onClick={() => setTab("holders")}>🏆 {t("Рейтинг")}</button>
        <button type="button" className={`quote-tab ${tab === "guide" ? "on" : ""}`} onClick={() => setTab("guide")}>📖 {t("Инструкция")}</button>
        <button type="button" className={`quote-tab ${tab === "about" ? "on" : ""}`} onClick={() => setTab("about")}>{t("Об игре")}</button>
      </div>

      {admin && <AdminDock t={t} sb={sb} setSb={setSb} />}

      {tab === "clicker" && <Clicker t={t} sb={sb} setSb={setSb} />}
      {tab === "boxes" && <Boxes t={t} sb={sb} setSb={setSb} />}
      {tab === "market" && <Market t={t} sb={sb} setSb={setSb} />}
      {tab === "my" && <MyCats t={t} sb={sb} setSb={setSb} />}
      {tab === "holders" && <Holders t={t} sb={sb} />}
      {tab === "guide" && <CatsGuide lang={lang} t={t} rarities={RARITIES} onTab={goTab} />}

      {tab === "about" && (<>
      <h2 className="rev-h2">{t("Уровни редкости")}</h2>
      <div className="cats-tiers">
        {RARITIES.map((r) => (
          <div className="cats-tier" key={r.key} style={{ borderColor: r.color + "66" }}>
            <TierArt tier={RARITIES.indexOf(r)} size={72} />
            <b style={{ color: r.color }}>{t(r.ru)}</b>
            <div className="cats-tier-kv"><span>{t("шанс")}</span><b>{r.chance}%</b></div>
            <div className="cats-tier-kv"><span>{t("вес выплат")}</span><b>×{r.mult}</b></div>
          </div>
        ))}
      </div>

      <h2 className="rev-h2" id="cats-how">{t("Как работают дивиденды")}</h2>
      <div className="rev-steps">
        <div className="rev-step"><b>{t("1 · Казна собирает комиссии")}</b><span>{t("Часть реальных сборов hood с торгов идёт в кошачью казну.")}</span></div>
        <div className="rev-step"><b>{t("2 · Покупка акций")}</b><span>{t("Казна конвертирует их в токенизированные акции (SPY, NVDA и др.).")}</span></div>
        <div className="rev-step"><b>{t("3 · Раздача по весу")}</b><span>{t("Контракт делит акции между котами по редкости. Клеймишь — акции на кошелёк.")}</span></div>
      </div>

      <h2 className="rev-h2">{t("Прикинь дивиденды кота")} <span className="rev-demo-tag">{t("демо")}</span></h2>
      <div className="rev-calc">
        <div className="rev-sliders">
          <label>
            <span>{t("Редкость кота")}: <b style={{ color: RARITIES[ranges.tier].color }}>{t(RARITIES[ranges.tier].ru)} ×{tierMult}</b></span>
            <input type="range" min="0" max="4" step="1" value={ranges.tier} onChange={set("tier")} />
          </label>
          <label>
            <span>{t("Комиссий в казну котов")}: <b>${ranges.per}/{t("мес")}</b> {t("на кота ×1")}</span>
            <input type="range" min="1" max="100" step="1" value={ranges.per} onChange={set("per")} />
          </label>
          <label>
            <span>{t("Горизонт")}: <b>{ranges.months} {t("мес")}</b></span>
            <input type="range" min="1" max="24" step="1" value={ranges.months} onChange={set("months")} />
          </label>
        </div>
        <div className="rev-out">
          <div><b>${monthly.toLocaleString("en-US")}</b><span>{t("акций в месяц")}</span></div>
          <div><b>×{tierMult}</b><span>{t("твой вес редкости")}</span></div>
          <div><b>${total.toLocaleString("en-US")}</b><span>{t("за весь горизонт")}</span></div>
        </div>
        <div className="hint">{t("Демо-оценка. Реальные суммы зависят от оборота платформы и решений казны.")}</div>
      </div>

      <h2 className="rev-h2">{t("Ростер акций")}</h2>
      <p className="rev-sub" style={{ marginBottom: 14 }}>{t("Каждый кот привязан к акции. При минте тикер выпадает случайно.")}</p>
      <div className="cats-roster">
        {cards.map((sym) => (
          <div className="cats-roster-item" key={sym}>
            <img src={stockLogo(sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            {sym}
          </div>
        ))}
        <div className="cats-roster-item dim">+88 {t("ещё")}</div>
      </div>

      <h2 className="rev-h2">{t("Вопросы")}</h2>
      <div className="rev-faq">
        {faq.map(([q, a]) => (<details key={q}><summary>{q}</summary><p>{a}</p></details>))}
      </div>

      <div className="rev-form-wrap" id="cats-wl">
        <h2>{t("Хочешь бесплатного кота на старте?")}</h2>
        <p className="rev-sub">{t("Ранние пользователи получат котов бесплатно. Подпишись на @hoodandarrow и следи за анонсом аирдропа.")}</p>
        <a className="btn btn-primary" style={{ marginTop: 14 }} href="https://x.com/hoodandarrow" target="_blank" rel="noreferrer">{t("Следить в X")}</a>
      </div>
      </>)}

      <p className="rev-legal">
        {t("Коты и выплаты — в разработке; контракты готовы и протестированы, но не задеплоены. Дивиденды холдерам могут во многих юрисдикциях считаться ценной бумагой — секция запустится после юридической проверки.")}
      </p>
    </div>
  );
}
