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

// Кейсы: рулетка открытия в стиле CS:GO
function Boxes({ t }) {
  const [phase, setPhase] = useState("idle"); // idle | rolling | result
  const [result, setResult] = useState(null);
  const [strip, setStrip] = useState([]);
  const [opened, setOpened] = useState(0);
  const SOLD_DEMO = 1287; // демо-счётчик проданных боксов

  function rollRarity() {
    const r = Math.random() * 100;
    return r < 60 ? 0 : r < 84 ? 1 : r < 94 ? 2 : r < 99 ? 3 : 4;
  }

  function openBox() {
    if (phase === "rolling") return;
    const win = rollRarity();
    // лента: 40 случайных котов, выигрыш — предпоследний (на него встанет маркер)
    const items = Array.from({ length: 40 }, () => rollRarity());
    items[36] = win;
    setStrip(items);
    setResult(null);
    setPhase("rolling");
    setTimeout(() => {
      setResult({ tier: win, sym: RWA_POPULAR[Math.floor(Math.random() * RWA_POPULAR.length)] });
      setOpened((n) => n + 1);
      setPhase("result");
    }, 4200);
  }

  const left = 10000 - SOLD_DEMO - opened;
  const pct = ((SOLD_DEMO + opened) / 10000) * 100;

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
            <button className="btn btn-primary" onClick={openBox} disabled={phase === "rolling"}>
              {phase === "rolling" ? t("Открываем…") : `🎁 ${t("Открыть кейс")} · 0.02 ETH`}
            </button>
          </div>
          <div className="hint">{t("Демо-открытие: настоящие боксы включатся с деплоем. Рандом в контракте — commit-reveal: подкрутить результат не может ни игрок, ни валидатор.")}</div>
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
            <b style={{ color: RARITIES[result.tier].color }}>{t(RARITIES[result.tier].ru)} {t("кот")}!</b>
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

function MyCats({ t }) {
  const [claimed, setClaimed] = useState(false);
  const [toast, setToast] = useState("");
  const pending = useMemo(() => MY_DEMO.reduce((s, c) => s + c.divs, 0), []);
  const weight = useMemo(() => MY_DEMO.reduce((s, c) => s + RARITIES[c.tier].mult, 0), []);
  const monthly = Math.round(pending * 0.42 * 100) / 100;

  return (
    <>
      {toast && <div className="rev-toast">{toast}</div>}
      <div className="rev-stats" style={{ justifyContent: "flex-start", marginTop: 4 }}>
        <div><b>{MY_DEMO.length}</b><span>{t("котов в коллекции")}</span></div>
        <div><b>×{weight}</b><span>{t("суммарный вес выплат")}</span></div>
        <div><b className="rev-gold">${pending.toFixed(2)}</b><span>{t("к клейму сейчас")}</span></div>
        <div><b>${monthly}</b><span>{t("в среднем в месяц")}</span></div>
      </div>

      <div className="my-claim">
        <div>
          <b>{t("Доступно к выводу")}: <span className="rev-gold">${claimed ? "0.00" : pending.toFixed(2)}</span></b>
          <div className="hint" style={{ marginTop: 4 }}>{t("Дивиденды приходят в токенизированных акциях (SPY, NVDA и др.)")}</div>
        </div>
        <button className="btn btn-primary" disabled={claimed}
                onClick={() => { setClaimed(true); setToast(t("Клейм откроется с деплоем контрактов.")); setTimeout(() => setToast(""), 2600); }}>
          {t("Забрать всё")}
        </button>
      </div>

      <h2 className="rev-h2">{t("Мои коты")} <span className="rev-demo-tag">{t("демо")}</span></h2>
      <div className="cm-grid">
        {MY_DEMO.map((c) => {
          const r = RARITIES[c.tier];
          return (
            <div className="cm-card" key={c.id} style={{ borderColor: r.color + "55" }}>
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
                <span className="cm-seller">{t("в коллекции")} {c.since}</span>
                <button className="btn sm-btn"
                        onClick={() => { setToast(t("Продажа откроется с деплоем контрактов.")); setTimeout(() => setToast(""), 2600); }}>
                  {t("Продать")}
                </button>
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

function Holders({ t }) {
  const [sort, setSort] = useState("weight");
  const rows = useMemo(() => {
    const by = { weight: (a, b) => b.weight - a.weight, cats: (a, b) => b.cats - a.cats, earned: (a, b) => b.earned - a.earned }[sort];
    return [...HOLDERS].sort(by);
  }, [sort]);
  const totalCats = HOLDERS.reduce((s, h) => s + h.cats, 0);

  return (
    <>
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
          <div className={`hold-row ${i < 3 ? "top" : ""}`} key={h.addr}>
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

export default function Cats() {
  const { t } = useLang();
  const [tab, setTab] = useState("about"); // about | boxes | market | my | holders
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

      {tab === "boxes" && <Boxes t={t} />}
      {tab === "market" && <Market t={t} />}
      {tab === "my" && <MyCats t={t} />}
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
