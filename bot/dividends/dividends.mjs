// ============================================================================
//  hood — бот автовыплаты дивидендов и сбора протокольной доли у монет за валюту.
//
//  Что делает каждый запуск (GitHub Actions, раз в час):
//   1. Обходит монеты quote-фабрики. У монеты с налогом (divBps > 0) находит
//      холдеров по событиям Transfer и каждому, у кого накопилось больше
//      порога, переводит его дивиденды на кошелёк — claimFor(holder).
//      Деньги уходят только самому холдеру; бот лишь платит газ, поэтому
//      людям не нужно заходить и жать «забрать». Забрать вручную можно
//      по-прежнему — claim() у токена никуда не делся.
//   2. У пула монеты забирает накопившуюся протокольную долю комиссии через
//      FeeSplitterV4.claim(pool) — она делится там же на команду / агента /
//      создателя. Только если казна фабрики уже = сплиттер (после applyConfig).
//
//  Экономия: платим газ, только когда сумма стоит того (MIN_PAYOUT_USD, по
//  умолчанию 5 центов при газе ≈ 1 цент). Не больше MAX_TX транзакций за
//  запуск. Ключ — любой кошелёк с ETH на газ: у claimFor и claim нет прав,
//  их может дёрнуть кто угодно.
//
//  Запуск:
//     node bot/dividends/dividends.mjs          # сухой прогон: кому и сколько, без транзакций
//     node bot/dividends/dividends.mjs --run    # с транзакциями (нужен TREASURER_PRIVATE_KEY)
//     node bot/dividends/dividends.mjs --run --migrate-only   # только перенос градуировавших монет на DEX
//
//  ⚠ Ключ держать ТОЛЬКО в GitHub Secret, не в файле и не в чате.
// ============================================================================
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, formatUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteUsd, ethUsdRate } from "../lib/quote-price.mjs";
import { migrateGraduated } from "./migrate.mjs";

const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const QUOTE_FACTORY = (process.env.QUOTE_FACTORY || "0x655b7ce112336ad29dacdce7cf434b03930407a3").toLowerCase();
const ETH_FACTORY = (process.env.FACTORY || "0xe16ccf7c12ce0256473fff60a1c3f18def64f861").toLowerCase();
const FEE_SPLITTER = (process.env.FEE_SPLITTER || "0xad10637462a0e8abaabacc1cceb16ffabe56e529").toLowerCase();
const BLOCKSCOUT = process.env.BLOCKSCOUT || "https://robinhoodchain.blockscout.com";
// Блок деплоя quote-фабрики: раньше него её событий не бывает.
const FACTORY_FROM_BLOCK = BigInt(process.env.FACTORY_FROM_BLOCK || 64_580_000);
const MIN_PAYOUT_USD = Number(process.env.MIN_PAYOUT_USD || 1);
const MIN_SWEEP_USD = Number(process.env.MIN_SWEEP_USD || 0.5);
const MAX_TX = Number(process.env.MAX_TX || 150);
const MAX_HOLDERS = Number(process.env.MAX_HOLDERS || 3000);
const RUN = process.argv.includes("--run");

let PK = (process.env.TREASURER_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (RUN && !/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет TREASURER_PRIVATE_KEY — с --run без ключа нельзя."); process.exit(1); }
if (!RUN) PK = "0x" + "1".padStart(64, "0"); // сухой прогон только читает

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } } });
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

const factoryAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256 offset, uint256 limit) view returns (address[])",
  "function poolOf(address) view returns (address)",
  "function treasury() view returns (address)",
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, address quote, uint16 divBps)",
]);
const poolAbi = parseAbi([
  "function divBps() view returns (uint16)",
  "function quote() view returns (address)",
  "function protocolFeesAccrued() view returns (uint256)",
]);
const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function pot() view returns (uint256)",
  "function divSupply() view returns (uint256)",
  "function excluded(address) view returns (bool)",
  "function withdrawableDividendOf(address) view returns (uint256)",
  "function claimFor(address holder) returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const splitterAbi = parseAbi(["function claim(address pool)"]);
const ethPoolAbi = parseAbi(["function protocolFeesAccrued() view returns (uint256)", "function claimProtocolFees()"]);

const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const ZERO = "0x0000000000000000000000000000000000000000";

/** Курс валюты к доллару: пулы Uniswap V3 сети, запасной — обозреватель
 *  (bot/lib/quote-price.mjs). Нет курса — null, тогда платим всё, что
 *  больше нуля (газ на этой сети ≈ 1 цент). */
async function usdRate(asset) {
  const { usd } = await quoteUsd(pub, asset);
  return usd > 0 ? usd : null;
}

let txCount = 0;
async function send(address, abi, functionName, args, label) {
  if (txCount >= MAX_TX) { console.log(`  лимит ${MAX_TX} транзакций за запуск — ${label} отложено до следующего часа`); return false; }
  txCount++;
  if (!RUN) { console.log(`  [сухо] ${label}`); return true; }
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${rc.status === "success" ? "✓" : "✗"} ${label} · ${hash}`);
  return rc.status === "success";
}

/** ETH-монеты: доля платформы копится в пуле, пока кто-нибудь не дёрнет
 *  claimProtocolFees() — пул сам шлёт её в казну фабрики (сплиттер), а тот
 *  сразу делит между аренами/командой. Раньше это делал бот-казначей v2,
 *  теперь он выключен — забираем здесь, раз в час. Порог — в ETH по курсу. */
async function sweepEthPools() {
  const count = await read(ETH_FACTORY, factoryAbi, "tokenCount");
  if (count === 0n) { console.log("\nETH-монет пока нет"); return; }
  const toks = await read(ETH_FACTORY, factoryAbi, "tokens", [0n, count]);
  const treasury = (await read(ETH_FACTORY, factoryAbi, "treasury")).toLowerCase();
  if (treasury !== FEE_SPLITTER) { console.log(`\nETH-фабрика: казна ${treasury} — не сплиттер, долю платформы не трогаем`); return; }
  const rate = await ethUsdRate(pub);
  console.log(`\nETH-монет: ${toks.length} · доля платформы → сплиттер${rate ? ` · ETH $${rate}` : ""}`);
  for (const token of toks) {
    const pool = await read(ETH_FACTORY, factoryAbi, "poolOf", [token]);
    const acc = await read(pool, ethPoolAbi, "protocolFeesAccrued").catch(() => 0n);
    if (acc === 0n) continue;
    const sym = await read(token, tokenAbi, "symbol").catch(() => "?");
    const usdv = rate ? (Number(acc) / 1e18) * rate : null;
    const label = `$${sym}: ${formatEther(acc)} ETH${usdv != null ? ` ($${usdv.toFixed(2)})` : ""}`;
    if (usdv != null && usdv < MIN_SWEEP_USD) { console.log(`  ${label} — ниже порога $${MIN_SWEEP_USD}, ждём`); continue; }
    await send(pool, ethPoolAbi, "claimProtocolFees", [], `сплиттер: забрать ${label}`);
  }
}

async function main() {
  const migrateOnly = process.argv.includes("--migrate-only");
  if (!migrateOnly) {
    console.log(`hood дивиденды · ${new Date().toISOString()} · ${RUN ? "боевой запуск, кошелёк " + account.address : "сухой прогон"}`);
    if (RUN) console.log(`баланс на газ: ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
  }

  // 0) градуировавшие монеты — перенос ликвидности на DEX (без кнопок на сайте).
  //    Кэш между проверками, чтобы каждые 30 секунд не перечитывать всё с нуля.
  await migrateGraduated({ pub, send, factories: [ETH_FACTORY, QUOTE_FACTORY], fromBlock: FACTORY_FROM_BLOCK,
                           cacheFile: process.env.MIGRATE_CACHE || ".migrate-cache.json" })
    .then((r) => { if (r.pending || r.done) console.log(`миграций: ждали ${r.pending}, выполнено ${r.done}`); })
    .catch((e) => console.log("  миграция: проверка не удалась:", (e.details || e.shortMessage || e.message || "").slice(0, 120)));
  if (migrateOnly) return;

  await sweepEthPools().catch((e) => console.log("  ETH-монеты: сбор не удался:", (e.shortMessage || e.message || "").slice(0, 100)));

  const count = await read(QUOTE_FACTORY, factoryAbi, "tokenCount");
  if (count === 0n) { console.log("\nмонет за валюту пока нет"); return; }
  const toks = await read(QUOTE_FACTORY, factoryAbi, "tokens", [0n, count]);
  const treasury = (await read(QUOTE_FACTORY, factoryAbi, "treasury")).toLowerCase();
  const splitterLive = treasury === FEE_SPLITTER;
  console.log(`монет: ${toks.length} · казна фабрики ${splitterLive ? "= сплиттер, протокольную долю собираем" : "пока не сплиттер, протокольную долю не трогаем"}`);
  const latest = await pub.getBlockNumber();

  // Блок создания каждой монеты — чтобы не читать переводы с начала времён.
  const created = new Map();
  try {
    const logs = await pub.getLogs({ address: QUOTE_FACTORY, event: factoryAbi.find((x) => x.type === "event"), fromBlock: FACTORY_FROM_BLOCK, toBlock: latest });
    for (const l of logs) created.set(l.args.token.toLowerCase(), l.blockNumber);
  } catch (e) { console.log("  события фабрики не прочитались:", (e.shortMessage || e.message).slice(0, 80)); }

  let paidTotal = 0, holdersTotal = 0;
  for (const token of toks) {
    const pool = await read(QUOTE_FACTORY, factoryAbi, "poolOf", [token]);
    const [divBps, quote, sym] = await Promise.all([
      read(pool, poolAbi, "divBps"), read(pool, poolAbi, "quote"), read(token, tokenAbi, "symbol").catch(() => "?"),
    ]);
    const [dec, qsym] = await Promise.all([read(quote, erc20Abi, "decimals"), read(quote, erc20Abi, "symbol").catch(() => "?")]);
    const D = 10 ** Number(dec);
    const rate = await usdRate(quote);
    const usd = (v) => (rate ? (Number(v) / D) * rate : null);
    const fmt = (v) => `${(+formatUnits(v, Number(dec))).toString().slice(0, 12)} ${qsym}${rate ? ` ($${usd(v).toFixed(2)})` : ""}`;
    console.log(`\n$${sym} ${token} · валюта ${qsym} · налог ${Number(divBps) / 100}%${rate ? ` · курс $${rate}` : " · курса нет"}`);

    // --- 2) протокольная доля → сплиттер
    if (splitterLive) {
      const acc = await read(pool, poolAbi, "protocolFeesAccrued");
      const ok = acc > 0n && (rate ? usd(acc) >= MIN_SWEEP_USD : true);
      if (ok) await send(FEE_SPLITTER, splitterAbi, "claim", [pool], `сплиттер: забрать ${fmt(acc)} протокольной доли`);
      else if (acc > 0n) console.log(`  протокольная доля ${fmt(acc)} — ниже порога $${MIN_SWEEP_USD}, ждём`);
    }

    // --- 1) дивиденды
    if (Number(divBps) === 0) continue;
    const from = created.get(token.toLowerCase()) ?? FACTORY_FROM_BLOCK;
    const transfers = await pub.getLogs({ address: token, event: tokenAbi.find((x) => x.type === "event"), fromBlock: from, toBlock: latest });
    const holders = new Set();
    for (const l of transfers) { if (l.args.to && l.args.to !== ZERO) holders.add(l.args.to.toLowerCase()); }
    holders.delete(pool.toLowerCase()); holders.delete(token.toLowerCase()); holders.delete(FEE_SPLITTER);
    const [pot, divSupply] = await Promise.all([read(token, tokenAbi, "pot"), read(token, tokenAbi, "divSupply")]);
    if (pot > 0n) console.log(`  в копилке ${fmt(pot)} — раздастся холдерам со следующей сделкой${divSupply < 1000n * 10n ** 18n ? " (холдеров ещё слишком мало)" : ""}`);

    let n = 0, paid = 0;
    for (const h of [...holders].slice(0, MAX_HOLDERS)) {
      const w = await read(token, tokenAbi, "withdrawableDividendOf", [h]);
      if (w === 0n) continue;
      const worth = rate ? usd(w) >= MIN_PAYOUT_USD : true;
      if (!worth) { console.log(`  ${h.slice(0, 10)}… накопилось ${fmt(w)} — ниже порога $${MIN_PAYOUT_USD}, копим`); continue; }
      const ok = await send(token, tokenAbi, "claimFor", [h], `выплата ${h.slice(0, 10)}… ${fmt(w)}`);
      if (ok) { n++; paid += Number(w) / D; }
    }
    holdersTotal += holders.size; paidTotal += n;
    console.log(`  холдеров ${holders.size}, выплат ${n}${n ? `, всего ${paid.toFixed(6)} ${qsym}` : ""}`);
  }
  console.log(`\nитого: холдеров просмотрено ${holdersTotal}, выплат ${paidTotal}, транзакций ${txCount}${RUN ? "" : " (сухой прогон — ничего не отправлено)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
