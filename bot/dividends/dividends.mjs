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
//
//  ⚠ Ключ держать ТОЛЬКО в GitHub Secret, не в файле и не в чате.
// ============================================================================
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, formatUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const QUOTE_FACTORY = (process.env.QUOTE_FACTORY || "0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f").toLowerCase();
const FEE_SPLITTER = (process.env.FEE_SPLITTER || "0x4b4ca78517a48876a4341cbbfbd96e15c9d99491").toLowerCase();
const BLOCKSCOUT = process.env.BLOCKSCOUT || "https://robinhoodchain.blockscout.com";
// Блок деплоя quote-фабрики: раньше него её событий не бывает.
const FACTORY_FROM_BLOCK = BigInt(process.env.FACTORY_FROM_BLOCK || 62_800_000);
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

const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const ZERO = "0x0000000000000000000000000000000000000000";

/** Курс валюты к доллару — с обозревателя. Нет курса — null, тогда порог
 *  считаем по газу: платим всё, что больше нуля (газ на этой сети ≈ 1 цент). */
const rateCache = new Map();
async function usdRate(asset) {
  const k = asset.toLowerCase();
  if (rateCache.has(k)) return rateCache.get(k);
  let rate = null;
  try {
    const r = await fetch(`${BLOCKSCOUT}/api/v2/tokens/${asset}`, { headers: { accept: "application/json" } });
    if (r.ok) { const j = await r.json(); const v = Number(j.exchange_rate); if (v > 0) rate = v; }
  } catch (e) { /* обозреватель недоступен — ниже запасной порог */ }
  rateCache.set(k, rate);
  return rate;
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

async function main() {
  console.log(`hood дивиденды · ${new Date().toISOString()} · ${RUN ? "боевой запуск, кошелёк " + account.address : "сухой прогон"}`);
  if (RUN) console.log(`баланс на газ: ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);

  const count = await read(QUOTE_FACTORY, factoryAbi, "tokenCount");
  if (count === 0n) { console.log("монет за валюту пока нет"); return; }
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
