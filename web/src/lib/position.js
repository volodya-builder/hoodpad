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
