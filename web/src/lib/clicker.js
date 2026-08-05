/** Кликер «Кот-брокер»: тапаешь легендарного кота — сыплются акции.
 *  Очки (тикеты) копятся, тратятся на улучшения и дают:
 *    • буст к дивидендам котов (игроки зарабатывают больше),
 *    • шансы в ежедневном розыгрыше NFT-котов (50 карточек в день).
 *  Состояние в localStorage; при деплое переезжает в бэкенд/контракт,
 *  а очки за день фиксируются он-чейн для честного розыгрыша. */

const KEY = "hood_clicker_v1";

export const CARDS_PER_DAY = 50;      // NFT-котов разыгрывается ежедневно
export const BOOST_PER_10K = 1;       // +1% к дивидендам за каждые 10k очков дня
export const BOOST_CAP = 25;          // максимум +25%

// Улучшения: цена растёт на 55% за уровень
export const UPGRADES = [
  { id: "claw", ru: "Когти", en: "Claws", desc: "+1 к силе клика", base: 25, effect: 1, kind: "click" },
  { id: "suit", ru: "Костюм брокера", en: "Broker suit", desc: "+5 к силе клика", base: 400, effect: 5, kind: "click" },
  { id: "terminal", ru: "Терминал", en: "Terminal", desc: "+2 акции/сек", base: 120, effect: 2, kind: "auto" },
  { id: "algo", ru: "Алго-бот", en: "Algo bot", desc: "+15 акций/сек", base: 1800, effect: 15, kind: "auto" },
  { id: "hedge", ru: "Хедж-фонд", en: "Hedge fund", desc: "+90 акций/сек", base: 22000, effect: 90, kind: "auto" },
];

const EMPTY = {
  points: 0,        // текущий баланс очков (тратится на улучшения)
  earnedToday: 0,   // очки за сегодня — по ним считаются шансы и буст
  totalClicks: 0,
  levels: {},       // id улучшения => уровень
  day: today(),
  lastTick: Date.now(),
  wonCards: 0,      // выигранных карточек всего
  lastRaffle: null, // { day, won, chance }
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function upgradeCost(u, level) {
  return Math.round(u.base * Math.pow(1.55, level));
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
    // новый день — обнуляем дневной счётчик (шансы считаются за сутки)
    if (s.day !== today()) {
      s.day = today();
      s.earnedToday = 0;
      s.lastRaffle = null;
    }
    return s;
  } catch (e) {
    return { ...EMPTY };
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  return s;
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return { ...EMPTY };
}

/** Сила клика: база 1 + сумма эффектов click-улучшений. */
export function perClick(s) {
  return UPGRADES.filter((u) => u.kind === "click")
    .reduce((acc, u) => acc + (s.levels[u.id] || 0) * u.effect, 1);
}

/** Автодобыча в секунду. */
export function perSecond(s) {
  return UPGRADES.filter((u) => u.kind === "auto")
    .reduce((acc, u) => acc + (s.levels[u.id] || 0) * u.effect, 0);
}

/** Клик по коту. */
export function click(s) {
  const gain = perClick(s);
  return save({
    ...s,
    points: s.points + gain,
    earnedToday: s.earnedToday + gain,
    totalClicks: s.totalClicks + 1,
  });
}

/** Начисление автодобычи за прошедшее время (вызывается по таймеру). */
export function tick(s) {
  const now = Date.now();
  const dt = Math.min(60, (now - (s.lastTick || now)) / 1000); // не больше минуты за раз
  const gain = Math.floor(perSecond(s) * dt);
  if (gain <= 0) return { ...s, lastTick: now };
  return save({
    ...s,
    points: s.points + gain,
    earnedToday: s.earnedToday + gain,
    lastTick: now,
  });
}

/** Купить уровень улучшения. */
export function buy(s, id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return s;
  const level = s.levels[id] || 0;
  const cost = upgradeCost(u, level);
  if (s.points < cost) return s;
  return save({
    ...s,
    points: s.points - cost,
    levels: { ...s.levels, [id]: level + 1 },
  });
}

/** Буст к дивидендам котов за сегодняшнюю активность (в процентах). */
export function dividendBoost(s) {
  return Math.min(BOOST_CAP, Math.floor(s.earnedToday / 10000) * BOOST_PER_10K);
}

/** Шанс выиграть хотя бы одну карточку в дневном розыгрыше.
 *  Игроки тянут билеты пропорционально очкам за день; 50 карточек в день.
 *  chance ≈ 1 - (1 - p)^CARDS, где p = мои очки / очки всех. */
export function raffleChance(s, totalPoints) {
  const mine = s.earnedToday;
  if (mine <= 0 || totalPoints <= 0) return 0;
  const p = Math.min(1, mine / totalPoints);
  return Math.min(99.9, (1 - Math.pow(1 - p, CARDS_PER_DAY)) * 100);
}

/** Демо-розыгрыш (для песочницы): бросаем кубик по шансу. */
export function runRaffle(s, totalPoints) {
  const chance = raffleChance(s, totalPoints);
  const won = Math.random() * 100 < chance ? 1 : 0;
  const next = save({
    ...s,
    wonCards: s.wonCards + won,
    lastRaffle: { day: s.day, won, chance: Math.round(chance * 10) / 10 },
  });
  return { state: next, won, chance };
}
