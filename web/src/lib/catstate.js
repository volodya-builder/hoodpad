/** Песочница котов: полноценная симуляция игры в браузере (localStorage).
 *  Нужна, чтобы обкатать весь цикл — открыть бокс, получить кота, выставить
 *  на биржу, увидеть награды и рейтинг — ДО деплоя контрактов.
 *  Шансы и веса совпадают с контрактами BrokerCats/CatBox один в один.
 *  Когда контракты задеплоим, этот модуль заменяется чтением из сети. */

const KEY = "hood_cats_sandbox_v1";
export const BOX_TOTAL = 10_000;

export const RARITY = [
  { key: "Common", ru: "Обычный", chance: 60, mult: 1, color: "#8b93a7" },
  { key: "Rare", ru: "Редкий", chance: 24, mult: 2, color: "#4aa3e0" },
  { key: "Epic", ru: "Эпический", chance: 10, mult: 3, color: "#a06bff" },
  { key: "Mythic", ru: "Мифический", chance: 5, mult: 5, color: "#e0559a", img: "./cats/mythic.jpg" },
  { key: "Legendary", ru: "Легендарный", chance: 1, mult: 8, color: "#f5b544", img: "./cats/legendary.jpg" },
];

// как в контракте: 0..59 Common, 60..83 Rare, 84..93 Epic, 94..98 Mythic, 99 Legendary
export function rollRarity(roll = Math.floor(Math.random() * 100)) {
  if (roll < 60) return 0;
  if (roll < 84) return 1;
  if (roll < 94) return 2;
  if (roll < 99) return 3;
  return 4;
}

export const MARKET_FEE_BPS = 200; // 2% сделки уходит в казну — как в контракте

const EMPTY = {
  enabled: false,
  boxesLeft: BOX_TOTAL,   // непроданные боксы игры
  myBoxes: 0,             // боксы на руках у тестировщика
  nextId: 1,
  cats: [],               // { id, tier, sym, divs, mintedAt, listed, price }
  sold: [],               // проданные коты: можно выкупить обратно и проверить покупку
  trades: [],             // настоящие сделки песочницы: { ts, tier, price, side, id, sym }
  balance: 0,             // тестовый ETH-баланс от продаж
  fees: 0,                // сколько комиссии ушло «в казну»
  opened: 0,
  log: [],                // последние события
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch (e) {
    return { ...EMPTY };
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  return s;
}

/** Включить песочницу и выдать себе весь запас боксов. */
export function enableSandbox(tickers) {
  const s = { ...EMPTY, enabled: true, myBoxes: BOX_TOTAL, boxesLeft: BOX_TOTAL, tickers };
  s.log = [{ ts: Date.now(), text: `Выдано ${BOX_TOTAL} боксов` }];
  return save(s);
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return { ...EMPTY };
}

/** Открыть один бокс: тратит бокс, создаёт кота со случайной редкостью. */
export function openBox(s, tickers) {
  if (s.myBoxes <= 0) return { state: s, cat: null };
  const tier = rollRarity();
  const sym = tickers[Math.floor(Math.random() * tickers.length)];
  const cat = {
    id: s.nextId,
    tier,
    sym,
    divs: 0,
    mintedAt: Date.now(),
    listed: false,
    price: 0,
  };
  const next = {
    ...s,
    myBoxes: s.myBoxes - 1,
    boxesLeft: s.boxesLeft - 1,
    opened: s.opened + 1,
    nextId: s.nextId + 1,
    cats: [cat, ...s.cats],
    log: [{ ts: Date.now(), text: `Открыт бокс → ${RARITY[tier].ru} #${cat.id} (${sym})` }, ...s.log].slice(0, 50),
  };
  return { state: save(next), cat };
}

/** Выставить кота на биржу. */
export function listCat(s, id, price) {
  const cats = s.cats.map((c) => (c.id === id ? { ...c, listed: true, price } : c));
  const next = { ...s, cats, log: [{ ts: Date.now(), text: `Кот #${id} выставлен за ${price} ETH` }, ...s.log].slice(0, 50) };
  return save(next);
}

/** Снять кота с биржи. */
export function unlistCat(s, id) {
  const cats = s.cats.map((c) => (c.id === id ? { ...c, listed: false, price: 0 } : c));
  const next = { ...s, cats, log: [{ ts: Date.now(), text: `Кот #${id} снят с продажи` }, ...s.log].slice(0, 50) };
  return save(next);
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Сделка состоялась: покупатель забрал выставленного кота по цене лота.
 *  Кот уходит из коллекции, 98% цены — мне, 2% — в казну, сделка попадает
 *  в историю, из которой строится график и объём. */
export function sellNow(s, id) {
  const c = s.cats.find((x) => x.id === id);
  if (!c || !c.listed || !(c.price > 0)) return { state: s, trade: null };
  const fee = round6(c.price * MARKET_FEE_BPS / 10000);
  const net = round6(c.price - fee);
  const trade = { ts: Date.now(), tier: c.tier, price: c.price, side: "sell", id: c.id, sym: c.sym };
  const next = {
    ...s,
    cats: s.cats.filter((x) => x.id !== id),
    sold: [{ ...c, listed: false, soldAt: trade.ts, soldPrice: c.price }, ...(s.sold || [])].slice(0, 50),
    balance: round6((s.balance || 0) + net),
    fees: round6((s.fees || 0) + fee),
    trades: [...(s.trades || []), trade].slice(-300),
    log: [{ ts: trade.ts, text: `Продан кот #${id} за ${c.price} ETH (комиссия ${fee})` }, ...s.log].slice(0, 50),
  };
  return { state: save(next), trade };
}

/** Выкупить проданного кота обратно — тест покупки со стороны покупателя.
 *  Цена списывается с тестового баланса, сделка тоже идёт в историю. */
export function buyBack(s, id, price) {
  const c = (s.sold || []).find((x) => x.id === id);
  if (!c) return { state: s, trade: null, error: "not_found" };
  const p = price > 0 ? round6(price) : c.soldPrice;
  if ((s.balance || 0) < p) return { state: s, trade: null, error: "no_funds" };
  const trade = { ts: Date.now(), tier: c.tier, price: p, side: "buy", id: c.id, sym: c.sym };
  const next = {
    ...s,
    cats: [{ ...c, listed: false, price: 0 }, ...s.cats],
    sold: (s.sold || []).filter((x) => x.id !== id),
    balance: round6((s.balance || 0) - p),
    trades: [...(s.trades || []), trade].slice(-300),
    log: [{ ts: trade.ts, text: `Куплен кот #${id} за ${p} ETH` }, ...s.log].slice(0, 50),
  };
  return { state: save(next), trade };
}

/** История сделок по редкости, свёрнутая по 10-секундным корзинам: цена —
 *  последняя в корзине, объём — сколько сделок. Из этого строится живой
 *  график: каждая продажа и выкуп сразу добавляют точку. */
export const TRADE_BUCKET_MS = 10_000;

export function tradeSeries(s, tier) {
  const rows = (s.trades || []).filter((t) => t.tier === tier);
  const map = new Map();
  for (const t of rows) {
    const k = Math.floor(t.ts / TRADE_BUCKET_MS);
    const cur = map.get(k) || { k, ts: t.ts, price: t.price, n: 0 };
    cur.price = t.price; cur.ts = t.ts; cur.n += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.k - b.k);
}

/** Симуляция раздачи наград казной: делит сумму по весам редкости. */
export function distribute(s, usdTotal) {
  const totalWeight = s.cats.reduce((acc, c) => acc + RARITY[c.tier].mult, 0);
  if (totalWeight === 0) return s;
  const cats = s.cats.map((c) => ({
    ...c,
    divs: Math.round((c.divs + (usdTotal * RARITY[c.tier].mult) / totalWeight) * 100) / 100,
  }));
  const next = {
    ...s, cats,
    log: [{ ts: Date.now(), text: `Казна раздала $${usdTotal} на ${s.cats.length} котов` }, ...s.log].slice(0, 50),
  };
  return save(next);
}

/** Забрать награды со всех котов. */
export function claimAll(s) {
  const sum = s.cats.reduce((acc, c) => acc + c.divs, 0);
  const cats = s.cats.map((c) => ({ ...c, divs: 0 }));
  const next = {
    ...s, cats,
    log: [{ ts: Date.now(), text: `Клейм: получено $${sum.toFixed(2)} в акциях` }, ...s.log].slice(0, 50),
  };
  return { state: save(next), sum };
}

/** Сводка по коллекции. */
export function stats(s) {
  const byTier = [0, 0, 0, 0, 0];
  let weight = 0, divs = 0, listed = 0;
  for (const c of s.cats) {
    byTier[c.tier] += 1;
    weight += RARITY[c.tier].mult;
    divs += c.divs;
    if (c.listed) listed += 1;
  }
  return { count: s.cats.length, byTier, weight, divs: Math.round(divs * 100) / 100, listed };
}
