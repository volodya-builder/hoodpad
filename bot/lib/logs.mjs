// ============================================================================
//  Чтение событий контракта с публичного RPC без «HTTP request failed».
//
//  Публичный узел Robinhood Chain режет очереди запросов: 50 подряд
//  eth_getLogs по 50 000 блоков (3 дня при блоке ~0,1 с) — и он отвечает
//  429/502, viem бросает «HTTP request failed», бот падает (18.09.2026: так
//  не сработали выкуп hood и арена в первый же час V3).
//
//  Здесь: начинаем не раньше блока деплоя контракта (раньше событий нет),
//  сперва пробуем одним запросом (узел тянет миллионы блоков за раз), а если
//  он отказал — идём порциями с паузой и повтором. Всегда возвращает массив.
// ============================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {import("viem").PublicClient} pub
 * @param {{ address: string, event: object, fromBlock: bigint, toBlock: bigint, log?: (s: string) => void }} o
 */
export async function getLogsSafe(pub, { address, event, fromBlock, toBlock, log = () => {} }) {
  if (fromBlock > toBlock) return [];
  // 1) одним запросом
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await pub.getLogs({ address, event, fromBlock, toBlock }); }
    catch (e) { log(`  события ${address.slice(0, 10)}… одним запросом не вышли (${(e.shortMessage || e.message || "").slice(0, 60)}), порциями`); await sleep(1500); }
  }
  // 2) порциями по 200k с паузой, каждая порция — до 4 попыток
  const out = [];
  const STEP = 200_000n;
  for (let from = fromBlock; from <= toBlock; from += STEP + 1n) {
    const to = from + STEP > toBlock ? toBlock : from + STEP;
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      try { out.push(...await pub.getLogs({ address, event, fromBlock: from, toBlock: to })); done = true; }
      catch (e) { await sleep(2000 * (attempt + 1)); }
    }
    if (!done) throw new Error(`не удалось прочитать события ${address} за блоки ${from}–${to} (узел не отвечает)`);
    await sleep(300);
  }
  return out;
}

/** Не раньше блока деплоя: события до него искать бессмысленно. */
export const DEPLOY_BLOCK = BigInt(process.env.FACTORY_FROM_BLOCK || 66_023_560);
export const maxBig = (a, b) => (a > b ? a : b);
