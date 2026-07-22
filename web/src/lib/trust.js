// hood AI — «судья платформы»: Trust Score 0-100 по он-чейн данным.
// Детерминированный скоринг: одинаковые данные -> одинаковая оценка у всех.
// Компоненты: распределение держателей, качество торговли, репутация
// создателя, выживаемость. Каждый пункт объясняется человеческим языком.

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/** balances по сделкам пула (без кривой) */
function holdersFromTrades(trades) {
  const bal = {};
  for (const tr of trades) {
    const k = tr.addr.toLowerCase();
    bal[k] = (bal[k] || 0) + (tr.side === "buy" ? tr.tokens : -tr.tokens);
  }
  return Object.entries(bal).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]);
}

/**
 * @param tokenAddr адрес токена
 * @param trades    сделки пула (poolTrades().trades)
 * @param creator   адрес создателя
 * @param allTokens список токенов платформы (loadTokens())
 * @param createdAt мс
 */
export function computeTrust({ tokenAddr, trades, creator, allTokens, createdAt }) {
  const parts = [];
  const soldOnCurve = trades.reduce((s, tr) => s + (tr.side === "buy" ? tr.tokens : -tr.tokens), 0);

  // -------- 1. Распределение держателей (вес 35)
  const holders = holdersFromTrades(trades);
  const totalHeld = holders.reduce((s, [, v]) => s + v, 0) || 1;
  const top1 = holders.length ? holders[0][1] / totalHeld : 1;
  const top10 = holders.slice(0, 10).reduce((s, [, v]) => s + v, 0) / totalHeld;
  const supplyPct = soldOnCurve / 1e9; // сколько сапплая вообще на руках
  let dScore = clamp(100 - (top1 * 100 - 10) * 2.2 - (top10 * 100 - 40) * 0.6);
  if (holders.length < 3) dScore = Math.min(dScore, 35);
  parts.push({
    k: "dist", label: "Распределение", score: Math.round(dScore), weight: 35,
    note: holders.length < 3
      ? `держателей всего ${holders.length} — концентрация максимальна`
      : `топ-1 держит ${(top1 * 100).toFixed(0)}% купленного, топ-10 — ${(top10 * 100).toFixed(0)}%`,
  });

  // -------- 2. Качество торговли (вес 25)
  const uniq = new Set(trades.map((tr) => tr.addr.toLowerCase())).size;
  const vol = trades.reduce((s, tr) => s + tr.eth + tr.fee, 0);
  const volByTrader = {};
  for (const tr of trades) {
    const k = tr.addr.toLowerCase();
    volByTrader[k] = (volByTrader[k] || 0) + tr.eth + tr.fee;
  }
  const topTraderShare = vol > 0 ? Math.max(...Object.values(volByTrader)) / vol : 1;
  let tScore = clamp(Math.log2(uniq + 1) * 18 - (topTraderShare * 100 - 25) * 0.8);
  parts.push({
    k: "trade", label: "Торговля", score: Math.round(tScore), weight: 25,
    note: `${uniq} ${uniq === 1 ? "трейдер" : "трейдеров"}, крупнейший делает ${(topTraderShare * 100).toFixed(0)}% объёма`,
  });

  // -------- 3. Создатель (вес 25)
  const mine = (allTokens || []).filter((x) => (x.creator || "").toLowerCase() === (creator || "").toLowerCase());
  const grads = mine.filter((x) => x.graduated).length;
  const creatorSells = trades.filter((tr) => tr.side === "sell" && tr.addr.toLowerCase() === (creator || "").toLowerCase());
  const creatorBuys = trades.filter((tr) => tr.side === "buy" && tr.addr.toLowerCase() === (creator || "").toLowerCase());
  const cBought = creatorBuys.reduce((s, x) => s + x.tokens, 0);
  const cSold = creatorSells.reduce((s, x) => s + x.tokens, 0);
  const dumped = cBought > 0 ? cSold / cBought : 0;
  let cScore = 55 + Math.min(mine.length - 1, 5) * 4 + grads * 10 - dumped * 45;
  cScore = clamp(cScore);
  parts.push({
    k: "creator", label: "Создатель", score: Math.round(cScore), weight: 25,
    note: `${mine.length} ${mine.length === 1 ? "запуск" : "запусков"}${grads ? `, ${grads} градуировало` : ""}${dumped > 0.5 ? `, продал ${(dumped * 100).toFixed(0)}% своей позиции` : dumped > 0 ? `, продал ${(dumped * 100).toFixed(0)}%` : ", позицию держит"}`,
  });

  // -------- 4. Выживаемость (вес 15)
  const ageDays = createdAt ? (Date.now() - createdAt) / 86_400_000 : 0;
  const lastTradeMs = trades.length ? Math.max(...trades.map((tr) => tr.ts || 0)) : 0;
  const silentDays = lastTradeMs ? (Date.now() - lastTradeMs) / 86_400_000 : ageDays;
  let sScore = clamp(Math.min(ageDays, 14) * 5 + 30 - silentDays * 20);
  parts.push({
    k: "surv", label: "Выживаемость", score: Math.round(sScore), weight: 15,
    note: ageDays < 1 ? "токену меньше суток" : `${Math.floor(ageDays)}д жизни, ${silentDays > 1 ? `тишина ${Math.floor(silentDays)}д` : "торгуется сегодня"}`,
  });

  const score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / 100);
  const verdict = score >= 75 ? "Здоровый профиль"
    : score >= 50 ? "Средний риск"
    : score >= 30 ? "Повышенный риск"
    : "Высокий риск";
  return { score, verdict, parts };
}
