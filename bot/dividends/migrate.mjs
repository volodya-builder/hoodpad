// ============================================================================
//  hood — автоматический перенос ликвидности градуировавших монет на DEX.
//
//  Когда кривая заполняется, торговля на ней закрывается, а ликвидность
//  (200M монет + резерв) должна уехать в Uniswap V3 через migrate() пула.
//  В V3 перенос происходит прямо внутри покупки, которая заполнила кривую
//  (как у Pons) — этот бот лишь страховка: если перенос сорвался (цена в
//  пуле Uniswap сбита сильнее допуска мигратора), покупка проходит, а пул
//  остаётся с деньгами на кривой. Бот каждые полминуты смотрит события
//  Graduated у всех пулов обеих фабрик и зовёт migrate() у тех, кто ещё
//  не мигрировал. Звать migrate() может кто угодно; бот только платит газ,
//  деньги идут по коду пула.
//
//  Если миграция не проходит (например, кто-то заранее сбил цену в пуле
//  Uniswap сильнее допуска мигратора), транзакция откатывается целиком,
//  деньги остаются на кривой, и бот пробует снова через полминуты.
//  Кэш между проверками (MIGRATE_CACHE=файл): список пулов, последний
//  просмотренный блок, кто уже мигрировал — чтобы не долбить публичный RPC.
//
//  Запуск отдельно:
//     node bot/dividends/migrate.mjs          # сухой прогон
//     node bot/dividends/migrate.mjs --run    # с транзакциями (TREASURER_PRIVATE_KEY)
//  Из бота дивидендов: import { migrateGraduated } и вызвать с клиентами.
// ============================================================================
import { parseAbi } from "viem";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const factoryAbi = parseAbi([
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, string name, string symbol, string metadataURI)",
]);
const quoteFactoryAbi = parseAbi([
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, address quote, uint16 divBps)",
]);
const poolAbi = parseAbi([
  "event Graduated(uint256 reserve, uint256 dexTokenReserve)",
  "function graduated() view returns (bool)",
  "function migrated() view returns (bool)",
  "function token() view returns (address)",
  "function migrate()",
]);
const erc20Abi = parseAbi(["function symbol() view returns (string)"]);

/**
 * Найти градуировавшие, но не мигрировавшие пулы и мигрировать их.
 *
 * Бережём RPC (публичный узел режет частые запросы): между проверками
 * храним кэш — список пулов, последний просмотренный блок, кто уже
 * мигрировал. Тогда проверка раз в полминуты — это 4 запроса
 * (номер блока, новые монеты у двух фабрик, новые градации) плюс по одному
 * чтению на пул, который ждёт миграции.
 *
 * @param {object} o
 * @param {import("viem").PublicClient} o.pub
 * @param {(address, abi, fn, args, label) => Promise<boolean>} o.send — отправка транзакции (или сухой лог)
 * @param {string[]} o.factories — [ETH-фабрика, quote-фабрика] (пустые пропускаются)
 * @param {bigint} o.fromBlock — блок деплоя фабрик (раньше событий нет)
 * @param {string} [o.cacheFile] — куда класть кэш между запусками (нет — без кэша)
 * @returns {Promise<{checked:number, pending:number, done:number}>}
 */
export async function migrateGraduated({ pub, send, factories, fromBlock, cacheFile, log = console.log }) {
  const [ethFactory, quoteFactory] = factories;
  let cache = { lastBlock: null, pools: [], pending: [], migrated: [] };
  if (cacheFile) {
    try { const c = JSON.parse(fs.readFileSync(cacheFile, "utf8")); if (c && Array.isArray(c.pools)) cache = c; } catch (e) { /* нет кэша — полный обход */ }
  }
  const head = await pub.getBlockNumber();
  const from = cache.lastBlock != null ? BigInt(cache.lastBlock) + 1n : fromBlock;
  const out = { checked: 0, pending: 0, done: 0 };
  if (from <= head) {
    // новые монеты с прошлой проверки
    if (ethFactory) {
      const logs = await pub.getLogs({ address: ethFactory, event: factoryAbi[0], fromBlock: from, toBlock: head });
      for (const l of logs) cache.pools.push(l.args.pool.toLowerCase());
    }
    if (quoteFactory) {
      const logs = await pub.getLogs({ address: quoteFactory, event: quoteFactoryAbi[0], fromBlock: from, toBlock: head });
      for (const l of logs) cache.pools.push(l.args.pool.toLowerCase());
    }
    cache.pools = [...new Set(cache.pools)];
    // новые градации — одним запросом по всем пулам
    if (cache.pools.length) {
      const grads = await pub.getLogs({ address: cache.pools, event: poolAbi[0], fromBlock: from, toBlock: head });
      for (const l of grads) {
        const a = l.address.toLowerCase();
        if (!cache.pending.includes(a) && !cache.migrated.includes(a)) cache.pending.push(a);
      }
    }
    cache.lastBlock = head.toString();
  }
  out.checked = cache.pools.length;

  for (const pool of [...cache.pending]) {
    const migrated = await pub.readContract({ address: pool, abi: poolAbi, functionName: "migrated" }).catch(() => null);
    if (migrated === null) continue; // узел не ответил — в следующий раз
    if (migrated) { cache.pending = cache.pending.filter((x) => x !== pool); cache.migrated.push(pool); continue; }
    out.pending++;
    let sym = "?";
    try {
      const token = await pub.readContract({ address: pool, abi: poolAbi, functionName: "token" });
      sym = await pub.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
    } catch (e) { /* не важно для миграции */ }
    log(`  $${sym}: кривая заполнена, ликвидность ещё на кривой — переношу на DEX`);
    try {
      const ok = await send(pool, poolAbi, "migrate", [], `миграция $${sym} на DEX`);
      if (ok) { out.done++; cache.pending = cache.pending.filter((x) => x !== pool); cache.migrated.push(pool); }
    } catch (e) {
      // самая частая причина — цена в пуле Uniswap сбита сильнее допуска; повторим через полминуты
      log(`  ✗ миграция $${sym} не прошла: ${(e.shortMessage || e.message || "").slice(0, 160)}`);
    }
  }
  if (cacheFile) {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch (e) { /* кэш не обязателен */ }
  }
  return out;
}

// ---------------------------------------------------------------- standalone
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { createPublicClient, createWalletClient, http, defineChain } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const ETH_FACTORY = (process.env.FACTORY || "0xe16ccf7c12ce0256473fff60a1c3f18def64f861").toLowerCase();
  const QUOTE_FACTORY = (process.env.QUOTE_FACTORY || "0x655b7ce112336ad29dacdce7cf434b03930407a3").toLowerCase();
  const FROM = BigInt(process.env.FACTORY_FROM_BLOCK || 65_270_000);
  const RUN = process.argv.includes("--run");
  let PK = (process.env.TREASURER_PRIVATE_KEY || "").replace(/["'\s]/g, "");
  if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
  if (RUN && !/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет TREASURER_PRIVATE_KEY — с --run без ключа нельзя."); process.exit(1); }
  if (!RUN) PK = "0x" + "1".padStart(64, "0");
  const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
  const account = privateKeyToAccount(PK);
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  const send = async (address, abi, functionName, args, label) => {
    if (!RUN) { console.log(`  [сухо] ${label}`); return true; }
    const hash = await wallet.writeContract({ address, abi, functionName, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${rc.status === "success" ? "✓" : "✗"} ${label} · ${hash}`);
    return rc.status === "success";
  };
  console.log(`hood миграция · ${new Date().toISOString()} · ${RUN ? "боевой запуск, кошелёк " + account.address : "сухой прогон"}`);
  const r = await migrateGraduated({ pub, send, factories: [ETH_FACTORY, QUOTE_FACTORY], fromBlock: FROM, cacheFile: process.env.MIGRATE_CACHE || "" });
  console.log(`пулов ${r.checked} · ждали миграции ${r.pending} · мигрировано ${r.done}`);
}
