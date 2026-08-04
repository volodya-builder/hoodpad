#!/usr/bin/env node
/**
 * БОЕВОЙ деплой hood v2 в мейннет Robinhood Chain (chainId 4663).
 *
 * v2 = «голос за шкуру»:
 *   — комиссия 1%: 50% создателю / 20% команде / 30% в казну
 *   — сила голоса = уплаченные комиссии текущего 7-дневного раунда
 *   — выкуп победителя: 50% токенов голосовавшим за него, 50% сжигается
 *   — казна ведёт он-чейн портфель (задел под индекс $HOODX)
 *
 * ⚠️  Мейннет, реальные деньги. Slither прогнан; платный аудит — на совести владельца.
 *
 * Запуск (как v1):
 *   PRIVATE_KEY=... RPC_URL=... TEAM_WALLET=... node scripts/deploy-v2-mainnet.js
 *   или заполни scripts/deploy-config.json (privateKey, rpcUrl, teamWallet).
 */
const fs = require("fs");
const path = require("path");

const MAINNET = {
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  weth:            "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
};

// Модель комиссий: 50/20/30
const FEE_BPS = 100;             // 1% с каждой сделки
const CREATOR_SHARE_BPS = 5000;  // 50% — создателю
// из оставшихся 50%: 40% команде (=20% всего), 60% в казну (=30% всего)
const TEAM_BPS_OF_REMAINDER = 4000;

async function main() {
  const { createPublicClient, createWalletClient, http } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) {}
  const RPC_URL = process.env.RPC_URL || cfg.rpcUrl;
  let PRIVATE_KEY = process.env.PRIVATE_KEY || cfg.privateKey;
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Нет настроек: заполни deploy-config.json (privateKey, rpcUrl) или задай PRIVATE_KEY/RPC_URL.");
    process.exit(1);
  }
  PRIVATE_KEY = String(PRIVATE_KEY).replace(/["'\s]/g, "");
  if (!PRIVATE_KEY.startsWith("0x")) PRIVATE_KEY = "0x" + PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
    console.error(`Приватный ключ выглядит неверно: ${PRIVATE_KEY.length - 2} hex-символов вместо 64.`);
    process.exit(1);
  }
  const POSITION_MANAGER = process.env.POSITION_MANAGER || MAINNET.positionManager;
  const WETH = process.env.WETH || MAINNET.weth;

  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(RPC_URL);
  const chainId = await createPublicClient({ transport }).getChainId();
  // Защита от деплоя не в ту сеть (используется обёртками вроде deploy-v2-bsc.js)
  if (process.env.EXPECTED_CHAIN_ID && String(chainId) !== process.env.EXPECTED_CHAIN_ID) {
    console.error(`Не та сеть: RPC вернул chainId ${chainId}, ожидался ${process.env.EXPECTED_CHAIN_ID}.`);
    process.exit(1);
  }
  const chain = {
    id: chainId, name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });

  if (chainId !== 4663) {
    console.warn(`⚠ chainId = ${chainId} (ожидался 4663 — мейннет Robinhood). Точно та сеть?`);
  }
  const TEAM_WALLET = process.env.TEAM_WALLET || cfg.teamWallet || account.address;

  const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));
  async function deploy(name, args = []) {
    const art = ART(name);
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`${name} deploy failed`);
    console.log(`  ${name}: ${rcpt.contractAddress}`);
    return rcpt.contractAddress;
  }
  async function call(address, name, functionName, args) {
    const art = ART(name);
    const hash = await wallet.writeContract({ address, abi: art.abi, functionName, args });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    // БЕЗ этой проверки скрипт печатал «ГОТОВО» даже если настройка
    // зареверчена — и платформа уезжала в мейннет полунастроенной.
    if (rcpt.status !== "success") throw new Error(`${functionName} REVERTED: ${hash}`);
    return rcpt;
  }

  console.log("=== БОЕВОЙ ДЕПЛОЙ hood v2 → мейннет Robinhood Chain ===");
  console.log(`Деплойер:      ${account.address}`);
  console.log(`Команда (fee): ${TEAM_WALLET}`);
  console.log(`Uniswap V3 PM: ${POSITION_MANAGER}`);
  console.log(`WETH:          ${WETH}\n`);

  console.log("1/7 Мигратор (Uniswap V3)…");
  const migrator = await deploy("UniswapV3Migrator", [POSITION_MANAGER, WETH]);

  console.log("2/7 Фабрика v2…");
  const factory = await deploy("LaunchpadFactoryV2", [account.address, migrator]);

  console.log("3/7 Казна выкупа v2…");
  const treasury = await deploy("BuybackTreasuryV2", [factory]);

  console.log("4/7 VotePower (голос за шкуру)…");
  // Порог голосования: сила = комиссии (1% объёма); 0.0025 ETH ≈ $500 объёма.
  // Меняется без передеплоя: votePower.setMinPower(...) от деплойера.
  const MIN_POWER = process.env.MIN_POWER || "2500000000000000"; // 0.0025 ETH в wei
  const votePower = await deploy("VotePower", [factory, treasury, BigInt(MIN_POWER)]);

  console.log("5/7 Казна ← VotePower, мигратор ← казна…");
  await call(treasury, "BuybackTreasuryV2", "setVotePower", [votePower]);
  // излишки миграции уходят в казну выкупа, а не создателю
  await call(migrator, "UniswapV3Migrator", "setDustSink", [treasury]);

  console.log("6/7 FeeSplitter (50/20/30)…");
  const splitter = await deploy("FeeSplitter", [TEAM_WALLET, treasury, TEAM_BPS_OF_REMAINDER]);

  console.log("7/7 Настройка фабрики (treasury=FeeSplitter, votePower, 1% fee, 50% создателю)…");
  // initConfig — разовая настройка без таймлока, пока в фабрике нет токенов.
  // Дальнейшие изменения только через proposeConfig + applyConfig (48ч).
  await call(factory, "LaunchpadFactoryV2", "initConfig",
    [splitter, migrator, votePower, FEE_BPS, CREATOR_SHARE_BPS]);

  // Контрольная сверка: читаем конфиг с фабрики и убеждаемся, что всё встало.
  console.log("\nПроверка конфигурации на цепи…");
  const fArt = ART("LaunchpadFactoryV2");
  const rd = (fn) => pub.readContract({ address: factory, abi: fArt.abi, functionName: fn });
  const [tOn, mOn, vOn, feeOn, shareOn] = await Promise.all([
    rd("treasury"), rd("migrator"), rd("votePower"), rd("feeBps"), rd("creatorFeeShareBps"),
  ]);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (!same(tOn, splitter) || !same(mOn, migrator) || !same(vOn, votePower)
      || Number(feeOn) !== FEE_BPS || Number(shareOn) !== CREATOR_SHARE_BPS) {
    console.error("❌ Конфигурация на цепи не совпадает с ожидаемой:", { tOn, mOn, vOn, feeOn, shareOn });
    process.exit(1);
  }
  console.log("✓ treasury/migrator/votePower и доли комиссий на месте");

  console.log("\n=== ГОТОВО. Адреса для web/.env.production ===");
  const out = [
    `VITE_NETWORK=mainnet`,
    `VITE_FACTORY_ADDRESS=${factory}`,
    `VITE_TREASURY_ADDRESS=${treasury}`,
    `VITE_VOTEPOWER_ADDRESS=${votePower}`,
    `# FeeSplitter (получатель комиссий платформы): ${splitter}`,
    `# Migrator (Uniswap V3): ${migrator}`,
  ].join("\n");
  console.log(out);
  fs.writeFileSync(path.join(__dirname, "..", "mainnet-v2-addresses.txt"),
    out + `\n# team=${TEAM_WALLET}\n# deployed by ${account.address}\n`);
  console.log("\nСохранено в mainnet-v2-addresses.txt");
  console.log("\nДальше: 1) верификация в Blockscout (make-verify-input.js),");
  console.log("2) адреса в web/src/lib/config.js + фронт v2, 3) сабграф v2 в Goldsky.");
}

main().catch((e) => { console.error(e); process.exit(1); });
