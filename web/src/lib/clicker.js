/** Кликер «Кот-брокер»: тапаешь легендарного кота — сыплются акции.
 *  Очки копятся, тратятся на улучшения и дают билеты в розыгрыш.
 *  Очки нужны ТОЛЬКО для розыгрыша NFT-котов: каждые 30 минут один кот
 *  уходит игроку. На награды котов игра не влияет никак — выплаты идут
 *  строго по редкости NFT, чтобы кликер не превращался в доходную бумагу.
 *  Состояние в localStorage; при деплое переезжает в бэкенд/контракт,
 *  а очки раунда фиксируются он-чейн для честного розыгрыша. */

const KEY = "hood_clicker_v1";

export const ROUND_MIN = 30;                       // длительность раунда розыгрыша
export const ROUND_MS = ROUND_MIN * 60 * 1000;
export const CARDS_PER_ROUND = 1;                  // один NFT-кот за раунд
export const ROUNDS_PER_DAY = Math.round((24 * 60) / ROUND_MIN); // 48 котов в сутки

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
export function roundPlayers(round = roundId(), ts = Date.now(), ref = 0) {
  let x = ((round % 9973) * 7919 + 13) % 233280;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const hex = "0123456789abcdef";
  const w = (n) => Array.from({ length: n }, () => hex[Math.floor(rnd() * 16)]).join("");
  // насколько раунд прошёл: в начале у всех мало очков, к концу — максимум
  const prog = Math.min(1, Math.max(0, 1 - msLeft(ts) / ROUND_MS));
  // соперники масштабируются от результата игрока: иначе у прокачанного
  // аккаунта таблица превращается в «я и одиннадцать нулей»
  const scale = Math.max(20000, ref || 0);
  return Array.from({ length: DEMO_PLAYERS }, () => {
    const addr = `0x${w(4)}…${w(4)}`;
    const peak = scale * (0.15 + rnd() * 1.25);
    return { addr, points: Math.max(1, Math.round(peak * (0.12 + 0.88 * prog))) };
  });
}

/** Сумма очков соперников раунда. */
export function poolTotal(pool) {
  return pool.reduce((a, p) => a + p.points, 0);
}

// Улучшения: четыре ветки, цена растёт за уровень, часть открывается по
// уровню игрока — чтобы прокачка ощущалась как путь, а не как один список.
//   cat  — ветка магазина: click | income | luck | rhythm
//   kind — какая механика усиливается
//   req  — с какого уровня доступно, max — потолок уровней (если есть)
//   grow — множитель цены за уровень
export const UPGRADE_CATS = [
  { id: "click", ru: "Клик", en: "Click", icon: "🖐" },
  { id: "income", ru: "Доход", en: "Income", icon: "⚙️" },
  { id: "luck", ru: "Удача", en: "Luck", icon: "🍀" },
  { id: "rhythm", ru: "Ритм", en: "Rhythm", icon: "🎵" },
];

export const UPGRADES = [
  // — сила клика
  { id: "claw", cat: "click", kind: "click", ru: "Когти", desc: "+1 к силе клика", base: 25, effect: 1, grow: 1.5, icon: "🐾", req: 1 },
  { id: "suit", cat: "click", kind: "click", ru: "Костюм брокера", desc: "+5 к силе клика", base: 400, effect: 5, grow: 1.52, icon: "🕴️", req: 3 },
  { id: "insider", cat: "click", kind: "click", ru: "Инсайд", desc: "+30 к силе клика", base: 7000, effect: 30, grow: 1.55, icon: "🤫", req: 9 },
  { id: "maker", cat: "click", kind: "click", ru: "Маркет-мейкер", desc: "+150 к силе клика", base: 65000, effect: 150, grow: 1.58, icon: "🏛️", req: 20 },
  // — пассивный доход
  { id: "terminal", cat: "income", kind: "auto", ru: "Терминал", desc: "+2 акции/сек", base: 120, effect: 2, grow: 1.5, icon: "🖥️", req: 1 },
  { id: "algo", cat: "income", kind: "auto", ru: "Алго-бот", desc: "+15 акций/сек", base: 1800, effect: 15, grow: 1.53, icon: "🤖", req: 5 },
  { id: "hedge", cat: "income", kind: "auto", ru: "Хедж-фонд", desc: "+90 акций/сек", base: 22000, effect: 90, grow: 1.55, icon: "🏦", req: 12 },
  { id: "darkpool", cat: "income", kind: "auto", ru: "Тёмный пул", desc: "+600 акций/сек", base: 280000, effect: 600, grow: 1.6, icon: "🌑", req: 28 },
  { id: "night", cat: "income", kind: "offline", ru: "Ночная смена", desc: "+10% автодобычи офлайн", base: 9000, effect: 10, grow: 1.9, icon: "🌙", req: 7, max: 5 },
  // — удача
  { id: "insight", cat: "luck", kind: "crit", ru: "Чутьё рынка", desc: "+2% шанс крита", base: 900, effect: 2, grow: 1.6, icon: "👁️", req: 2, max: 20 },
  { id: "leverage", cat: "luck", kind: "critmult", ru: "Плечо", desc: "+2 к множителю крита", base: 6000, effect: 2, grow: 1.85, icon: "⚡", req: 10, max: 10 },
  { id: "luckycat", cat: "luck", kind: "golden", ru: "Кошачья удача", desc: "+0.3% шанс золотого кота", base: 4000, effect: 0.3, grow: 1.75, icon: "🍀", req: 6, max: 12 },
  { id: "valerian", cat: "luck", kind: "goldendur", ru: "Валерьянка", desc: "+8 сек буста ×2", base: 11000, effect: 8, grow: 1.8, icon: "🌿", req: 11, max: 8 },
  // — ритм и комбо
  { id: "tempo", cat: "rhythm", kind: "combowin", ru: "Чувство ритма", desc: "+0.15 сек на комбо", base: 1600, effect: 0.15, grow: 1.7, icon: "🎵", req: 4, max: 6 },
  { id: "streak", cat: "rhythm", kind: "combostep", ru: "Серия", desc: "−1 тап на ступень комбо", base: 14000, effect: 1, grow: 2.1, icon: "📈", req: 13, max: 3 },
  { id: "frenzy", cat: "rhythm", kind: "combomax", ru: "Кошачий раж", desc: "+1 к пределу комбо", base: 26000, effect: 1, grow: 2.2, icon: "🔥", req: 22, max: 5 },
];

// Комбо: за быстрые тапы множитель растёт (пределы двигаются улучшениями)
export const COMBO_WINDOW_MS = 900;   // пауза дольше — комбо сбрасывается
export const COMBO_STEP = 6;          // каждые N тапов подряд +1 к множителю
export const COMBO_MAX = 5;

// Золотой кот: редкое событие, тап по нему даёт джекпот
export const GOLDEN_CHANCE = 0.012;   // ~1.2% на тап (базовый)
export const GOLDEN_REWARD_SEC = 45;  // джекпот = 45 сек автодобычи (мин. 250)
export const GOLDEN_BASE_MS = 20_000; // базовая длительность буста ×2
export const OFFLINE_CAP_H = 4;       // офлайн-доход считается максимум за 4 часа

// Уровень игрока по суммарно заработанному.
// Доход в кликере растёт экспоненциально, поэтому и шкала уровней
// логарифмическая — иначе за полчаса набегала бы тысяча уровней и
// разблокировка улучшений по уровню теряла бы смысл.
// Ориентиры: ур.7 — минута игры, 15 — пять минут, 19 — полчаса,
// 24 — восемь часов, ~30 — неделя.
const LVL_BASE = 200, LVL_GROW = 1.9;
const lvlNeed = (l) => (Math.pow(LVL_GROW, l) - 1) * LVL_BASE;

export function levelOf(totalEarned) {
  return Math.max(1, Math.floor(Math.log(1 + Math.max(0, totalEarned) / LVL_BASE) / Math.log(LVL_GROW)));
}
export function levelProgress(totalEarned) {
  const lvl = levelOf(totalEarned);
  const cur = lvlNeed(lvl), next = lvlNeed(lvl + 1);
  return { lvl, cur, next, pct: Math.min(100, Math.max(0, ((totalEarned - cur) / (next - cur)) * 100)) };
}

// ——— билеты розыгрыша ———
// Билеты считаются НЕ линейно от очков, а по корню: игрок, который качается
// вторую неделю, зарабатывает в сто раз больше новичка, но билетов у него
// будет только в десять раз больше. Плюс кэп: в одни руки не больше четверти
// корзины — тот же принцип честного объёма, что и на арене токенов.
export const TICKET_CAP_PCT = 25;

export function ticketsOf(points) {
  return Math.floor(Math.sqrt(Math.max(0, points)));
}

/** Корзина билетов раунда: соперники + я, с применённым кэпом. */
export function ticketTable(pool, minePoints, myLabel = "you") {
  const rows = [
    ...(pool || []).map((p) => ({ addr: p.addr, points: p.points, me: false })),
    { addr: myLabel, points: Math.max(0, minePoints || 0), me: true },
  ].map((r) => ({ ...r, tickets: ticketsOf(r.points) }));

  let total = rows.reduce((a, r) => a + r.tickets, 0);
  for (let pass = 0; pass < 4 && total > 0; pass++) {
    const cap = (total * TICKET_CAP_PCT) / 100;
    let changed = false;
    for (const r of rows) {
      if (r.tickets > cap) { total -= r.tickets - cap; r.tickets = cap; changed = true; }
    }
    if (!changed) break;
  }
  const sum = rows.reduce((a, r) => a + r.tickets, 0);
  return rows
    .map((r) => ({ ...r, pct: sum > 0 ? (r.tickets / sum) * 100 : 0 }))
    .sort((a, b) => b.tickets - a.tickets);
}

const EMPTY = {
  points: 0,        // текущий баланс очков (тратится на улучшения)
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
  return Math.round(u.base * Math.pow(u.grow || 1.55, level));
}

/** Цена за n уровней подряд. */
export function bulkCost(u, level, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += upgradeCost(u, level + i);
  return sum;
}

/** Сколько уровней можно купить на текущий баланс (с учётом потолка). */
export function affordable(s, u, cap = 100) {
  const level = s.levels[u.id] || 0;
  let n = 0, sum = 0;
  const room = u.max ? u.max - level : Infinity;
  while (n < cap && n < room) {
    const next = sum + upgradeCost(u, level + n);
    if (next > s.points) break;
    sum = next; n += 1;
  }
  return { n, sum };
}

/** Открыто ли улучшение (по уровню игрока) и не упёрлось ли в потолок. */
export function unlocked(s, u) {
  return levelOf(s.totalEarned || 0) >= (u.req || 1);
}
export function maxed(s, u) {
  return !!u.max && (s.levels[u.id] || 0) >= u.max;
}

/** Сумма эффектов улучшения данного типа. */
function sumKind(s, kind) {
  return UPGRADES.filter((u) => u.kind === kind)
    .reduce((acc, u) => acc + (s.levels[u.id] || 0) * u.effect, 0);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
    // смена суток: сбрасываем только пометку о последнем розыгрыше
    if (s.day !== today()) {
      s.day = today();
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
  return 1 + sumKind(s, "click");
}

/** Автодобыча в секунду. */
export function perSecond(s) {
  return sumKind(s, "auto");
}

/** Шанс критического удара в процентах. */
export function critChance(s) {
  return Math.min(50, 1 + sumKind(s, "crit"));
}

/** Множитель критического удара (базовый ×10, «Плечо» добавляет). */
export function critMult(s) {
  return 10 + sumKind(s, "critmult");
}

/** Шанс появления золотого кота на тап (доля, не проценты). */
export function goldenChance(s) {
  return Math.min(0.09, GOLDEN_CHANCE + sumKind(s, "golden") / 100);
}

/** Сколько держится буст ×2 после золотого кота, мс. */
export function goldenDurMs(s) {
  return GOLDEN_BASE_MS + sumKind(s, "goldendur") * 1000;
}

/** Окно комбо: сколько можно медлить между тапами, мс. */
export function comboWindow(s) {
  return COMBO_WINDOW_MS + Math.round(sumKind(s, "combowin") * 1000);
}

/** Сколько тапов нужно на следующую ступень комбо. */
export function comboStep(s) {
  return Math.max(2, COMBO_STEP - sumKind(s, "combostep"));
}

/** Потолок множителя комбо. */
export function comboCap(s) {
  return COMBO_MAX + sumKind(s, "combomax");
}

/** Доля автодобычи, которая капает офлайн (в процентах). */
export function offlinePct(s) {
  return Math.min(50, sumKind(s, "offline"));
}

/** Множитель комбо по текущей серии тапов. */
export function comboMult(s) {
  return Math.min(comboCap(s), 1 + Math.floor(s.combo / comboStep(s)));
}

/** Активен ли бонус ×2 после золотого кота. */
export function goldenActive(s) {
  return (s.goldenUntil || 0) > Date.now();
}

/** Клик по коту. Возвращает состояние и что произошло (крит/золотой). */
export function click(s) {
  const now = Date.now();
  const keepCombo = now - (s.lastClickAt || 0) < comboWindow(s);
  const combo = keepCombo ? s.combo + 1 : 1;
  const mult = Math.min(comboCap(s), 1 + Math.floor(combo / comboStep(s)));
  const crit = Math.random() * 100 < critChance(s);
  const golden = goldenActive(s);

  let gain = perClick(s) * mult;
  if (crit) gain *= critMult(s);
  if (golden) gain *= 2;
  gain = Math.round(gain);

  const next = save({
    ...s,
    points: s.points + gain,
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
    roundPoints: (s.roundPoints || 0) + jackpot,
    totalEarned: (s.totalEarned || 0) + jackpot,
    goldenUntil: Date.now() + goldenDurMs(s),
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
    roundPoints: (s.roundPoints || 0) + gain,
    totalEarned: (s.totalEarned || 0) + gain,
    lastTick: now,
    // комбо остывает, если давно не тапали
    combo: now - (s.lastClickAt || 0) > comboWindow(s) ? 0 : s.combo,
  });
}

/** Доход, накопившийся пока страница была закрыта.
 *  Работает только с «Ночной сменой»: без неё офлайн ничего не даёт.
 *  ВАЖНО: офлайн-очки идут на прокачку, но НЕ дают билетов в розыгрыш —
 *  иначе выгоднее было бы не играть, а держать вкладку закрытой. */
export function collectOffline(s) {
  const pct = offlinePct(s);
  const away = (Date.now() - (s.lastTick || Date.now())) / 1000;
  if (pct <= 0 || away < 120) return { state: { ...s, lastTick: Date.now() }, gain: 0, away: 0 };
  const capped = Math.min(away, OFFLINE_CAP_H * 3600);
  const gain = Math.floor(perSecond(s) * capped * (pct / 100));
  if (gain <= 0) return { state: { ...s, lastTick: Date.now() }, gain: 0, away: 0 };
  return {
    state: save({
      ...s,
      points: s.points + gain,
      totalEarned: (s.totalEarned || 0) + gain,
      lastTick: Date.now(),
    }),
    gain,
    away: Math.round(capped),
  };
}

/** Купить n уровней улучшения (по умолчанию один). */
export function buy(s, id, n = 1) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || !unlocked(s, u)) return s;
  const level = s.levels[id] || 0;
  const room = u.max ? u.max - level : Infinity;
  const count = Math.min(n, room);
  if (count <= 0) return s;
  const cost = bulkCost(u, level, count);
  if (s.points < cost) return s;
  return save({
    ...s,
    points: s.points - cost,
    levels: { ...s.levels, [id]: level + count },
  });
}

/** Шанс выиграть кота в текущем раунде — доля моих билетов в корзине. */
export function raffleChance(s, pool) {
  const table = ticketTable(pool, s.roundPoints || 0);
  const me = table.find((r) => r.me);
  return me ? Math.min(99.9, me.pct) : 0;
}

/** Итог одного раунда: тянем один билет из общей корзины.
 *  pool — соперники раунда, mine — мои очки за раунд. */
function drawOne(pool, mine, myAddr, round) {
  const table = ticketTable(pool, mine, myAddr || "you");
  const total = table.reduce((a, e) => a + e.tickets, 0);
  let r = Math.random() * total;
  let win = table[0];
  for (const e of table) { if ((r -= e.tickets) <= 0) { win = e; break; } }
  const mineRow = table.find((e) => e.me);
  return {
    round,
    ts: Math.min((round + 1) * ROUND_MS, Date.now()),
    addr: win.me ? (myAddr || "you") : (win.addr || demoWallet()),
    points: Math.round(win.points),
    chance: mineRow ? Math.round(mineRow.pct * 10) / 10 : 0,
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
