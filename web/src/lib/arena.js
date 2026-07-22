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
 *  Возвращает { participants, alive, eliminated:[{token,at,vol}], checkpoints,
 *               nextCheckpoint, champion } */
export function arenaState(tokens, trades, d0, now = Date.now()) {
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

  // объём каждого токена с начала дня до момента t
  const dayTrades = trades.filter((tr) => tr.ts >= d0 && tr.ts < end);
  const volUntil = (poolLower, t) =>
    dayTrades.reduce((s, tr) => (tr.pool === poolLower && tr.ts <= t ? s + tr.eth + tr.fee : s), 0);

  const alive = new Map(parts.map((p) => [p.token.toLowerCase(), p]));
  const eliminated = [];
  for (const cp of checkpoints) {
    if (cp > cutoff) break;
    if (alive.size <= 1) break;
    let worst = null, worstVol = Infinity;
    for (const [addr, p] of alive) {
      const v = volUntil((p.pool || "").toLowerCase(), cp);
      const older = worst && ((p.createdAt || 0) < (worst.createdAt || 0)
        || ((p.createdAt || 0) === (worst.createdAt || 0) && addr > worst.token.toLowerCase()));
      if (v < worstVol || (v === worstVol && !older)) { worst = p; worstVol = v; }
    }
    alive.delete(worst.token.toLowerCase());
    eliminated.push({ token: worst, at: cp, vol: worstVol });
  }

  const aliveArr = [...alive.values()]
    .map((p) => ({ ...p, dayVol: volUntil((p.pool || "").toLowerCase(), cutoff) }))
    .sort((a, b) => b.dayVol - a.dayVol);

  const nextCheckpoint = isToday ? checkpoints.find((cp) => cp > now) ?? end : null;
  const champion = (!isToday || aliveArr.length === 1) && aliveArr.length >= 1 ? aliveArr[0] : null;

  return { participants: parts, alive: aliveArr, eliminated, checkpoints, nextCheckpoint, champion };
}

/** Зал славы: чемпионы прошлых дней (насколько хватает истории сделок). */
export function hallOfFame(tokens, trades, days = 14) {
  const out = [];
  const today = dayStart();
  for (let i = 1; i <= days; i++) {
    const d0 = today - i * DAY;
    // токены, существовавшие в тот день
    const then = tokens.filter((t) => (t.createdAt || 0) < d0 + DAY);
    if (then.length === 0) continue;
    const st = arenaState(then, trades, d0, d0 + DAY);
    if (st.champion) out.push({ day: d0, champion: st.champion });
  }
  return out;
}

/** Реактивный хук: текущая арена, тикает каждые 30с. */
export function useArena() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [tokens, trades] = await Promise.all([loadTokens(), allTrades()]);
        if (alive) setSt({ ...arenaState(tokens, trades, dayStart()), tokens, trades });
      } catch (e) { /* ignore */ }
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return st;
}
