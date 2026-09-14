#!/usr/bin/env node
/**
 * Деплой RWA-лончпада: запуск токенов за токенизированные акции.
 *
 * Что ставится:
 *   UniswapV3MigratorQuote — переносит ликвидность в пул токен/акция при
 *       градации. Те же защиты, что в ETH-миграторе: сверка цены пула с
 *       расчётной (допуск 1%) и amount*Min = 90% вместо нулей. Отдельно
 *       важно: quote при выравнивании цены не тратится (_swapTokenIsZero).
 *   LaunchpadFactoryQuote — фабрика с белым списком валют. Что не внесено
 *       через setQuote, за то запустить токен нельзя.
 *
 * КАК СЧИТАЕТСЯ ПОРОГ ГРАДАЦИИ. Кривая — постоянное произведение, продаётся
 * 80% сапплая, поэтому собранное на кривой = 4 × virtualQuote. В ETH-версии
 * virtual = 1.625 → градация ровно 6.5 ETH. Значит для акции:
 *     virtualQuote = желаемый порог / 4
 * Порог задаётся в единицах токена акции (18 знаков), а не в долларах:
 * доллар плавает вместе с котировкой, и порог поедет вместе с ним.
 *
 * creatorBuyCap — сколько создатель может купить своего токена на старте.
 * Ноль = без ограничения (не рекомендуется), обычно ставят 5-10% от порога.
 *
 * Запуск:
 *   PRIVATE_KEY=... node scripts/deploy-quote.js --dry-run
 *   PRIVATE_KEY=... node scripts/deploy-quote.js
 */
const fs = require("fs");
const path = require("path");

const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";

// Белый список валют. target — сколько единиц валюты собирает кривая до
// градации; virtualQuote считается как target/4, кап создателя — десятая
// часть порога.
//
// ЗНАКИ У ВАЛЮТ РАЗНЫЕ, И ЭТО НЕ МЕЛОЧЬ. У USDG их 6, у CBBTC 8, у JOHN 9,
// у остальных 18. Раньше порог считался через parseEther, то есть всегда по
// 18 знаков: для USDG это дало бы порог в миллион раз выше задуманного —
// монета не выпустилась бы никогда, а деньги висели бы на кривой. Теперь
// знаки читаются с самой цепи и порог считается по ним (parseUnits ниже).
//
// ПОРОГИ. В ETH-версии градация — 6.5 ETH. Здесь пороги подобраны так, чтобы
// стоить примерно столько же по курсу на день сборки списка (6.5 ETH ≈
// $16 400). Курс уедет — пороги поедут вместе с ним; это правится вызовом
// setQuote, без передеплоя. Привязывать порог к доллару внутри контракта
// нельзя: это оракул, лишняя зависимость и лишняя поверхность для атаки.
const QUOTES = [
  // Крипта
  { sym: "WETH",  addr: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", target: "6.5",   cap: "0.65" },
  { sym: "USDG",  addr: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", target: "16000", cap: "1600" },
  { sym: "USDE",  addr: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", target: "16000", cap: "1600" },
  { sym: "CBBTC", addr: "0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4", target: "0.21",  cap: "0.021" },
  { sym: "LINK",  addr: "0x492641F648a4986844848E0beFE66D14817bCE34", target: "1400",  cap: "140" },
  { sym: "TAO",   addr: "0xf3081494B87e8D5fb7960f066E931D1D0e6E3d67", target: "69",    cap: "6.9" },
  { sym: "PENDLE",addr: "0x5E49E1f85813F2B65858860A3FA231b4186f2e0E", target: "7200",  cap: "720" },
  { sym: "VIRTUAL",addr:"0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31", target: "26000", cap: "2600" },
  // Акции
  { sym: "NVDA", addr: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", target: "40",   cap: "4" },
  { sym: "AAPL", addr: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", target: "40",   cap: "4" },
  { sym: "TSLA", addr: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", target: "40",   cap: "4" },
  { sym: "MSFT", addr: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", target: "20",   cap: "2" },
  { sym: "SPY",  addr: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", target: "10",   cap: "1" },
  { sym: "QQQ",  addr: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", target: "10",   cap: "1" },
  { sym: "COIN", addr: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", target: "20",   cap: "2" },
];

const ART = (n) => JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));

function loadCfg(dry) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) {}
  const rpc = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  const team = process.env.TEAM_WALLET || cfg.teamWallet;
  let pk = process.env.PRIVATE_KEY || cfg.privateKey;
  // Сухой прогон только читает цепь — ключ ему не нужен. Требовать ключ ради
  // проверки списка — значит приучать доставать его без надобности.
  if (dry && !pk) pk = "0x" + "1".repeat(64);
  if (!pk || !team) { console.error("Нужны PRIVATE_KEY и TEAM_WALLET."); process.exit(1); }
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("Ключ не похож на приватный ключ"); process.exit(1); }
  return { rpc, pk, team };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const { createPublicClient, createWalletClient, http, defineChain, parseUnits, formatUnits } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { rpc, pk, team } = loadCfg(dry);

  const chain = defineChain({
    id: 4663, name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  console.log(dry ? "Сухой прогон (ключ не нужен)" : `Кошелёк: ${account.address}`, "· казна комиссий:", team);

  // Знаки читаются с самой цепи, а не берутся из головы: порог в 6 знаках,
  // посчитанный как 18, — это порог в миллион раз выше, и монета не
  // выпустится никогда. Заодно это проверка, что по адресу вообще ERC20.
  console.log("\nЧитаю валюты на цепи…");
  const erc20 = [
    { name: "decimals", outputs: [{ type: "uint8" }], inputs: [], stateMutability: "view", type: "function" },
    { name: "symbol", outputs: [{ type: "string" }], inputs: [], stateMutability: "view", type: "function" },
  ];
  let bad = 0;
  for (const q of QUOTES) {
    try {
      const [dec, sym] = await Promise.all([
        pub.readContract({ address: q.addr, abi: erc20, functionName: "decimals" }),
        pub.readContract({ address: q.addr, abi: erc20, functionName: "symbol" }).catch(() => "?"),
      ]);
      q.dec = Number(dec);
      // Символ в списке — для человека; на цепи он может отличаться, и это
      // повод посмотреть, тот ли это адрес, а не молча продолжить.
      if (String(sym).toUpperCase() !== q.sym.toUpperCase()) {
        bad++;
        console.log(`  ${q.sym.padEnd(7)} ❌ на цепи символ «${sym}» — адрес не тот`);
        continue;
      }
      if (!(q.dec >= 0 && q.dec <= 36)) { bad++; console.log(`  ${q.sym.padEnd(7)} ❌ странные знаки: ${dec}`); continue; }
      console.log(`  ${q.sym.padEnd(7)} ✓ знаков ${String(q.dec).padStart(2)} · ${q.addr}`);
    } catch (e) {
      bad++;
      console.log(`  ${q.sym.padEnd(7)} ❌ контракт не отвечает: ${q.addr}`);
    }
  }

  console.log("\nПороги градации:");
  for (const q of QUOTES) {
    if (q.dec === undefined) continue;
    const target = parseUnits(q.target, q.dec);
    console.log(`  ${q.sym.padEnd(7)} порог ${String(q.target).padStart(7)} · virtual ${formatUnits(target / 4n, q.dec).padStart(9)} · кап создателя ${q.cap}`);
  }
  if (bad > 0) console.log(`\n⚠ Проблемных валют: ${bad}. Разберись до боевого прогона.`);
  if (dry) { console.log("\n--dry-run: ничего не деплою."); return; }
  if (bad > 0) { console.error("\n❌ Есть проблемные валюты — останавливаюсь."); process.exit(1); }

  const deploy = async (name, args) => {
    const art = ART(name);
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rec = await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${name}:`.padEnd(26), rec.contractAddress);
    return rec.contractAddress;
  };

  console.log("\n1/3 Деплой…");
  const migrator = await deploy("UniswapV3MigratorQuote", [POSITION_MANAGER]);
  const factory  = await deploy("LaunchpadFactoryQuote", [team, migrator]);

  console.log("\n2/3 Белый список валют…");
  const fAbi = ART("LaunchpadFactoryQuote").abi;
  for (const q of QUOTES) {
    const target = parseUnits(q.target, q.dec);
    const hash = await wallet.writeContract({
      address: factory, abi: fAbi, functionName: "setQuote",
      args: [q.addr, true, target / 4n, parseUnits(q.cap, q.dec)],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log("  +", q.sym);
  }

  console.log("\n3/3 Сверка…");
  const count = await pub.readContract({ address: factory, abi: fAbi, functionName: "allowedQuotesCount" });
  if (Number(count) !== QUOTES.length) {
    console.error("❌ В белом списке", Number(count), "валют вместо", QUOTES.length);
    process.exit(1);
  }
  console.log("  ✓ валют в белом списке:", Number(count));

  const out = [
    `VITE_QUOTE_FACTORY_ADDRESS=${factory}`,
    `# MigratorQuote: ${migrator}`,
  ].join("\n");
  console.log("\n=== ГОТОВО. Адреса для web/.env.production ===\n" + out);
  fs.writeFileSync(path.join(__dirname, "..", "quote-addresses.txt"),
    out + `\n# treasury=${team}\n# deployed by ${account.address} at ${new Date().toISOString()}\n`);
  console.log("\nСохранено в quote-addresses.txt");
  console.log("\nДальше:");
  console.log("  1) вписать адрес фабрики во фронт — форма запуска за акции разблокируется");
  console.log("  2) сабграф: добавить quote-фабрику, иначе RWA-токены не появятся в списках");
  console.log("  3) верификация в Blockscout");
}

main().catch((e) => { console.error(e); process.exit(1); });
