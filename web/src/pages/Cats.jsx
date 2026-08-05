import React, { useMemo, useState, useEffect } from "react";
import { useLang } from "../lib/i18n.jsx";
import { RWA_POPULAR, stockLogo } from "../lib/rwa.js";
import * as SB from "../lib/catstate.js";

/** Коты-брокеры β — NFT-коты, привязанные к акциям, платят дивиденды из
 *  казны в токенизированных акциях; редкость даёт больший вес выплат.
 *  Контракты BrokerCats + CatStockVault готовы и оттестированы; пока не
 *  задеплоены — страница объясняет механику и собирает waitlist на аирдроп. */

const RARITIES = [
  { key: "Common", ru: "Обычный", chance: 60, mult: 1, color: "#8b93a7" },
  { key: "Rare", ru: "Редкий", chance: 24, mult: 2, color: "#4aa3e0" },
  { key: "Epic", ru: "Эпический", chance: 10, mult: 3, color: "#a06bff" },
  { key: "Mythic", ru: "Мифический", chance: 5, mult: 5, color: "#e0559a", img: "./cats/mythic.jpg" },
  { key: "Legendary", ru: "Легендарный", chance: 1, mult: 8, color: "#f5b544", img: "./cats/legendary.jpg" },
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

function Market({ t, sb, setSb }) {
  const [tier, setTier] = useState(-1); // -1 = все
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("price_asc");
  const [toast, setToast] = useState("");

  // мои лоты из песочницы идут первыми и помечены
  const myLots = useMemo(() => (sb.enabled ? sb.cats.filter((c) => c.listed).map((c) => ({
    id: c.id, sym: c.sym, tier: c.tier, price: c.price, divs: c.divs, seller: t("я"), mine: true,
  })) : []), [sb, t]);

  const ALL = useMemo(() => [...myLots, ...DEMO_LOTS], [myLots]);

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
        <div><b>{floor(0)} ETH</b><span>{t("флор Обычных")}</span></div>
        <div><b>{floor(4) ?? "—"} ETH</b><span>{t("флор Легендарных")}</span></div>
        <div><b>2%</b><span>{t("комиссия биржи — в казну")}</span></div>
      </div>

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
                  <button className="btn sm-btn"
                          onClick={() => { setSb(SB.unlistCat(sb, l.id)); setToast(t("Снято с продажи")); setTimeout(() => setToast(""), 2200); }}>
                    {t("Снять")}
                  </button>
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
        {lots.length === 0 && <div className="center dim" style={{ gridColumn: "1/-1", padding: 30 }}>{t("Ничего не найдено")}</div>}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {t("Демо-витрина. Контракт биржи готов (эскроу, 2% казне, дивиденды переезжают с котом) — включим с деплоем.")}
      </div>
    </>
  );
}

// Кейсы: рулетка открытия в стиле CS:GO
function Boxes({ t, sb, setSb }) {
  const [phase, setPhase] = useState("idle"); // idle | rolling | result
  const [result, setResult] = useState(null);
  const [strip, setStrip] = useState([]);
  const SOLD_DEMO = 1287; // демо-счётчик проданных боксов (когда песочница выключена)

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
    items[36] = win;
    setStrip(items);
    setResult(null);
    setPhase("rolling");
    setTimeout(() => {
      setResult({ tier: win, sym, id: catId });
      setPhase("result");
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
        <div className="roll-wrap">
          <div className="roll-marker" />
          <div className={`roll-strip ${phase === "rolling" ? "spin" : "done"}`}>
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

function Holders({ t }) {
  const [sort, setSort] = useState("weight");
  const [openHolder, setOpenHolder] = useState(null);
  const rows = useMemo(() => {
    const by = { weight: (a, b) => b.weight - a.weight, cats: (a, b) => b.cats - a.cats, earned: (a, b) => b.earned - a.earned }[sort];
    return [...HOLDERS].sort(by);
  }, [sort]);
  const totalCats = HOLDERS.reduce((s, h) => s + h.cats, 0);

  return (
    <>
      {openHolder && <HolderModal t={t} holder={openHolder} onClose={() => setOpenHolder(null)} />}
      <div className="rev-stats" style={{ justifyContent: "flex-start", marginTop: 4 }}>
        <div><b>{HOLDERS.length}</b><span>{t("холдеров")}</span></div>
        <div><b>{totalCats}</b><span>{t("котов у холдеров")}</span></div>
        <div><b>{HOLDERS.reduce((s, h) => s + h.legend, 0)}</b><span>{t("легендарных на руках")}</span></div>
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
      </div>
      <div className="hint" style={{ marginTop: 10 }}>{t("Демо-рейтинг. После деплоя строится по он-чейн владельцам NFT.")}</div>
    </>
  );
}

// ---------------------------------------------------------------- песочница
// Тестовый режим: 10 000 боксов себе, реальные открытия, листинги и дивиденды.
// Состояние живёт в localStorage — обкатываем весь цикл до деплоя контрактов.
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

export default function Cats() {
  const { t } = useLang();
  const [tab, setTab] = useState("about"); // about | boxes | market | my | holders
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
        <span className="chip rev-beta">β · {t("контракты готовы, скоро деплой")}</span>
        <h1>🐱 {t("Коты-брокеры")}</h1>
        <p className="rev-sub">
          {t("NFT-коты, привязанные к настоящим акциям. Казна платит держателям котов дивиденды в токенизированных акциях — чем выше редкость кота, тем больше его доля. Держишь кота — ты совладелец платформы.")}
        </p>
        <div className="rev-cta">
          <button className="btn btn-primary" onClick={() => document.getElementById("cats-wl")?.scrollIntoView({ behavior: "smooth" })}>{t("В список на бесплатного кота")}</button>
          <a className="btn" href="#cats-how">{t("Как это работает")}</a>
        </div>
      </div>

      <div className="quote-tabs" style={{ justifyContent: "center", margin: "10px 0 6px" }}>
        <button type="button" className={`quote-tab ${tab === "about" ? "on" : ""}`} onClick={() => setTab("about")}>{t("Об игре")}</button>
        <button type="button" className={`quote-tab ${tab === "boxes" ? "on" : ""}`} onClick={() => setTab("boxes")}>🎁 {t("Кейсы")}</button>
        <button type="button" className={`quote-tab ${tab === "market" ? "on" : ""}`} onClick={() => setTab("market")}>🏪 {t("Биржа котов")}</button>
        <button type="button" className={`quote-tab ${tab === "my" ? "on" : ""}`} onClick={() => setTab("my")}>{t("Мои коты")}</button>
        <button type="button" className={`quote-tab ${tab === "holders" ? "on" : ""}`} onClick={() => setTab("holders")}>🏆 {t("Рейтинг")}</button>
      </div>

      <SandboxPanel t={t} sb={sb} setSb={setSb} />

      {tab === "boxes" && <Boxes t={t} sb={sb} setSb={setSb} />}
      {tab === "market" && <Market t={t} sb={sb} setSb={setSb} />}
      {tab === "my" && <MyCats t={t} sb={sb} setSb={setSb} />}
      {tab === "holders" && <Holders t={t} />}

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
