// ============================================================================
//  Бот арены hood — платит вчерашнему подиуму из казны арены.
//
//  Экономика (перезапуск 16.09.2026): 10% каждой торговой комиссии
//  приходит в ArenaTreasury. Раз в сутки бот берёт ВСЁ, что накопилось в ETH,
//  и делит между вчерашним подиумом 70 / 20 / 10: выкупает монеты-призёры с
//  рынка и сжигает их в той же транзакции (казна умеет только это — вывода
//  из неё нет по замыслу). Подиум считает ЕДИНОЕ ядро арены
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

const DRY = process.argv.includes("--dry");
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = (process.env.FACTORY || "0xbe3e7ca55b6c4fc9e759bc8b43734b57a582da01").toLowerCase();
const QUOTE_FACTORY = (process.env.QUOTE_FACTORY || "0x4b55954a2910cfbb04f49e90e727fb1540b3a940").toLowerCase();
const TREASURY = (process.env.ARENA_TREASURY || "").toLowerCase();
const SUBGRAPH = process.env.SUBGRAPH ||
  "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/4.0.1/gn";
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
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
]);
const factoryAbi = parseAbi(["function poolOf(address) view returns (address)"]);
const poolAbi = parseAbi(["function graduated() view returns (bool)"]);

const gql = (q) => fetch(SUBGRAPH, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) }).then((r) => r.json()).then((j) => j.data);

/** Сделки монет за валюту → ETH-эквивалент, той же формулой, что на сайте
 *  (web/src/lib/data.js → toEthEquivalent): курс валюты с обозревателя,
 *  ETH — с coingecko/binance. Без курса сделка остаётся с нулём. */
const EXPLORER_API = process.env.EXPLORER_API || "https://robinhoodchain.blockscout.com/api/v2";
async function ethUsdRate() {
  const srcs = [
    async () => (await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")).json()).ethereum.usd,
    async () => parseFloat((await (await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT")).json()).price),
    async () => parseFloat((await (await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")).json()).data.amount),
  ];
  for (const s of srcs) { try { const v = await s(); if (v > 0) return v; } catch (e) { /* дальше */ } }
  return 0;
}
async function quoteTradesToEth(trades) {
  const q = trades.filter((t) => t.quote);
  if (!q.length) return;
  const rate = await ethUsdRate();
  const quotes = [...new Set(q.map((t) => t.quote))];
  const info = {};
  for (const a of quotes) {
    let usd = 0, dec = 18;
    try { usd = parseFloat((await (await fetch(`${EXPLORER_API}/tokens/${a}`)).json()).exchange_rate) || 0; } catch (e) { /* нет курса */ }
    try { dec = Number(await pub.readContract({ address: a, abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }], functionName: "decimals" })); } catch (e) { /* 18 */ }
    info[a] = { usd, dec };
  }
  for (const t of q) {
    const { usd, dec } = info[t.quote];
    const k = rate > 0 && usd > 0 ? usd / rate : 0;
    t.eth = (Number(t.ethRaw) / 10 ** dec) * k;
    t.fee = (Number(t.feeRaw) / 10 ** dec) * k;
  }
}

/** Токены и сделки в формате сайта — полная история, иначе подиум разойдётся с экраном. */
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
  // свежесть индексатора: платить по отставшим данным нельзя
  const meta = await gql(`{ _meta { block { number } } }`);
  const head = await pub.getBlockNumber();
  const lag = Number(head) - Number(meta?._meta?.block?.number ?? 0);
  // lag < 0 — индексатор опережает наш RPC-узел, это свежие данные
  return { tokens, trades, fresh: lag < 300, lag };
}

/** Что казна уже выплатила за день: по событиям Buyback с пометкой «arena <день> …». */
async function paidPlaces(dayKey) {
  const head = await pub.getBlockNumber();
  const hb = await pub.getBlock({ blockNumber: head });
  const old = await pub.getBlock({ blockNumber: head > 5000n ? head - 5000n : 0n });
  const secPerBlock = Math.max(0.05, (Number(hb.timestamp) - Number(old.timestamp)) / Number(head - old.number || 1n));
  const span = BigInt(Math.ceil((LOOKBACK_DAYS * 86400) / secPerBlock));
  const fromBlock = head > span ? head - span : 0n;
  const paid = new Map(); // место → сколько ETH уже потрачено
  // порциями: публичный RPC не любит большие диапазоны
  const STEP = 50_000n;
  for (let from = fromBlock; from <= head; from += STEP + 1n) {
    const to = from + STEP > head ? head : from + STEP;
    const logs = await pub.getLogs({ address: TREASURY, event: treasuryAbi.find((x) => x.type === "event"), fromBlock: from, toBlock: to });
    for (const l of logs) {
      const m = /^arena (\d{4}-\d{2}-\d{2}) (\d)/.exec(l.args.note || "");
      if (m && m[1] === dayKey) paid.set(Number(m[2]), (paid.get(Number(m[2])) || 0n) + (l.args.asset === "0x0000000000000000000000000000000000000000" ? l.args.amountIn : 0n));
    }
  }
  return paid;
}

async function main() {
  console.log(`hood · бот арены · ${new Date().toISOString()} · кошелёк ${account.address}${DRY ? " · СУХОЙ ПРОГОН" : ""}`);
  const owner = await pub.readContract({ address: TREASURY, abi: treasuryAbi, functionName: "owner" })
    .catch((e) => { if (DRY) { console.warn("⚠ Казна не отвечает (ещё не задеплоена?) — сухой прогон продолжаю:", e.shortMessage || e.message); return null; } throw e; });
  if (!DRY && owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Кошелёк ${account.address} не владелец казны ${TREASURY} (владелец ${owner}).`); process.exit(1);
  }
  const yesterday = dayStart(Date.now()) - DAY;
  const dayKey = new Date(yesterday).toISOString().slice(0, 10);

  const paid = await paidPlaces(dayKey).catch((e) => { if (DRY) { console.warn("⚠ События казны не прочитались:", e.shortMessage || e.message); return new Map(); } throw e; });
  if (paid.size >= 3) { console.log(`Подиум за ${dayKey} уже выплачен полностью.`); return; }

  const { tokens, trades, fresh, lag } = await loadArenaData();
  if (!tokens.length || !fresh) {
    console.warn(`⚠ Индексатор отстаёт на ${lag} блоков или пуст — выплата за ${dayKey} отложена до следующего запуска.`);
    process.exit(DRY ? 0 : 2);
  }
  const { chain: days } = buildChain(tokens, trades, ARENA_DAYS, yesterday + DAY - 1);
  const st = days.get(yesterday);
  // градуировавшие монеты выкупить нельзя — кривая закрыта
  const gradSet = new Set(tokens.filter((x) => x.graduated).map((x) => x.token.toLowerCase()));
  const pod = podium(st).filter((p) => !gradSet.has(p.token.toLowerCase()));
  if (!pod.length) { console.log(`Арена за ${dayKey}: подиума не было (нет сделок) — выплат нет, фонд копится.`); return; }

  // Фонд дня = что лежит сейчас + что уже выплачено за этот день (если прошлый
  // запуск оборвался посередине, остальные места получают доли от того же фонда).
  const bal = await pub.getBalance({ address: TREASURY });
  let paidSum = 0n; for (const v of paid.values()) paidSum += v;
  const pot = Number(formatEther(bal + paidSum));
  const potLeft = Number(formatEther(bal));
  console.log(`Фонд: ${pot.toFixed(6)} ETH · подиум за ${dayKey}: ${pod.map((p, i) => `${i + 1}. $${p.symbol}`).join("  ")}`);
  if (potLeft < DUST_ETH) { console.log("Фонд — пыль, копим дальше."); return; }

  for (let i = 0; i < pod.length; i++) {
    const place = i + 1;
    if (paid.has(place)) { console.log(`  ${place} место $${pod[i].symbol}: уже выплачено.`); continue; }
    const amtEth = Math.min(pot * SPLIT[i], Number(formatEther(await pub.getBalance({ address: TREASURY }))));
    if (amtEth < DUST_ETH) { console.log(`  ${place} место $${pod[i].symbol}: ${amtEth.toFixed(6)} ETH — пыль, пропуск.`); continue; }
    const amt = BigInt(Math.floor(amtEth * 1e18));
    const token = pod[i].token;
    const note = `arena ${dayKey} ${place} $${pod[i].symbol}`;
    // ETH-монета — напрямую у кривой; монета за валюту — через зап
    const ethPool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [token] }).catch(() => null);
    const isEth = ethPool && ethPool !== "0x0000000000000000000000000000000000000000";
    const fn = isEth ? "buybackEth" : "buybackViaZap";
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const argsFor = (minOut) => (isEth ? [token, amt, minOut, note] : [token, amt, minOut, deadline, note]);
    let expected;
    try {
      const sim = await pub.simulateContract({ account, address: TREASURY, abi: treasuryAbi, functionName: fn, args: argsFor(0n) });
      expected = sim.result;
    } catch (e) {
      console.error(`  ${place} место $${pod[i].symbol}: симуляция выкупа не прошла — ${e.shortMessage || e.message}`);
      if (DRY) { console.log(`    (сухо) заплатил бы ${amtEth.toFixed(6)} ETH через ${fn}`); }
      continue;
    }
    const minOut = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
    console.log(`  ${place} место $${pod[i].symbol}: ${amtEth.toFixed(6)} ETH → ≈${(Number(expected) / 1e18).toFixed(0)} монет, сжигаем${DRY ? " (сухо)" : ""}`);
    if (DRY) continue;
    const hash = await wallet.writeContract({ address: TREASURY, abi: treasuryAbi, functionName: fn, args: argsFor(minOut) });
    const rc = await pub.waitForTransactionReceipt({ hash });
    console.log(`    ${rc.status} ${hash}`);
    if (rc.status !== "success") { console.error("    выкуп не прошёл — останавливаюсь, остаток фонда ждёт следующего запуска."); process.exit(3); }
  }
  console.log("Готово.");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
