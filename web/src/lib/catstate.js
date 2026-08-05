/** Песочница котов: полноценная симуляция игры в браузере (localStorage).
 *  Нужна, чтобы обкатать весь цикл — открыть бокс, получить кота, выставить
 *  на биржу, увидеть дивиденды и рейтинг — ДО деплоя контрактов.
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

const EMPTY = {
  enabled: false,
  boxesLeft: BOX_TOTAL,   // непроданные боксы игры
  myBoxes: 0,             // боксы на руках у тестировщика
  nextId: 1,
  cats: [],               // { id, tier, sym, divs, mintedAt, listed, price }
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

/** Симуляция раздачи дивидендов казной: делит сумму по весам редкости. */
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

/** Забрать дивиденды со всех котов. */
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
