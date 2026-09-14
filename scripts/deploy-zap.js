#!/usr/bin/env node
/**
 * Деплой CurveZap — «купить и продать монету за ETH» для монет quote-фабрики.
 *
 * Что ставится: один контракт. Он берёт ETH покупателя, меняет на валюту
 * монеты через Uniswap V3 и покупает на кривой — в одной транзакции. Ничего
 * не хранит между транзакциями, владелец умеет только задавать маршруты.
 *
 * Маршруты — из зонда пулов 14.09.2026 (самые глубокие пулы):
 *   один хоп WETH→валюта: USDG/500, CBBTC/3000, TAO/10000, VIRTUAL/500,
 *     NVDA/500, AAPL/500, TSLA/3000, SPY/500, QQQ/3000, COIN/3000
 *   два хопа WETH→USDG/500→валюта: USDE/500, MSFT/3000
 *   без пулов вообще: LINK, PENDLE — маршрута нет, в форме не показываются.
 *   WETH — обмен не нужен.
 *
 * Запуск:
 *   node scripts/deploy-zap.js --dry-run      (ключ не нужен)
 *   node scripts/deploy-zap.js
 */
const fs = require("fs");
const path = require("path");

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const HOOD_QUOTE_FACTORY = "0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f";
const ZERO = "0x0000000000000000000000000000000000000000";

const ROUTES = [
  { sym: "USDG",   addr: USDG,                                         mid: ZERO, fee1: 500,   fee2: 0 },
  { sym: "USDE",   addr: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", mid: USDG, fee1: 500,   fee2: 500 },
  { sym: "CBBTC",  addr: "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4", mid: ZERO, fee1: 3000,  fee2: 0 },
  { sym: "TAO",    addr: "0xf3081494B87e8D5fb7960f066E931D1D0e6E3d67", mid: ZERO, fee1: 10000, fee2: 0 },
  { sym: "VIRTUAL",addr: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31", mid: ZERO, fee1: 500,   fee2: 0 },
  { sym: "NVDA",   addr: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", mid: ZERO, fee1: 500,   fee2: 0 },
  { sym: "AAPL",   addr: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", mid: ZERO, fee1: 500,   fee2: 0 },
  { sym: "TSLA",   addr: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", mid: ZERO, fee1: 3000,  fee2: 0 },
  { sym: "MSFT",   addr: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", mid: USDG, fee1: 500,   fee2: 3000 },
  { sym: "SPY",    addr: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", mid: ZERO, fee1: 500,   fee2: 0 },
  { sym: "QQQ",    addr: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", mid: ZERO, fee1: 3000,  fee2: 0 },
  { sym: "COIN",   addr: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", mid: ZERO, fee1: 3000,  fee2: 0 },
];

const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));

function loadCfg(dry) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) {}
  const rpc = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  let pk = process.env.PRIVATE_KEY || cfg.privateKey;
  if (dry && !pk) pk = "0x" + "1".repeat(64);
  if (!pk) { console.error("Нужен PRIVATE_KEY (scripts/deploy-config.json → privateKey)."); process.exit(1); }
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("Ключ не похож на приватный ключ"); process.exit(1); }
  return { rpc, pk };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  let art;
  try { art = ART("CurveZap"); } catch { console.error("Нет artifacts/CurveZap.json — сначала node scripts/compile.js"); process.exit(1); }
  const { createPublicClient, createWalletClient, http, defineChain } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { rpc, pk } = loadCfg(dry);
  const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  console.log(dry ? "Сухой прогон (ключ не нужен)" : `Кошелёк: ${account.address}`);

  // Проверяем, что каждый пул из маршрута реально есть и с ликвидностью —
  // иначе первая покупка сгорит газом.
  const v3Abi = [{ name: "getPool", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }];
  const poolAbi = [{ name: "liquidity", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] }];
  console.log("\nМаршруты:");
  let bad = 0;
  for (const r of ROUTES) {
    const hops = r.mid === ZERO ? [[WETH, r.addr, r.fee1]] : [[WETH, r.mid, r.fee1], [r.mid, r.addr, r.fee2]];
    let ok = true, desc = [];
    for (const [a, b, fee] of hops) {
      const pool = await pub.readContract({ address: V3_FACTORY, abi: v3Abi, functionName: "getPool", args: [a, b, fee] });
      const liq = pool === ZERO ? 0n : await pub.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }).catch(() => 0n);
      if (liq === 0n) ok = false;
      desc.push(`${fee}${liq === 0n ? "✗" : "✓"}`);
    }
    if (!ok) bad++;
    console.log(`  ${r.sym.padEnd(8)} ${r.mid === ZERO ? "WETH→" + r.sym : "WETH→USDG→" + r.sym}  тиры ${desc.join(" ")} ${ok ? "" : "❌ нет пула/ликвидности"}`);
  }
  if (bad) console.log(`\n⚠ Маршрутов с проблемой: ${bad}.`);
  if (dry) { console.log("\n--dry-run: ничего не деплою."); return; }
  if (bad) { console.error("❌ Есть маршруты без пула — останавливаюсь."); process.exit(1); }

  console.log("\n1/2 Деплой CurveZap…");
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [WETH, V3_FACTORY, HOOD_QUOTE_FACTORY] });
  const rec = await pub.waitForTransactionReceipt({ hash });
  const zap = rec.contractAddress;
  console.log("  CurveZap:", zap);

  console.log("\n2/2 Маршруты…");
  for (const r of ROUTES) {
    const h = await wallet.writeContract({ address: zap, abi: art.abi, functionName: "setRoute", args: [r.addr, r.mid, r.fee1, r.fee2, true] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log("  +", r.sym);
  }

  const out = `VITE_ZAP_ADDRESS=${zap}`;
  console.log("\n=== ГОТОВО. Адрес для фронта ===\n" + out);
  fs.writeFileSync(path.join(__dirname, "..", "zap-address.txt"), out + "\n");
  console.log("\nДальше: вписать адрес во фронт (web/src/lib/config.js) — покупка за ETH включится.");
}

main().catch((e) => { console.error(e); process.exit(1); });
