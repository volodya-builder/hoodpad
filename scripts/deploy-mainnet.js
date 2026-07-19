#!/usr/bin/env node
/**
 * БОЕВОЙ деплой лаунчпада hood в МЕЙННЕТ Robinhood Chain (chainId 4663).
 *
 * Раскладка комиссий: 50% создателю / 20% команде / 30% в казну выкупа,
 * реализована через FeeSplitter поверх BuybackTreasury.
 * Градуировавшие токены уходят в НАСТОЯЩИЙ пул Uniswap V3 (виден в GMGN).
 *
 * ⚠️  ВНИМАНИЕ: это мейннет. Реальные деньги. Перед запуском — аудит контрактов.
 *
 * Запуск:
 *   PRIVATE_KEY=0xВАШ_КЛЮЧ \
 *   RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/КЛЮЧ \
 *   TEAM_WALLET=0xадрес_кошелька_команды \
 *   node scripts/deploy-mainnet.js
 *
 * Не задан TEAM_WALLET → команда = деплойер. Лучше указать мультисиг.
 */
const fs = require("fs");
const path = require("path");

// Подтверждённые адреса Uniswap V3 в мейннете Robinhood Chain
// (вытащены из живого пула Pons; при желании переопределяются через env).
const MAINNET = {
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3", // NonfungiblePositionManager
  weth:            "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", // WETH
  factory:         "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA", // Uniswap V3 Factory (справочно)
};

// Модель комиссий 50/20/30
const FEE_BPS = 100;            // 1% с каждой сделки
const CREATOR_SHARE_BPS = 5000; // 50% — создателю токена
const TEAM_BPS_OF_REMAINDER = 4000; // из оставшихся 50%: 40% команде (=20% всего), 60% в казну (=30%)

async function main() {
  const { createPublicClient, createWalletClient, http } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Нужны переменные RPC_URL и PRIVATE_KEY");
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
  const TEAM_WALLET = process.env.TEAM_WALLET || account.address;

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

  console.log("=== БОЕВОЙ ДЕПЛОЙ hood → мейннет Robinhood Chain ===");
  console.log(`Деплойер:      ${account.address}`);
  console.log(`Команда (fee): ${TEAM_WALLET}`);
  console.log(`Uniswap V3 PM: ${POSITION_MANAGER}`);
  console.log(`WETH:          ${WETH}\n`);

  console.log("1/6 Мигратор (реальный Uniswap V3)…");
  const migrator = await deploy("UniswapV3Migrator", [POSITION_MANAGER, WETH]);

  console.log("2/6 Фабрика…");
  // treasury на старте = деплойер, поставим FeeSplitter через setConfig ниже
  const factory = await deploy("LaunchpadFactory", [account.address, migrator]);

  console.log("3/6 Казна выкупа…");
  const buyback = await deploy("BuybackTreasury", [factory]);

  console.log("4/6 FeeSplitter (50/20/30)…");
  const splitter = await deploy("FeeSplitter", [TEAM_WALLET, buyback, TEAM_BPS_OF_REMAINDER]);

  console.log("5/6 Голосование за выкуп…");
  const vote = await deploy("BuybackVote", []);

  console.log("6/6 Настройка фабрики (treasury=FeeSplitter, 1% fee, 50% создателю)…");
  await call(factory, "LaunchpadFactory", "setConfig", [splitter, migrator, FEE_BPS, CREATOR_SHARE_BPS]);

  console.log("\n=== ГОТОВО. Адреса для web/.env.production ===");
  const out = [
    `VITE_NETWORK=mainnet`,
    `VITE_FACTORY_ADDRESS=${factory}`,
    `VITE_TREASURY_ADDRESS=${buyback}`,
    `VITE_VOTE_ADDRESS=${vote}`,
    `# FeeSplitter (получатель комиссий платформы): ${splitter}`,
    `# Migrator (Uniswap V3): ${migrator}`,
  ].join("\n");
  console.log(out);
  fs.writeFileSync(path.join(__dirname, "..", "mainnet-addresses.txt"),
    out + `\n# team=${TEAM_WALLET}\n# deployed by ${account.address}\n`);
  console.log("\nСохранено в mainnet-addresses.txt");
  console.log("\nСледующие шаги: 1) верифицировать контракты в эксплорере,");
  console.log("2) прописать адреса в web/.env, пересобрать и задеплоить сайт с VITE_NETWORK=mainnet,");
  console.log("3) поднять Goldsky-субграф под мейннет, 4) перевести бота на мейннет.");
}

main().catch((e) => { console.error(e); process.exit(1); });
