// Арена hood: суточный турнир токенов без контрактов.
// Выбывание считается ДЕТЕРМИНИРОВАННО из он-чейн сделок (Goldsky):
// одинаковые данные -> одинаковый результат у всех посетителей.
//
// Правила:
//   • день UTC = один бой; участвуют все неградуировавшие токены,
//     существовавшие на начало дня (создание в течение дня — участник со входа);
//   • день делится на N равных интервалов (N = число участников);
//   • на чекпоинте i выбывает живой токен с наименьшим объёмом (ETH)
//     с начала дня; ничья — раньше созданный выживает, дальше по адресу;
//   • последний живой в 24:00 — Чемпион дня (Зал славы).
import { useEffect, useState } from "react";
import { allTrades, loadTokens } from "./data.js";

const DAY = 86_400_000;

export function dayStart(ts = Date.now()) {
  return Math.floor(ts / DAY) * DAY;
}

/** Состояние арены для дня, начинающегося в d0 (мс UTC).
 *  excluded — адрес вчерашнего чемпиона: «защита трона» — сражается вне
 *  конкурса, корона уходит лучшему из остальных (нет вечных королей).
 *  Возвращает { participants, alive, eliminated, checkpoints,
 *               nextCheckpoint, champion, excluded } */
export function arenaState(tokens, trades, d0, now = Date.now(), excluded = null) {
  const end = d0 + DAY;
  const isToday = now < end;
  const cutoff = Math.min(now, end);

  // участники: неградуировавшие на данный момент + созданные до конца дня
  const parts = tokens.filter((t) => !t.graduated && (t.createdAt || 0) < end);
  if (parts.length === 0) {
    return { participants: [], alive: [], eliminated: [], checkpoints: [], nextCheckpoint: null, champion: null };
  }

  const N = parts.length;
  const step = DAY / N; // N-1 чекпоинтов внутри дня, финал в конце
  const checkpoints = Array.from({ length: Math.max(0, N - 1) }, (_, i) => d0 + step * (i + 1));

  // ---- «очки боя» = объём × (1 + прирост капитализации за день) ----
  // Объём поощряет активность, прирост капы — реальный спрос: дамп режет
  // очки, а пустая прокрутка объёма не даёт множителя.
  const VIRT = 1.625, TOTAL = 1e9;
  const dayTrades = trades.filter((tr) => tr.ts >= d0 && tr.ts < end);
  const byPool = {};
  for (const tr of dayTrades) (byPool[tr.pool] ??= []).push(tr);
  for (const k in byPool) byPool[k].sort((a, b) => b.ts - a.ts); // новые первыми

  const volUntil = (poolLower, t) =>
    (byPool[poolLower] || []).reduce((s, tr) => (tr.ts <= t ? s + tr.eth + tr.fee : s), 0);

  // состояние кривой пула в момент t: откатываем сделки новее t от текущего
  const stateAt = (p, t) => {
    let res = Number(p.reserve) / 1e18;
    let sold = Number(p.sold) / 1e18;
    for (const tr of byPool[(p.pool || "").toLowerCase()] || []) {
      if (tr.ts <= t) break;
      if (tr.side === "buy") { res -= tr.eth; sold -= tr.tokens; }
      else { res += tr.eth + tr.fee; sold += tr.tokens; }
    }
    return (VIRT + Math.max(res, 0)) / Math.max(TOTAL - sold, 1); // цена
  };
  const growthUntil = (p, t) => {
    const p0 = stateAt(p, d0);
    const pt = stateAt(p, t);
    return p0 > 0 ? Math.max(-0.6, Math.min(1.5, pt / p0 - 1)) : 0;
  };
  const scoreUntil = (p, t) =>
    volUntil((p.pool || "").toLowerCase(), t) * (1 + growthUntil(p, t));

  const alive = new Map(parts.map((p) => [p.token.toLowerCase(), p]));
  const eliminated = [];
  for (const cp of checkpoints) {
    if (cp > cutoff) break;
    if (alive.size <= 1) break;
    let worst = null, worstScore = Infinity;
    for (const [addr, p] of alive) {
      const v = scoreUntil(p, cp);
      const older = worst && ((p.createdAt || 0) < (worst.createdAt || 0)
        || ((p.createdAt || 0) === (worst.createdAt || 0) && addr > worst.token.toLowerCase()));
      if (v < worstScore || (v === worstScore && !older)) { worst = p; worstScore = v; }
    }
    alive.delete(worst.token.toLowerCase());
    eliminated.push({ token: worst, at: cp, vol: worstScore });
  }

  const aliveArr = [...alive.values()]
    .map((p) => ({
      ...p,
      dayVol: volUntil((p.pool || "").toLowerCase(), cutoff),
      dayGrowth: growthUntil(p, cutoff),
      score: scoreUntil(p, cutoff),
      defending: excluded != null && p.token.toLowerCase() === excluded, // вне конкурса
    }))
    .sort((a, b) => b.score - a.score);

  const nextCheckpoint = isToday ? checkpoints.find((cp) => cp > now) ?? end : null;
  const dayDecided = !isToday || aliveArr.length === 1;
  // корона — лучшему, кто не защищает трон; если других нет — трон вакантен не бывает
  const eligible = aliveArr.filter((p) => !p.defending);
  const champion = dayDecided && aliveArr.length >= 1 ? (eligible[0] ?? aliveArr[0]) : null;

  return { participants: parts, alive: aliveArr, eliminated, checkpoints, nextCheckpoint, champion, excluded };
}

/** Цепочка дней с «защитой трона»: чемпион дня N автоматически
 *  вне конкурса в день N+1. Считается вперёд от прошлого к сегодня —
 *  результат детерминирован для всех. */
export function buildChain(tokens, trades, daysBack = 62, now = Date.now()) {
  const today = dayStart(now);
  const chain = new Map(); // d0 -> state
  let excluded = null;
  for (let d0 = today - daysBack * DAY; d0 <= today; d0 += DAY) {
    const then = tokens.filter((t) => (t.createdAt || 0) < d0 + DAY);
    if (then.length === 0) { excluded = null; continue; }
    const st = arenaState(then, trades, d0, d0 === today ? now : d0 + DAY, excluded);
    chain.set(d0, st);
    // защита трона на следующий день; день без чемпиона сбрасывает её
    excluded = st.champion ? st.champion.token.toLowerCase() : null;
  }
  return { chain, today };
}

/** Гранд-Арена: месячная лига чемпионов дня.
 *  Каждый выигранный день даёт звезду и очки лиги (= очки боя за тот день).
 *  В конце месяца лидер по очкам — Гранд-чемпион, казна исполняет Гранд-выкуп. */
export function grandArena(tokens, trades, now = Date.now()) {
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const prevMonthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  const today = dayStart(now);
  const { chain } = buildChain(tokens, trades, 62, now);

  const collect = (from, to) => {
    const league = {};
    for (let d0 = from; d0 < Math.min(now, to); d0 += DAY) {
      const st = chain.get(d0);
      if (!st) continue;
      const ch = st.champion || (d0 === today ? st.alive.find((p) => !p.defending) : null);
      if (!ch) continue;
      const key = ch.token.toLowerCase();
      const row = league[key] ?? { token: ch, wins: 0, points: 0, days: [], leadingToday: false };
      if (d0 === today && st.alive.length > 1) {
        row.leadingToday = true;
        row.pendingPoints = ch.score ?? ch.dayVol ?? 0;
      } else {
        row.wins += 1;
        row.points += ch.score ?? ch.dayVol ?? 0;
        row.days.push(d0);
      }
      league[key] = row;
    }
    return Object.values(league).sort((a, b) =>
      (b.points + (b.pendingPoints || 0)) - (a.points + (a.pendingPoints || 0)));
  };

  // «Легенда»: гранд-чемпион прошлого месяца — вне конкурса в этом
  const prevTable = collect(prevMonthStart, monthStart);
  const legend = prevTable.length ? prevTable[0].token.token.toLowerCase() : null;

  let table = collect(monthStart, monthEnd);
  let legendRow = null;
  if (legend) {
    legendRow = table.find((r) => r.token.token.toLowerCase() === legend) || null;
    table = table.filter((r) => r.token.token.toLowerCase() !== legend);
  }
  return { table, legendRow, monthStart, monthEnd, endsIn: monthEnd - now };
}

/** Зал славы: чемпионы прошлых дней (насколько хватает истории сделок). */
export function hallOfFame(tokens, trades, days = 14) {
  const out = [];
  const { chain, today } = buildChain(tokens, trades, days, Date.now());
  for (let i = 1; i <= days; i++) {
    const d0 = today - i * DAY;
    const st = chain.get(d0);
    if (st?.champion) out.push({ day: d0, champion: st.champion });
  }
  return out;
}

/** Реактивный хук: текущая арена (с защитой трона), тикает каждые 30с. */
export function useArena() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [tokens, trades] = await Promise.all([loadTokens(), allTrades()]);
        if (!alive) return;
        const { chain, today } = buildChain(tokens, trades, 31);
        const todaySt = chain.get(today) ?? arenaState(tokens, trades, today);
        setSt({ ...todaySt, tokens, trades });
      } catch (e) { /* ignore */ }
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return st;
}
