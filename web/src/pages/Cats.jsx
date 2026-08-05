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
  { key: "Mythic", ru: "Мифический", chance: 5, mult: 5, color: "#e0559a" },
  { key: "Legendary", ru: "Легендарный", chance: 1, mult: 8, color: "#f5b544" },
];

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

export default function Cats() {
  const { t } = useLang();
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

      <h2 className="rev-h2">{t("Уровни редкости")}</h2>
      <div className="cats-tiers">
        {RARITIES.map((r) => (
          <div className="cats-tier" key={r.key} style={{ borderColor: r.color + "66" }}>
            <CatArt color={r.color} size={72} />
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

      <p className="rev-legal">
        {t("Коты и выплаты — в разработке; контракты готовы и протестированы, но не задеплоены. Дивиденды холдерам могут во многих юрисдикциях считаться ценной бумагой — секция запустится после юридической проверки.")}
      </p>
    </div>
  );
}
