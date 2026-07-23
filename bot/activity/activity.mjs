// ============================================================================
//  hood activity bot — оживляет площадку для обкатки:
//   1) один раз копирует топ-N токенов Pons (имя/тикер/лого/описание/соцсети)
//      на фабрику hood v2;
//   2) в каждом запуске крутит РЕАЛИСТИЧНУЮ торговлю (покупки+продажи) с
//      нескольких кошельков, укладываясь в дневной бюджет BUDGET_USD.
//
//  Автозапуск: .github/workflows/activity.yml (cron). Бюджет и кошельки —
//  в bot/activity/state.json (в .gitignore, ключи не коммитятся).
//
//  ⚠ Ключ фандера — из секрета ACTIVITY_PRIVATE_KEY. Не в файле.
// ============================================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther, defineChain,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ конфиг
const HOOD_RPC   = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const HOOD_FACTORY = process.env.HOOD_FACTORY || "0x68a983f0c73f1a5dc13aa3ae71a19a5787162cdb";
const SEED_N     = Number(process.env.SEED_N || 16);      // сколько тематических токенов создать
const WALLETS    = Number(process.env.WALLETS || 4);      // тестовых кошельков
const BUDGET_USD = Number(process.env.BUDGET_USD || 10);  // лимит трат в сутки, $
const ETH_USD    = Number(process.env.ETH_USD || 2000);   // грубый курс для лимита
const IMG_BUDGET = 120_000;

const RAW_PK = process.env.ACTIVITY_PRIVATE_KEY || "";
let PK = RAW_PK.replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error(`Ключ не читается. Длина пришедшего значения: ${RAW_PK.length} символов ` +
    `(после чистки ${PK.length}). Ожидается 66 (0x + 64 hex). ` +
    `Если 0 — секрет ACTIVITY_PRIVATE_KEY пустой/не передался.`);
  process.exit(1);
}

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [HOOD_RPC] } } });
const funder = privateKeyToAccount(PK);
const pub  = createPublicClient({ chain, transport: http(HOOD_RPC) });
const W = (a) => createWalletClient({ account: a, chain, transport: http(HOOD_RPC) });

// Тематические токены hood (Робин Гуд) — имя, тикер, эмодзи, цвет фона.
const THEME = [
  ["Sherwood", "SHER", "🏹", "#1f8a4c"], ["Golden Arrow", "GARW", "➵", "#c9a227"],
  ["Maid Marian", "MARI", "🌹", "#c0392b"], ["Friar Tuck", "TUCK", "🍺", "#8e5a2a"],
  ["Little John", "LJON", "🪵", "#5d6d3b"], ["Nottingham", "NOTT", "🏰", "#5b5b6e"],
  ["Golden Goose", "GOOS", "🪿", "#d4af37"], ["Green Cloak", "CLOK", "🧥", "#2e7d4f"],
  ["Royal Stag", "STAG", "🦌", "#a9743c"], ["Great Oak", "OAKK", "🌳", "#3f6b35"],
  ["Silver Shilling", "SHIL", "🪙", "#9fa8b3"], ["King Richard", "RICH", "👑", "#b58a2e"],
  ["Sly Fox", "FOXX", "🦊", "#d3672b"], ["Night Owl", "OWLL", "🦉", "#4a4661"],
  ["Bullseye", "BULL", "🎯", "#b03a3a"], ["Full Quiver", "QUIV", "🏹", "#6d4f2a"],
  ["Merry Band", "MERR", "🎭", "#3b7a68"], ["Alan-a-Dale", "ADAL", "🎻", "#7a5230"],
  ["Loot Sack", "LOOT", "💰", "#977a1f"], ["Hood Hound", "HND", "🐶", "#6e4b8a"],
];
const svgLogo = (emoji, bg) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
  `<defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0%" stop-color="#ffffff33"/>` +
  `<stop offset="100%" stop-color="#00000000"/></radialGradient></defs>` +
  `<rect width="256" height="256" rx="56" fill="${bg}"/>` +
  `<rect width="256" height="256" rx="56" fill="url(#g)"/>` +
  `<text x="128" y="150" font-size="120" text-anchor="middle">${emoji}</text></svg>`, "utf8").toString("base64");

const factoryAbi = parseAbi([
  "function createToken(string name, string symbol, string metadataURI, address creatorWallet) payable returns (address, address)",
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256,uint256) view returns (address[])",
  "function poolOf(address) view returns (address)",
]);
const poolAbi = parseAbi([
  "function buy(uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256)",
  "function graduated() view returns (bool)",
  "function ethReserve() view returns (uint256)",
]);
const metaAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string, string, string, string, string)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const STATE = path.join(__dirname, "state.json");
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8"))
  : { keys: [], seeded: false, day: "", spentEth: 0 };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

// сброс дневного счётчика бюджета
const today = new Date().toISOString().slice(0, 10);
if (state.day !== today) { state.day = today; state.spentEth = 0; save(); }
const budgetEth = BUDGET_USD / ETH_USD;

async function main() {
  console.log(`hood activity · ${new Date().toISOString()} · фандер ${funder.address}`);
  console.log(`Бюджет дня: $${BUDGET_USD} (${budgetEth.toFixed(5)} ETH), потрачено ${state.spentEth.toFixed(5)} ETH`);

  // ---- 1) СИД тематических токенов (один раз) ------------------------
  const already = Number(await pub.readContract({ address: HOOD_FACTORY, abi: factoryAbi, functionName: "tokenCount" }));
  if (!state.seeded && already < SEED_N) {
    console.log(`Сид: создаю ${SEED_N} тематических токенов hood…`);
    for (const [name, symbol, emoji, bg] of THEME.slice(0, SEED_N)) {
      try {
        const uri = "data:application/json;base64," + Buffer.from(JSON.stringify({
          image: svgLogo(emoji, bg),
          description: `${name} — a citizen of the hood. The greedy hoard, hood gives back.`,
        }), "utf8").toString("base64");
        const h = await W(funder).writeContract({
          address: HOOD_FACTORY, abi: factoryAbi, functionName: "createToken",
          args: [name, symbol, uri, funder.address],
        });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`  + ${symbol.padEnd(6)} ${name}`);
        await sleep(1000);
      } catch (e) { console.warn(`  ! ${symbol}: ${(e.shortMessage || e.message).slice(0, 60)}`); }
    }
    state.seeded = true; save();
  }

  // ---- 2) ТОРГОВЛЯ в рамках бюджета ----------------------------------
  if (state.spentEth >= budgetEth) { console.log("Дневной бюджет исчерпан — торговля пропущена."); return; }

  // кошельки
  while (state.keys.length < WALLETS) state.keys.push(generatePrivateKey());
  save();
  const traders = state.keys.slice(0, WALLETS).map(privateKeyToAccount);
  // подкидываем газ+оборотку тем, у кого пусто
  for (const tr of traders) {
    const bal = await pub.getBalance({ address: tr.address });
    if (bal < parseEther("0.001")) {
      const h = await W(funder).sendTransaction({ to: tr.address, value: parseEther("0.0015") });
      await pub.waitForTransactionReceipt({ hash: h });
    }
  }

  // список живых пулов hood
  const cnt = Number(await pub.readContract({ address: HOOD_FACTORY, abi: factoryAbi, functionName: "tokenCount" }));
  const toks = await pub.readContract({ address: HOOD_FACTORY, abi: factoryAbi, functionName: "tokens", args: [0n, BigInt(cnt)] });
  const pools = [];
  for (const tok of toks) {
    const pool = await pub.readContract({ address: HOOD_FACTORY, abi: factoryAbi, functionName: "poolOf", args: [tok] });
    const grad = await pub.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }).catch(() => false);
    if (!grad) pools.push({ tok, pool });
  }
  if (pools.length === 0) { console.log("Нет токенов для торговли."); return; }

  // делаем сделки, пока не упрёмся в бюджет (net loss ≈ fees+gas)
  const startBal = await pub.getBalance({ address: funder.address });
  let trades = 0;
  const maxTrades = 12; // за один запуск, чтобы cron был коротким
  for (let i = 0; i < maxTrades && state.spentEth < budgetEth; i++) {
    const tr = traders[Math.floor(Math.random() * traders.length)];
    const { tok, pool } = pools[Math.floor(Math.random() * pools.length)];
    const doSell = Math.random() < 0.42; // «живой рынок»: 58% покупок / 42% продаж
    try {
      if (doSell) {
        const bal = await pub.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [tr.address] });
        if (bal > 1_000_000n * 10n ** 18n) {
          const part = BigInt(Math.floor(Number(bal) * rnd(0.25, 0.7)));
          let h = await W(tr).writeContract({ address: tok, abi: erc20Abi, functionName: "approve", args: [pool, part] });
          await pub.waitForTransactionReceipt({ hash: h });
          h = await W(tr).writeContract({ address: pool, abi: poolAbi, functionName: "sell", args: [part, 0n] });
          await pub.waitForTransactionReceipt({ hash: h });
          console.log(`  SELL ${tok.slice(0, 8)}…`); trades++;
        } else { continue; }
      } else {
        const eth = rnd(0.00008, 0.0005);
        const h = await W(tr).writeContract({
          address: pool, abi: poolAbi, functionName: "buy",
          args: [0n, tr.address], value: parseEther(eth.toFixed(6)),
        });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`  BUY  ${tok.slice(0, 8)}… ${eth.toFixed(5)} ETH`); trades++;
      }
      await sleep(rnd(800, 2500));
    } catch (e) { console.warn(`  ! ${(e.shortMessage || e.message).slice(0, 60)}`); }
  }
  // сколько реально «сгорело» за запуск (комиссии+газ+слиппедж относительно фандера
  // не считаем точно — фиксируем оценку по числу сделок)
  const endBal = await pub.getBalance({ address: funder.address });
  const burned = Math.max(0, Number(startBal - endBal) / 1e18);
  state.spentEth += burned + trades * 0.00002; // + небольшой запас на газ трейдеров
  save();
  console.log(`Сделок: ${trades}. Потрачено за день суммарно ~${state.spentEth.toFixed(5)} ETH ($${(state.spentEth * ETH_USD).toFixed(2)}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
