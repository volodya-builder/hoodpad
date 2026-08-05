/** Кликер «Кот-брокер»: тапаешь легендарного кота — сыплются акции.
 *  Очки (тикеты) копятся, тратятся на улучшения и дают:
 *    • буст к дивидендам котов (игроки зарабатывают больше),
 *    • билеты в розыгрыш NFT-кота — каждые 30 минут разыгрывается один кот.
 *  Состояние в localStorage; при деплое переезжает в бэкенд/контракт,
 *  а очки раунда фиксируются он-чейн для честного розыгрыша. */

const KEY = "hood_clicker_v1";

export const ROUND_MIN = 30;                       // длительность раунда розыгрыша
export const ROUND_MS = ROUND_MIN * 60 * 1000;
export const CARDS_PER_ROUND = 1;                  // один NFT-кот за раунд
export const ROUNDS_PER_DAY = Math.round((24 * 60) / ROUND_MIN); // 48 котов в сутки
export const BOOST_PER_10K = 1;       // +1% к дивидендам за каждые 10k очков дня
export const BOOST_CAP = 25;          // максимум +25%

/** Раунды нарезаны по абсолютному времени — у всех игроков они совпадают. */
export function roundId(ts = Date.now()) { return Math.floor(ts / ROUND_MS); }
export function roundEndsAt(ts = Date.now()) { return (roundId(ts) + 1) * ROUND_MS; }
export function msLeft(ts = Date.now()) { return Math.max(0, roundEndsAt(ts) - ts); }

/** «12:34» — сколько осталось до конца раунда. */
export function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Доля прошедшего времени раунда, 0..100 (для полоски таймера). */
export function roundProgress(ts = Date.now()) {
  return Math.min(100, ((ROUND_MS - msLeft(ts)) / ROUND_MS) * 100);
}

/** Демо-кошелёк победителя (в песочнице других игроков нет). */
function demoWallet() {
  const hex = "0123456789abcdef";
  const r = (n) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join("");
  return `0x${r(4)}…${r(4)}`;
}

export const DEMO_PLAYERS = 11; // сколько «соперников» показываем в раунде

/** Соперники текущего раунда. Детерминированы по номеру раунда: весь раунд
 *  это одни и те же кошельки, а их очки плавно растут к концу раунда —
 *  как если бы они играли параллельно. После деплоя заменяется на реальный
 *  список из бэкенда/контракта. */
export function roundPlayers(round = roundId(), ts = Date.now()) {
  let x = ((round % 9973) * 7919 + 13) % 233280;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const hex = "0123456789abcdef";
  const w = (n) => Array.from({ length: n }, () => hex[Math.floor(rnd() * 16)]).join("");
  // насколько раунд прошёл: в начале у всех мало очков, к концу — максимум
  const prog = Math.min(1, Math.max(0, 1 - msLeft(ts) / ROUND_MS));
  return Array.from({ length: DEMO_PLAYERS }, () => {
    const addr = `0x${w(4)}…${w(4)}`;
    const peak = 3000 + Math.floor(rnd() * 27000);
    return { addr, points: Math.max(1, Math.round(peak * (0.12 + 0.88 * prog))) };
  });
}

/** Сумма очков соперников раунда. */
export function poolTotal(pool) {
  return pool.reduce((a, p) => a + p.points, 0);
}

// Улучшения: цена растёт на 55% за уровень
export const UPGRADES = [
  { id: "claw", ru: "Когти", en: "Claws", desc: "+1 к силе клика", base: 25, effect: 1, kind: "click", icon: "🐾" },
  { id: "suit", ru: "Костюм брокера", en: "Broker suit", desc: "+5 к силе клика", base: 400, effect: 5, kind: "click", icon: "🕴️" },
  { id: "insight", ru: "Чутьё рынка", en: "Market sense", desc: "+2% шанс крита (×10)", base: 900, effect: 2, kind: "crit", icon: "👁️" },
  { id: "terminal", ru: "Терминал", en: "Terminal", desc: "+2 акции/сек", base: 120, effect: 2, kind: "auto", icon: "🖥️" },
  { id: "algo", ru: "Алго-бот", en: "Algo bot", desc: "+15 акций/сек", base: 1800, effect: 15, kind: "auto", icon: "🤖" },
  { id: "hedge", ru: "Хедж-фонд", en: "Hedge fund", desc: "+90 акций/сек", base: 22000, effect: 90, kind: "auto", icon: "🏦" },
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
  earnedToday: 0,   // очки за сегодня — по ним считается буст к дивидендам
  roundPoints: 0,   // очки текущего 30-минутного раунда — билеты в розыгрыш
  round: roundId(), // номер раунда, за который уже начислены очки
  winners: [],      // последние победители: { round, ts, addr, points, chance, me }
  totalEarned: 0,   // за всё время — по нему уровень
  totalClicks: 0,
  levels: {},       // id улучшения => уровень
  day: today(),
  lastTick: Date.now(),
  wonCards: 0,      // выигранных карточек всего
  lastRaffle: null, // { round, won, chance }
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
    roundPoints: (s.roundPoints || 0) + gain,
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
    roundPoints: (s.roundPoints || 0) + jackpot,
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
    roundPoints: (s.roundPoints || 0) + gain,
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

/** Шанс выиграть кота в текущем раунде.
 *  Билеты пропорциональны очкам раунда, кот один: chance = мои очки / очки всех. */
export function raffleChance(s, totalPoints) {
  const mine = s.roundPoints || 0;
  if (mine <= 0 || totalPoints <= 0) return 0;
  return Math.min(99.9, Math.min(1, mine / totalPoints) * 100);
}

/** Итог одного раунда: тянем один билет из общей корзины.
 *  pool — соперники раунда, mine — мои очки за раунд. */
function drawOne(pool, mine, myAddr, round) {
  const entries = [...pool, { addr: myAddr || "you", points: Math.max(0, mine), me: true }];
  const total = entries.reduce((a, e) => a + e.points, 0);
  let r = Math.random() * total;
  let win = entries[0];
  for (const e of entries) { if ((r -= e.points) <= 0) { win = e; break; } }
  return {
    round,
    ts: Math.min((round + 1) * ROUND_MS, Date.now()),
    addr: win.me ? (myAddr || "you") : (win.addr || demoWallet()),
    points: Math.round(win.points),
    chance: total > 0 ? Math.round((mine / total) * 1000) / 10 : 0,
    me: !!win.me,
  };
}

/** Закрыть все раунды, которые прошли с прошлого визита.
 *  force=true — «разыграть сейчас» (кнопка теста), не дожидаясь таймера.
 *  Возвращает { state, drawn: [записи победителей] }. */
export function settle(s, pool, myAddr, force = false) {
  const cur = roundId();
  const last = s.round ?? cur;
  if (!force && cur === last) return { state: s, drawn: [] };

  const drawn = [];
  // мой раунд считается по накопленным очкам, пропущенные — без меня
  drawn.push(drawOne(pool, s.roundPoints || 0, myAddr, last));
  const skipped = Math.min(5, Math.max(0, cur - last - 1));
  for (let i = 1; i <= skipped; i++) drawn.push(drawOne(roundPlayers(last + i), 0, myAddr, last + i));

  const won = drawn.filter((d) => d.me).length;
  const mineDraw = drawn[0];
  const next = save({
    ...s,
    round: cur,
    roundPoints: 0,
    wonCards: (s.wonCards || 0) + won,
    lastRaffle: { round: mineDraw.round, won: mineDraw.me ? 1 : 0, chance: mineDraw.chance },
    winners: [...[...drawn].reverse(), ...(s.winners || [])].slice(0, 24),
  });
  return { state: next, drawn };
}
