// Репутация создателя: 0-100 по он-чейн истории всех его запусков.
// Детерминированно, объяснимо, невозможно накрутить без реальной работы.
//
// Компоненты:
//   опыт        — сколько токенов запустил (диминишинг, максимум 20)
//   успех       — градуировавшие токены (мощный сигнал, до 30)
//   живучесть   — доля токенов со сделками за последние 7 дней (до 25)
//   честность   — держит ли собственные позиции: слил >70% — руг-штраф (до 25)
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/**
 * @param creator  адрес
 * @param tokens   loadTokens()
 * @param trades   allTrades() — плоский список последних сделок
 */
export function computeCreatorRep({ creator, tokens, trades }) {
  const me = (creator || "").toLowerCase();
  const mine = (tokens || []).filter((x) => (x.creator || "").toLowerCase() === me);
  if (mine.length === 0) return null;

  const byPool = {};
  for (const tr of trades || []) (byPool[tr.pool] ??= []).push(tr);

  const week = Date.now() - 7 * 86_400_000;
  let alive = 0, rugs = 0, held = 0;
  for (const tk of mine) {
    const list = byPool[(tk.pool || "").toLowerCase()] || [];
    if (tk.graduated || list.some((tr) => tr.ts >= week)) alive++;
    const cBuy = list.filter((tr) => tr.side === "buy" && tr.addr.toLowerCase() === me)
      .reduce((s, tr) => s + tr.tokens, 0);
    const cSell = list.filter((tr) => tr.side === "sell" && tr.addr.toLowerCase() === me)
      .reduce((s, tr) => s + tr.tokens, 0);
    if (cBuy > 0 && cSell / cBuy > 0.7) rugs++;
    else if (cBuy > 0 && cSell / cBuy < 0.3) held++;
  }
  const grads = mine.filter((x) => x.graduated).length;
  const alivePct = alive / mine.length;

  const exp = Math.min(mine.length, 5) * 4;                  // до 20
  const success = Math.min(grads * 15, 30);                  // до 30
  const liveScore = alivePct * 25;                           // до 25
  const integrity = clamp(25 - rugs * 25 + (held / Math.max(mine.length, 1)) * 10, 0, 25);
  const score = Math.round(clamp(exp + success + liveScore + integrity));

  return {
    score,
    launches: mine.length,
    grads,
    alive,
    rugs,
    held,
    verdict: rugs > 0 ? "Замечен в сливах"
      : score >= 70 ? "Проверенный создатель"
      : score >= 45 ? "Развивающийся"
      : "Новичок",
  };
}
