// Текущая позиция: сделки ПОСЛЕ последнего обнуления баланса.
// Прогоняем историю по порядку; каждый раз, когда остаток падает ниже
// 1 токена («пыль» от округления), позиция считается закрытой и счёт
// начинается заново — как на GMGN. Полная история остаётся в «Истории сделок».
export function currentPosition(trades) {
  const asc = [...trades].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
  let bal = 0;
  let start = 0;
  for (let i = 0; i < asc.length; i++) {
    bal += asc[i].side === "buy" ? asc[i].tokens : -asc[i].tokens;
    if (bal < 1) start = i + 1;
  }
  return asc.slice(start);
}

// Себестоимость позиции с поправкой на переводы. Монеты, ушедшие с кошелька
// без продажи (перевод на другой адрес, раздача), уносят с собой свою среднюю
// цену покупки — это не убыток, деньги «уехали» вместе с монетами. Монеты,
// пришедшие переводом, стоят 0: всё, что они стоят сейчас, — прибыль.
//   trades — сделки кошелька по этой монете (side: buy/sell, eth, fee, tokens)
//   balTok — реальный баланс на кошельке (в монетах)
export function costBasis(trades, balTok) {
  let invested = 0, realized = 0, buysTok = 0, sellsTok = 0;
  for (const x of trades) {
    if (x.side === "buy") { invested += x.eth + (x.fee || 0); buysTok += x.tokens; }
    else { realized += x.eth; sellsTok += x.tokens; }
  }
  const avg = buysTok > 0 ? invested / buysTok : 0;          // цена за монету
  const netTok = Math.max(0, buysTok - sellsTok);            // что должно остаться по сделкам
  const heldTok = Math.min(Math.max(0, balTok), netTok);     // из них реально на балансе
  const movedOut = netTok - heldTok;                         // ушло переводом
  const heldCost = avg * heldTok;                            // себестоимость остатка
  const effInvested = invested - avg * movedOut;             // вложено без «уехавших»
  return { invested, realized, buysTok, sellsTok, avg, heldTok, movedOut, heldCost, effInvested };
}
