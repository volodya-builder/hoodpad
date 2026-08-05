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
  { id: "insight", ru: "Чутьё рынка", en: "Market sense", desc: "+2% шанс крита (×10)", base: 900, effect: 2, kind: "crit" },
  { id: "terminal", ru: "Терминал", en: "Terminal", desc: "+2 акции/сек", base: 120, effect: 2, kind: "auto" },
  { id: "algo", ru: "Алго-бот", en: "Algo bot", desc: "+15 акций/сек", base: 1800, effect: 15, kind: "auto" },
  { id: "hedge", ru: "Хедж-фонд", en: "Hedge fund", desc: "+90 акций/сек", base: 22000, effect: 90, kind: "auto" },
];

// Комбо: за быстрые тапы множитель растёт до ×5
export const COMBO_WINDOW_MS = 900;   // пауза дольше — комбо сбрасывается
export const COMBO_STEP = 6;          // каждые N тапов подряд +1 к множителю
export const COMBO_MAX = 5;

// Золотой кот: редкое событие, тап по нему даёт джекпот
export const GOLDEN_CHANCE = 0.012;   // ~1.2% на тап
export const GOLDEN_REWARD_SEC = 45;  // джекпот = 45 сек автодобычи (мин. 250)

// Уровень игрока по суммарно заработанному
export function levelOf(totalEarned) {
  return Math.floor(Math.sqrt(Math.max(0, totalEarned) / 500)) + 1;
}
export function levelProgress(totalEarned) {
  const lvl = levelOf(totalEarned);
  const cur = Math.pow(lvl - 1, 2) * 500;
  const next = Math.pow(lvl, 2) * 500;
  return { lvl, cur, next, pct: Math.min(100, ((totalEarned - cur) / (next - cur)) * 100) };
}

const EMPTY = {
  points: 0,        // текущий баланс очков (тратится на улучшения)
  earnedToday: 0,   // очки за сегодня — по ним считаются шансы и буст
  totalEarned: 0,   // за всё время — по нему уровень
  totalClicks: 0,
  levels: {},       // id улучшения => уровень
  day: today(),
  lastTick: Date.now(),
  wonCards: 0,      // выигранных карточек всего
  lastRaffle: null, // { day, won, chance }
  combo: 0,         // тапов подряд
  lastClickAt: 0,
  goldenUntil: 0,   // до какого времени активен ×2 после золотого кота
  goldenCaught: 0,
  bestCombo: 0,
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

/** Шанс критического удара (×10) в процентах. */
export function critChance(s) {
  return Math.min(50, UPGRADES.filter((u) => u.kind === "crit")
    .reduce((acc, u) => acc + (s.levels[u.id] || 0) * u.effect, 1));
}

/** Множитель комбо по текущей серии тапов. */
export function comboMult(s) {
  return Math.min(COMBO_MAX, 1 + Math.floor(s.combo / COMBO_STEP));
}

/** Активен ли бонус ×2 после золотого кота. */
export function goldenActive(s) {
  return (s.goldenUntil || 0) > Date.now();
}

/** Клик по коту. Возвращает состояние и что произошло (крит/золотой). */
export function click(s) {
  const now = Date.now();
  const keepCombo = now - (s.lastClickAt || 0) < COMBO_WINDOW_MS;
  const combo = keepCombo ? s.combo + 1 : 1;
  const mult = Math.min(COMBO_MAX, 1 + Math.floor(combo / COMBO_STEP));
  const crit = Math.random() * 100 < critChance(s);
  const golden = goldenActive(s);

  let gain = perClick(s) * mult;
  if (crit) gain *= 10;
  if (golden) gain *= 2;
  gain = Math.round(gain);

  const next = save({
    ...s,
    points: s.points + gain,
    earnedToday: s.earnedToday + gain,
    totalEarned: (s.totalEarned || 0) + gain,
    totalClicks: s.totalClicks + 1,
    combo,
    bestCombo: Math.max(s.bestCombo || 0, combo),
    lastClickAt: now,
  });
  return { state: next, gain, crit, mult, golden };
}

/** Поймал золотого кота: джекпот + ×2 на 20 секунд. */
export function catchGolden(s) {
  const jackpot = Math.max(250, Math.round(perSecond(s) * GOLDEN_REWARD_SEC) + perClick(s) * 40);
  const next = save({
    ...s,
    points: s.points + jackpot,
    earnedToday: s.earnedToday + jackpot,
    totalEarned: (s.totalEarned || 0) + jackpot,
    goldenUntil: Date.now() + 20_000,
    goldenCaught: (s.goldenCaught || 0) + 1,
  });
  return { state: next, jackpot };
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
    totalEarned: (s.totalEarned || 0) + gain,
    lastTick: now,
    // комбо остывает, если давно не тапали
    combo: now - (s.lastClickAt || 0) > COMBO_WINDOW_MS ? 0 : s.combo,
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
