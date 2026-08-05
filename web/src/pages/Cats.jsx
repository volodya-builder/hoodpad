import React, { useMemo, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { RWA_POPULAR, stockLogo } from "../lib/rwa.js";

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

function Market({ t }) {
  const [tier, setTier] = useState(-1); // -1 = все
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("price_asc");
  const [toast, setToast] = useState("");

  const lots = useMemo(() => {
    let out = DEMO_LOTS.filter((l) =>
      (tier === -1 || l.tier === tier) && (!q || l.sym.includes(q))
    );
    const by = {
      price_asc: (a, b) => a.price - b.price,
      price_desc: (a, b) => b.price - a.price,
      rarity: (a, b) => b.tier - a.tier,
      divs: (a, b) => b.divs - a.divs,
    }[sort];
    return [...out].sort(by);
  }, [tier, q, sort]);

  const floor = (tr) => {
    const arr = DEMO_LOTS.filter((l) => l.tier === tr);
    return arr.length ? Math.min(...arr.map((l) => l.price)) : null;
  };

  return (
    <>
      {toast && <div className="rev-toast">{toast}</div>}
      <div className="rev-stats" style={{ justifyContent: "flex-start", marginTop: 4 }}>
        <div><b>{DEMO_LOTS.length}</b><span>{t("лотов на бирже")}</span></div>
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
            <div className="cm-card" key={l.id} style={{ borderColor: r.color + "55" }}>
              <div className="cm-card-head">
                <TierArt tier={l.tier} size={64} />
                <div>
                  <b>{t("Кот")} #{l.id}</b>
                  <span className="cm-tier" style={{ color: r.color }}>{t(r.ru)} ×{r.mult}</span>
                </div>
              </div>
              <div className="cm-kv">
                <span><img src={stockLogo(l.sym)} alt="" className="q-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />{l.sym}</span>
                <span className="cm-divs" title={t("Накопленные дивиденды уедут с котом к покупателю")}>${l.divs} {t("дивидендов внутри")}</span>
              </div>
              <div className="cm-foot">
                <b>{l.price} ETH</b>
                <button className="btn btn-primary sm-btn"
                        onClick={() => { setToast(t("Биржа откроется с деплоем контрактов — кот пока не продаётся.")); setTimeout(() => setToast(""), 2600); }}>
                  {t("Купить")}
                </button>
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

export default function Cats() {
  const { t } = useLang();
  const [tab, setTab] = useState("about"); // about | market
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
        <button type="button" className={`quote-tab ${tab === "market" ? "on" : ""}`} onClick={() => setTab("market")}>🏪 {t("Биржа котов")}</button>
      </div>

      {tab === "market" && <Market t={t} />}

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
