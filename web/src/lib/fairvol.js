// ============================================================================
// hood — «честный объём» (анти-вош ядро).
//
// Проблема: 50% комиссии возвращается создателю, поэтому накрутка объёма
// (вош-трейдинг) стоит ~0.5%. Накрученный объём ломает арену и голосование.
//
// Решение — детерминированный пересчёт объёма из он-чейн сделок:
//   1) вклад кошелька за период = |покупки − продажи| в ETH
//      (гонять туда-сюда бессмысленно: разница ≈ 0);
//   2) сделки кошелька-создателя токена не засчитываются вовсе;
//   3) один кошелёк не может дать больше 25% честного объёма токена
//      (сибил из одного кита не рисует «массовость»).
//
// Одинаковые данные → одинаковый результат у всех зрителей.
// ============================================================================

const WALLET_CAP = 0.25; // максимум доли одного кошелька в честном объёме

/**
 * Честный объём пула из списка сделок.
 * @param trades  сделки [{addr, side, eth, fee, ts}] уже отфильтрованные по периоду
 * @param creator адрес создателя токена (его сделки не в счёт), может быть null
 * @returns {{honest:number, gross:number, byWallet:Map<string,{buy:number,sell:number,net:number}>}}
 */
export function honestVolume(trades, creator, exclude = []) {
  const cre = (creator || "").toLowerCase();
  // Казна и фабрика не должны накручивать «честный объём»: иначе выкуп
  // победителя засчитывался бы ему как объём следующего дня — петля,
  // в которой один токен побеждает вечно за счёт денег казны.
  const skip = new Set([cre, ...exclude.map((a) => (a || "").toLowerCase())].filter(Boolean));
  const byWallet = new Map();
  let gross = 0;
  for (const tr of trades) {
    const v = tr.eth + (tr.fee || 0);
    gross += v;
    const k = tr.addr.toLowerCase();
    if (skip.has(k)) continue;
    const row = byWallet.get(k) || { buy: 0, sell: 0, net: 0 };
    if (tr.side === "buy") row.buy += v; else row.sell += v;
    byWallet.set(k, row);
  }
  let uncapped = 0;
  for (const row of byWallet.values()) {
    row.net = Math.abs(row.buy - row.sell);
    uncapped += row.net;
  }
  // Вклад одного кошелька ограничен четвертью ОБЩЕГО потока за период:
  // накрутка с одного адреса засчитывается максимум на 25% — остальное
  // сгорает. Строгий вариант «доля в итоге ≤ 25%» математически требует
  // 4+ участников и обнулял бы молодые честные токены, поэтому не он.
  const cap = uncapped * WALLET_CAP;
  let honest = 0;
  for (const row of byWallet.values()) honest += Math.min(row.net, cap || row.net);
  return { honest, gross, byWallet };
}

/**
 * Флаги кошелька для бейджей. Детерминированно из сделок пула.
 * @param addr       кошелёк
 * @param poolTrades все сделки этого пула [{addr, side, eth, fee, ts}]
 * @param createdAt  мс создания токена
 * @param creator    адрес создателя
 * @returns {string[]} флаги: "sniper" | "washer" | "fresh" | "creator"
 */
export function walletFlags(addr, poolTrades, createdAt, creator) {
  const k = addr.toLowerCase();
  const flags = [];
  if (creator && k === creator.toLowerCase()) flags.push("creator");
  const mine = poolTrades.filter((tr) => tr.addr.toLowerCase() === k);
  if (!mine.length) return flags;

  // 🎯 снайпер: первая покупка в первые 60 секунд жизни токена
  if (createdAt) {
    const firstBuy = mine.filter((t) => t.side === "buy").sort((a, b) => a.ts - b.ts)[0];
    if (firstBuy && firstBuy.ts - createdAt < 60_000) flags.push("sniper");
  }

  // 🔁 мойщик: большой оборот при почти нулевой чистой позиции
  let buy = 0, sell = 0;
  for (const t of mine) { if (t.side === "buy") buy += t.eth + (t.fee || 0); else sell += t.eth + (t.fee || 0); }
  const turn = buy + sell;
  if (mine.length >= 6 && turn > 0 && Math.abs(buy - sell) / turn < 0.15) flags.push("washer");

  // 🌱 свежий: первая сделка на площадке моложе суток — считается снаружи
  return flags;
}

/** Первое появление кошельков на площадке (для флага «свежий»). */
export function firstSeenMap(allTrades) {
  const seen = {};
  for (const tr of allTrades) {
    const k = tr.addr.toLowerCase();
    if (seen[k] == null || tr.ts < seen[k]) seen[k] = tr.ts;
  }
  return seen;
}
