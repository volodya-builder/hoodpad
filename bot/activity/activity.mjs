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
const PONS_RPC   = process.env.PONS_RPC || HOOD_RPC; // Pons живёт в том же мейннете
const PONS_FACTORIES = (process.env.PONS_FACTORIES ||
  "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB,0x0c37a24F5D23A486FA692d1500881d698B1F77a4")
  .split(",").map((s) => s.trim());
const SEED_N     = Number(process.env.SEED_N || 12);      // сколько топ-токенов скопировать
const WALLETS    = Number(process.env.WALLETS || 4);      // тестовых кошельков
const BUDGET_USD = Number(process.env.BUDGET_USD || 10);  // лимит трат в сутки, $
const ETH_USD    = Number(process.env.ETH_USD || 2000);   // грубый курс для лимита
const IMG_BUDGET = 120_000;

let PK = (process.env.ACTIVITY_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет ACTIVITY_PRIVATE_KEY"); process.exit(1); }

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [HOOD_RPC] } } });
const funder = privateKeyToAccount(PK);
const pub  = createPublicClient({ chain, transport: http(HOOD_RPC) });
const ponsPub = createPublicClient({ chain, transport: http(PONS_RPC) });
const W = (a) => createWalletClient({ account: a, chain, transport: http(HOOD_RPC) });

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

  // ---- 1) СИД токенов Pons (один раз) --------------------------------
  const already = Number(await pub.readContract({ address: HOOD_FACTORY, abi: factoryAbi, functionName: "tokenCount" }));
  if (!state.seeded && already < SEED_N) {
    console.log(`Сид: копирую топ-${SEED_N} токенов Pons…`);
    const cand = [];
    for (const F of PONS_FACTORIES) {
      try {
        const cnt = Number(await ponsPub.readContract({ address: F, abi: factoryAbi, functionName: "tokenCount" }));
        const addrs = await ponsPub.readContract({ address: F, abi: factoryAbi, functionName: "tokens", args: [0n, BigInt(Math.min(cnt, 200))] });
        for (const a of addrs) cand.push(a);
      } catch (e) { console.warn("Pons factory чтение:", F, e.shortMessage || e.message); }
    }
    // ранжируем по ETH в пуле (прокси капитализации)
    const ranked = [];
    for (const tok of cand) {
      try {
        const pool = await ponsPub.readContract({ address: F_of(tok), abi: factoryAbi, functionName: "poolOf", args: [tok] }).catch(() => null);
        let raised = 0n;
        if (pool) raised = await ponsPub.readContract({ address: pool, abi: poolAbi, functionName: "ethReserve" }).catch(() => 0n);
        ranked.push({ tok, raised });
      } catch (e) { /* skip */ }
    }
    ranked.sort((a, b) => (b.raised > a.raised ? 1 : -1));
    const top = ranked.slice(0, SEED_N);
    for (const { tok } of top) {
      const m = await readPons(tok);
      if (!m) continue;
      try {
        const uri = "data:application/json;base64," + Buffer.from(JSON.stringify({
          image: (m.meta.image || "").slice(0, IMG_BUDGET),
          description: m.meta.description || "",
          x: m.meta.x || "", telegram: m.meta.telegram || "", website: m.meta.website || "",
        }), "utf8").toString("base64");
        const h = await W(funder).writeContract({
          address: HOOD_FACTORY, abi: factoryAbi, functionName: "createToken",
          args: [m.name, m.symbol, uri, funder.address],
        });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`  + ${m.symbol.padEnd(6)} ${m.name}`);
        await sleep(1200);
      } catch (e) { console.warn(`  ! ${m.symbol}: ${(e.shortMessage || e.message).slice(0, 60)}`); }
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

  function F_of(tok) { return PONS_FACTORIES[0]; } // poolOf есть на обеих; берём первую
}

// какая фабрика Pons владеет токеном (для poolOf) — пробуем обе
async function readPons(addr) {
  try {
    const [name, symbol] = await Promise.all([
      ponsPub.readContract({ address: addr, abi: metaAbi, functionName: "name" }),
      ponsPub.readContract({ address: addr, abi: metaAbi, functionName: "symbol" }),
    ]);
    const meta = {};
    try { meta.image = await ponsPub.readContract({ address: addr, abi: metaAbi, functionName: "logo" }); } catch (e) {}
    try { meta.description = await ponsPub.readContract({ address: addr, abi: metaAbi, functionName: "description" }); } catch (e) {}
    try {
      const [tw, tg, , web] = await ponsPub.readContract({ address: addr, abi: metaAbi, functionName: "socials" });
      meta.x = tw; meta.telegram = tg; meta.website = web;
    } catch (e) {}
    return { name, symbol, meta };
  } catch (e) { return null; }
}

main().catch((e) => { console.error(e); process.exit(1); });
