// ============================================================================
//  Бот арены hood — платит вчерашнему подиуму из казны арены.
//
//  Экономика (перезапуск 09.2026): 10% каждой торговой комиссии приходит в
//  ArenaTreasuryV3. Раз в сутки бот берёт ВСЁ, что накопилось в ETH, и делит
//  между вчерашним подиумом 70 / 20 / 10: выкупает монеты-призёры с рынка и
//  сжигает их в той же транзакции (казна умеет только это — вывода из неё
//  нет по замыслу). Монета на кривой выкупается у кривой (ETH-монета —
//  напрямую, монета за валюту — через зап); градуировавшая — на Uniswap V3
//  (buybackDex) — из выкупов монета не выпадает никогда. Подиум считает ЕДИНОЕ ядро арены
//  (web/src/lib/arena-core.js) — тот же код, что показывает бой на сайте.
//
//  Состояние — в блокчейне: перед выплатой бот читает события Buyback казны
//  за последние дни и не платит место, у которого уже есть событие с
//  пометкой «arena <день> <место>». Повторный запуск безопасен.
//
//  Запуск (GitHub Actions, .github/workflows/arena.yml):
//     node bot/arena/arena.mjs           # выплата за вчера, если ещё не было
//     node bot/arena/arena.mjs --dry     # только показать, что бы сделал
//
//  Переменные: ARENA_PRIVATE_KEY (ключ владельца казны — секрет GitHub),
//  ARENA_TREASURY (адрес казны — переменная GitHub), необязательно FACTORY,
//  QUOTE_FACTORY, SUBGRAPH, RPC_URL, DUST_ETH, SLIPPAGE_BPS.
//
//  Пока в арене только ETH-монеты: сабграф индексирует ETH-фабрику, а очки
//  боя считаются по её сделкам. Монеты за валюту войдут, когда сабграф
//  начнёт индексировать фабрику за валюту; их доля арены (USDG, акции) тем
//  временем копится в казне и пойдёт на их же выкуп.
// ============================================================================
import {
  createPublicClient, createWalletClient, http, parseAbi, formatEther, defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildChain, podium, dayStart, DAY, ARENA_DAYS, setSystemAddresses } from "../../web/src/lib/arena-core.js";
import { quoteUsd, ethUsdRate } from "../lib/quote-price.mjs";
import { getLogsSafe, DEPLOY_BLOCK, maxBig } from "../lib/logs.mjs";
import { treasuryCanConvert, convertTreasuryToEth, treasuryAccess } from "../lib/to-eth.mjs";

const DRY = process.argv.includes("--dry");
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = (process.env.FACTORY || "0xad8af2b36ff1c5891322cb4c82d74bac54fd80fb").toLowerCase();
const QUOTE_FACTORY = (process.env.QUOTE_FACTORY || "0x2501e3667622f21ce3f72c84a9b29e70439f4969").toLowerCase();
const TREASURY = (process.env.ARENA_TREASURY || "").toLowerCase();
// Прежняя казна арены (V1, 0x3cec…): туда всё ещё приходят излишки градаций
// (dustSink мигратора менять нельзя) и там лежит старый остаток. Бот платит
// подиуму и из неё — своим фондом, с пометкой «arena-old». Пусто — пропуск.
const LEGACY_TREASURY = (process.env.ARENA_TREASURY_LEGACY ?? "").toLowerCase();
const SUBGRAPH = process.env.SUBGRAPH ||
  "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/6.1.0/gn";
const SPLIT = [0.7, 0.2, 0.1];                          // 1 / 2 / 3 места
const DUST_ETH = Number(process.env.DUST_ETH || 0.0003); // меньше — не тратим газ, копим
const SLIPPAGE_BPS = BigInt(process.env.SLIPPAGE_BPS || 300); // 3% от симуляции: анти-MEV
const LOOKBACK_DAYS = 3;                                // сколько дней событий казны читаем

let PK = (process.env.ARENA_PRIVATE_KEY || process.env.TREASURER_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!DRY && !/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет ARENA_PRIVATE_KEY (ключ владельца казны арены)."); process.exit(1); }
if (!/^0x[0-9a-fA-F]{40}$/.test(TREASURY)) { console.error("Нет ARENA_TREASURY (адрес казны арены)."); process.exit(1); }
if (DRY && !/^0x[0-9a-fA-F]{64}$/.test(PK)) PK = "0x" + "1".padStart(64, "0");

// казна и фабрики не создают «честный объём» — иначе выкуп кормит очки призёра
setSystemAddresses([TREASURY, FACTORY, QUOTE_FACTORY]);

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } } });
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

const treasuryAbi = parseAbi([
  "function owner() view returns (address)",
  "function buybackEth(address token, uint256 ethAmount, uint256 minTokensOut, string note) returns (uint256)",
  "function buybackViaZap(address token, uint256 ethAmount, uint256 minTokensOut, uint256 deadline, string note) returns (uint256)",
  "function buybackQuote(address token, uint256 quoteAmount, uint256 minTokensOut, string note) returns (uint256)",
  "function buybackDex(address token, uint256 ethAmount, uint256 minTokensOut, string note) returns (uint256)",
  "function DEX_FEE() view returns (uint24)",
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
]);
const factoryAbi = parseAbi(["function poolOf(address) view returns (address)"]);
const poolAbi = parseAbi(["function graduated() view returns (bool)"]);
const quotePoolAbi = parseAbi(["function quote() view returns (address)"]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const gql = (q) => fetch(SUBGRAPH, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) }).then((r) => r.json()).then((j) => j.data);

/** Сделки монет за валюту → ETH-эквивалент, той же формулой, что на сайте
 *  (web/src/lib/data.js → toEthEquivalent): курс валюты с обозревателя,
 *  ETH — с coingecko/binance. Без курса сделка остаётся с нулём. */
async function quoteTradesToEth(trades) {
  const q = trades.filter((t) => t.quote);
  if (!q.length) return;
  const rate = await ethUsdRate(pub);
  const quotes = [...new Set(q.map((t) => t.quote))];
  const info = {};
  for (const a of quotes) info[a] = await quoteUsd(pub, a, rate || null);
  for (const t of q) {
    const { usd, dec } = info[t.quote];
    const k = rate > 0 && usd > 0 ? usd / rate : 0;
    t.eth = (Number(t.ethRaw) / 10 ** dec) * k;
    t.fee = (Number(t.feeRaw) / 10 ** dec) * k;
  }
  const missing = quotes.filter((a) => !(info[a].usd > 0));
  if (missing.length) console.warn(`⚠ нет курса у валют: ${missing.join(", ")} — их сделки считаются с нулём`);
}

/** Токены и сделки в формате сайта — полная история, иначе подиум разойдётся с экраном. */
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const WETH_ADDR = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const Q96 = 2n ** 96n;
const v3FactoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const v3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
/** Обмены монеты на Uniswap V3 (пул против WETH, 0,3%) в форме сделок арены:
 *  eth — сколько ETH прошло, price — ETH за монету после обмена, dex: true
 *  (ядро арены не гоняет их через кривую, а берёт цену как есть). */
async function dexTradesOf(t) {
  const pool = await pub.readContract({ address: V3_FACTORY, abi: v3FactoryAbi, functionName: "getPool", args: [t.token, WETH_ADDR, 3000] });
  if (!pool || pool.toLowerCase() === ZERO_ADDR) return [];
  const t0 = await pub.readContract({ address: pool, abi: v3PoolAbi, functionName: "token0" });
  const isT0 = t0.toLowerCase() === String(t.token).toLowerCase();
  const head = await pub.getBlockNumber();
  const logs = await getLogsSafe(pub, { address: pool, event: v3PoolAbi[1], fromBlock: DEPLOY_BLOCK, toBlock: head, log: () => {} });
  if (!logs.length) return [];
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? Number(a.logIndex - b.logIndex) : Number(a.blockNumber - b.blockNumber)));
  const minB = Number(logs[0].blockNumber);
  const [hb, ob] = await Promise.all([pub.getBlock({ blockNumber: head }), pub.getBlock({ blockNumber: BigInt(minB) })]);
  const span = Number(head) - minB;
  const avg = span > 0 ? (Number(hb.timestamp) - Number(ob.timestamp)) / span : 0;
  const out = [];
  for (const l of logs) {
    const tokAmt = isT0 ? l.args.amount0 : l.args.amount1;
    const ethAmt = isT0 ? l.args.amount1 : l.args.amount0;
    const s = BigInt(l.args.sqrtPriceX96);
    const raw = isT0 ? (s * s * 10n ** 18n) / (Q96 * Q96) : (Q96 * Q96 * 10n ** 18n) / (s * s || 1n);
    const ethAbs = ethAmt < 0n ? -ethAmt : ethAmt;
    out.push({
      pool: t.pool, side: tokAmt < 0n ? "buy" : "sell", addr: String(l.args.recipient).toLowerCase(),
      eth: Number(ethAbs) / 1e18, tokens: Math.abs(Number(tokAmt)) / 1e18, fee: 0,
      ts: (Number(ob.timestamp) + (Number(l.blockNumber) - minB) * avg) * 1000,
      quote: null, ethRaw: ethAbs.toString(), feeRaw: "0", dex: true, price: Number(raw) / 1e18,
    });
  }
  return out;
}

async function loadArenaData() {
  const td = await gql(`{ tokens(first: 500) { id symbol creator pool createdAt graduated ethReserve tokensSold } }`);
  const tokens = (td?.tokens || []).map((x) => ({
    token: x.id, symbol: x.symbol, creator: x.creator, pool: (x.pool || "").toLowerCase(),
    createdAt: Number(x.createdAt) * 1000, graduated: !!x.graduated,
    reserve: x.ethReserve, sold: x.tokensSold, meta: {},
  }));
  const trades = [];
  let beforeTs = null;
  // сабграф 3.1.0+: у сделки есть quote (валюта курвы). Без поля — старый сабграф.
  let hasQuote = true;
  try { const t = await gql("{ trades(first: 1) { quote } }"); hasQuote = !!t; } catch (e) { hasQuote = false; }
  for (let page = 0; page < 60; page++) {
    const cond = beforeTs ? `, where: { timestamp_lt: "${beforeTs}" }` : "";
    const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc${cond}) {
      pool trader isBuy ethAmount tokenAmount fee timestamp${hasQuote ? " quote" : ""} } }`);
    const rows = d?.trades || [];
    for (const l of rows) {
      trades.push({ pool: l.pool.toLowerCase(), side: l.isBuy ? "buy" : "sell", addr: l.trader,
        eth: Number(l.ethAmount) / 1e18, tokens: Number(l.tokenAmount) / 1e18,
        fee: Number(l.fee) / 1e18, ts: Number(l.timestamp) * 1000,
        quote: l.quote ? String(l.quote).toLowerCase() : null, ethRaw: l.ethAmount, feeRaw: l.fee });
    }
    if (rows.length < 1000) break;
    beforeTs = rows[rows.length - 1].timestamp;
  }
  await quoteTradesToEth(trades);
  // градуировавшие монеты живут на Uniswap: их обмены — тоже сделки арены
  for (const t of tokens) {
    if (!t.graduated || !t.pool) continue;
    try { trades.push(...(await dexTradesOf(t))); } catch (e) { console.log(`dex ${t.symbol}: ${e.message || e}`); }
  }
  // свежесть индексатора: платить по отставшим данным нельзя
  const meta = await gql(`{ _meta { block { number } } }`);
  const head = await pub.getBlockNumber();
  const lag = Number(head) - Number(meta?._meta?.block?.number ?? 0);
  // lag < 0 — индексатор опережает наш RPC-узел, это свежие данные
  return { tokens, trades, fresh: lag < 300, lag };
}

/** Что казна уже выплатила за день: по событиям Buyback с пометкой «arena <день> …». */
async function paidPlaces(dayKey, treasury = TREASURY, prefix = "arena") {
  const head = await pub.getBlockNumber();
  const hb = await pub.getBlock({ blockNumber: head });
  const old = await pub.getBlock({ blockNumber: head > 5000n ? head - 5000n : 0n });
  const secPerBlock = Math.max(0.05, (Number(hb.timestamp) - Number(old.timestamp)) / Number(head - old.number || 1n));
  const span = BigInt(Math.ceil((LOOKBACK_DAYS * 86400) / secPerBlock));
  const fromBlock = maxBig(DEPLOY_BLOCK, head > span ? head - span : 0n);
  const paid = new Map(); // место → { asset, amount } уже потрачено
  {
    const logs = await getLogsSafe(pub, { address: treasury, event: treasuryAbi.find((x) => x.type === "event"), fromBlock, toBlock: head, log: console.log });
    for (const l of logs) {
      const m = new RegExp(`^${prefix} (\\d{4}-\\d{2}-\\d{2}) (\\d)`).exec(l.args.note || "");
      if (m && m[1] === dayKey) {
        const asset = l.args.asset === "0x0000000000000000000000000000000000000000" ? "eth" : String(l.args.asset).toLowerCase();
        const prev = paid.get(Number(m[2]));
        paid.set(Number(m[2]), { asset, amount: (prev?.amount || 0n) + l.args.amountIn });
      }
    }
  }
  return paid;
}

  // Фонд дня — по активам. ETH-монеты платятся из ETH казны, монеты за
  // валюту (USDG, акции, крипта) — из той же валюты, что лежит в казне:
  // доля арены от их комиссий приходит сюда в этой валюте (сплиттер не
  // меняет активы). Место i получает SPLIT[i] фонда В СВОЁМ активе.
  // Фонд актива = что лежит сейчас + что уже выплачено за этот день в нём
  // (если прошлый запуск оборвался посередине, остальные места получают
  // доли от того же фонда). Валюта, которой нет у монет подиума, копится.
async function payFrom(treasury, prefix, paid, pod, trades, dayKey) {
  const paidByAsset = {}; // asset(lower|"eth") → уже выплачено за день
  for (const v of paid.values()) paidByAsset[v.asset] = (paidByAsset[v.asset] || 0n) + v.amount;
  const potOf = async (asset) => {
    const bal = asset === "eth"
      ? await pub.getBalance({ address: treasury })
      : await pub.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [treasury] });
    return { bal, pot: bal + (paidByAsset[asset] || 0n) };
  };
  const assetInfo = async (asset) => {
    if (asset === "eth") return { sym: "ETH", dec: 18 };
    const [sym, dec] = await Promise.all([
      pub.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
      pub.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
    ]);
    return { sym: String(sym), dec: Number(dec) };
  };
  const fmtA = (v, dec, sym) => `${(Number(v) / 10 ** dec).toFixed(dec >= 8 ? 6 : 4)} ${sym}`;

  // Казна V2 копит в ETH: сначала переводим всю валюту казны (GME, USDG…) в
  // ETH, потом весь подиум оплачивается из ETH — любую монету, любой парой.
  const canConvert = await treasuryCanConvert(pub, treasury);
  // казна V3 умеет покупать на Uniswap (buybackDex) — проверяем по коду контракта
  const canDex = await pub.readContract({ address: treasury, abi: treasuryAbi, functionName: "DEX_FEE" }).then(() => true).catch(() => false);
  if (canConvert) {
    const assets = [...new Set(trades.map((t) => t.quote).filter(Boolean))];
    console.log(`Казна V2 · валюта → ETH (${assets.length} актив.)…`);
    await convertTreasuryToEth(pub, wallet, treasury, assets, { dry: DRY });
  }
  const ethBal = await pub.getBalance({ address: treasury });
  console.log(`Казна ${treasury.slice(0, 8)}…: ${formatEther(ethBal)} ETH${Object.keys(paidByAsset).length ? ` · уже выплачено сегодня: ${Object.keys(paidByAsset).length} актив(а)` : ""}`);

  for (let i = 0; i < pod.length; i++) {
    const place = i + 1;
    const token = pod[i].token;
    if (paid.has(place)) { console.log(`  ${place} место $${pod[i].symbol}: уже выплачено.`); continue; }
    // ETH-монета — у своей кривой за ETH; монета за валюту — из той же валюты казны
    const ethPool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [token] }).catch(() => null);
    const isEth = ethPool && ethPool !== "0x0000000000000000000000000000000000000000";
    let asset = "eth";
    let curvePool = isEth ? ethPool : null;
    if (!isEth) {
      const qPool = await pub.readContract({ address: QUOTE_FACTORY, abi: factoryAbi, functionName: "poolOf", args: [token] }).catch(() => null);
      if (!qPool || qPool === "0x0000000000000000000000000000000000000000") { console.log(`  ${place} место $${pod[i].symbol}: пул не найден, пропуск.`); continue; }
      curvePool = qPool;
      // V2+: платим ETH через зап; V1: из валюты казны, а если её нет — тоже ETH через зап
      if (!canConvert) {
        const q = (await pub.readContract({ address: qPool, abi: quotePoolAbi, functionName: "quote" })).toLowerCase();
        const qBal = await pub.readContract({ address: q, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }).catch(() => 0n);
        if (qBal > 0n) asset = q;
      }
    }
    // градуировала — кривая закрыта, покупаем на Uniswap V3 (казна V3); у старой казны такого нет — пропуск
    const graduated = await pub.readContract({ address: curvePool, abi: poolAbi, functionName: "graduated" }).catch(() => false);
    const viaDex = graduated;
    if (viaDex && !canDex) { console.log(`  ${place} место $${pod[i].symbol}: градуировала, а эта казна не умеет покупать на DEX — пропуск.`); continue; }
    if (viaDex) asset = "eth";
    const viaZap = !viaDex && !isEth && asset === "eth";
    const { sym, dec } = await assetInfo(asset);
    const { bal, pot } = await potOf(asset);
    const share = (pot * BigInt(Math.round(SPLIT[i] * 10000))) / 10000n;
    const amt = share < bal ? share : bal;
    const dust = asset === "eth" ? BigInt(Math.floor(DUST_ETH * 1e18)) : 0n;
    if (amt === 0n || amt < dust) {
      console.log(`  ${place} место $${pod[i].symbol}: фонд в ${sym} — ${fmtA(amt, dec, sym)}, пыль/пусто, копим.`);
      continue;
    }
    const note = `${prefix} ${dayKey} ${place} $${pod[i].symbol}`;
    const fn = viaDex ? "buybackDex" : isEth ? "buybackEth" : viaZap ? "buybackViaZap" : "buybackQuote";
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const argsFor = (minOut) => (viaZap ? [token, amt, minOut, deadline, note] : [token, amt, minOut, note]);
    let expected;
    try {
      const sim = await pub.simulateContract({ account, address: treasury, abi: treasuryAbi, functionName: fn, args: argsFor(0n) });
      expected = sim.result;
    } catch (e) {
      console.error(`  ${place} место $${pod[i].symbol}: симуляция выкупа не прошла — ${e.shortMessage || e.message}`);
      if (DRY) { console.log(`    (сухо) заплатил бы ${fmtA(amt, dec, sym)} через ${fn}`); }
      continue;
    }
    const minOut = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
    console.log(`  ${place} место $${pod[i].symbol}: ${fmtA(amt, dec, sym)} → ≈${(Number(expected) / 1e18).toFixed(0)} монет, сжигаем${DRY ? " (сухо)" : ""}`);
    if (DRY) continue;
    const hash = await wallet.writeContract({ address: treasury, abi: treasuryAbi, functionName: fn, args: argsFor(minOut) });
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log(`    ${rc.status} ${hash}`);
    if (rc.status !== "success") { console.error("    выкуп не прошёл — останавливаюсь, остаток фонда ждёт следующего запуска."); process.exit(3); }
  }
}

async function main() {
  console.log(`hood · бот арены · ${new Date().toISOString()} · кошелёк ${account.address}${DRY ? " · СУХОЙ ПРОГОН" : ""}`);
  // казна V2: платить может владелец или оператор (ключ бота); старая — только владелец
  const acc = await treasuryAccess(pub, TREASURY, account.address);
  if (!acc.owner) { if (DRY) console.warn("⚠ Казна не отвечает (ещё не задеплоена?) — сухой прогон продолжаю:", acc.why); else throw new Error(acc.why); }
  if (!DRY && !acc.ok) { console.error(acc.why); process.exit(1); }
  // --today (только с --dry): посмотреть подиум текущего дня по состоянию на сейчас
  const yesterday = DRY && process.argv.includes("--today") ? dayStart(Date.now()) : dayStart(Date.now()) - DAY;
  const dayKey = new Date(yesterday).toISOString().slice(0, 10);

  const paid = await paidPlaces(dayKey).catch((e) => { if (DRY) { console.warn("⚠ События казны не прочитались:", e.shortMessage || e.message); return new Map(); } throw e; });
  if (paid.size >= 3) { console.log(`Подиум за ${dayKey} уже выплачен полностью.`); return; }

  const { tokens, trades, fresh, lag } = await loadArenaData();
  if (!tokens.length || !fresh) {
    console.warn(`⚠ Индексатор отстаёт на ${lag} блоков или пуст — выплата за ${dayKey} отложена до следующего запуска.`);
    process.exit(DRY ? 0 : 2);
  }
  // «Сейчас» для цепочки — ровно конец вчерашнего дня (не на миллисекунду
  // раньше!): иначе ядро считало вчера ещё идущим днём, чемпиона не называло
  // и бот писал «подиума не было» при живых сделках (17.09.2026).
  const { chain: days } = buildChain(tokens, trades, ARENA_DAYS, yesterday + DAY);
  const st = days.get(yesterday);
  // градуировавшие монеты тоже в подиуме: казна V3 покупает их на Uniswap
  const pod = podium(st);
  if (!pod.length) { console.log(`Арена за ${dayKey}: подиума не было (нет сделок) — выплат нет, фонд копится.`); return; }

  console.log(`Подиум за ${dayKey}: ${pod.map((p, i) => `${i + 1}. $${p.symbol}`).join("  ")}`);
  await payFrom(TREASURY, "arena", paid, pod, trades, dayKey);
  if (/^0x[0-9a-f]{40}$/.test(LEGACY_TREASURY) && LEGACY_TREASURY !== TREASURY) {
    const legacyEth = await pub.getBalance({ address: LEGACY_TREASURY });
    const paidOld = await paidPlaces(dayKey, LEGACY_TREASURY, "arena-old").catch(() => new Map());
    if (paidOld.size < 3 && legacyEth > 0n) {
      console.log(`Прежняя казна ${LEGACY_TREASURY.slice(0, 8)}…: ${formatEther(legacyEth)} ETH — платим подиуму и из неё`);
      await payFrom(LEGACY_TREASURY, "arena-old", paidOld, pod, trades, dayKey);
    }
  }
  console.log("Готово.");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
