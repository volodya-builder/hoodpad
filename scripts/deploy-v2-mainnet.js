#!/usr/bin/env node
/**
 * БОЕВОЙ деплой hood v2 в мейннет Robinhood Chain (chainId 4663).
 *
 * v2 = «голос за шкуру»:
 *   — комиссия 1%: 40% создателю / 40% в казну выкупа / 20% команде
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

// Модель комиссий v2: 40/40/20
const FEE_BPS = 100;             // 1% с каждой сделки
const CREATOR_SHARE_BPS = 4000;  // 40% — создателю
// из оставшихся 60%: 1/3 команде (=20% всего), 2/3 в казну (=40% всего)
const TEAM_BPS_OF_REMAINDER = 3334;

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
    await pub.waitForTransactionReceipt({ hash });
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
  const votePower = await deploy("VotePower", [factory, treasury]);

  console.log("5/7 Казна ← VotePower…");
  await call(treasury, "BuybackTreasuryV2", "setVotePower", [votePower]);

  console.log("6/7 FeeSplitter (40/40/20)…");
  const splitter = await deploy("FeeSplitter", [TEAM_WALLET, treasury, TEAM_BPS_OF_REMAINDER]);

  console.log("7/7 Настройка фабрики (treasury=FeeSplitter, votePower, 1% fee, 40% создателю)…");
  await call(factory, "LaunchpadFactoryV2", "setConfig",
    [splitter, migrator, votePower, FEE_BPS, CREATOR_SHARE_BPS]);

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
