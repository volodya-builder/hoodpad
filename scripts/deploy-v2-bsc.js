#!/usr/bin/env node
/**
 * Деплой hood v2 в BNB Smart Chain (chainId 56).
 *
 * Тонкая обёртка над deploy-v2-mainnet.js: подставляет официальные адреса
 * Uniswap V3 на BSC (docs.uniswap.org → BNB deployments) и BSC RPC,
 * дальше работает та же проверенная логика деплоя с самопроверкой конфига.
 *
 * ⚠️  Экономика курвы задана константами в LaunchpadFactoryV2.sol:
 *     VIRTUAL_ETH = 1.625 → градация на 6.5 нативной монеты.
 *     В мейннете Robinhood это 6.5 ETH (~$25k), на BSC это 6.5 BNB (~$5k).
 *     Более низкий порог градации для BSC-мемов — скорее плюс (быстрее цикл),
 *     но если нужен другой порог — поменяй константу в контракте ДО деплоя
 *     и перекомпилируй (npm run compile).
 *
 * Запуск:
 *   PRIVATE_KEY=... TEAM_WALLET=... node scripts/deploy-v2-bsc.js
 *   (RPC можно переопределить: RPC_URL=https://... )
 *
 * Тестовый прогон в testnet BSC (chainId 97):
 *   BSC_TESTNET=1 PRIVATE_KEY=... TEAM_WALLET=... node scripts/deploy-v2-bsc.js
 *   ⚠️ в testnet НЕТ официального Uniswap V3 — задай POSITION_MANAGER/WETH сам
 *   (например, адреса Pancake V3 testnet) или деплой только для смоук-теста фабрики.
 */

const TESTNET = !!process.env.BSC_TESTNET;

// Официальные адреса Uniswap V3 на BNB Chain (проверено по docs.uniswap.org,
// раздел BNB Deployments) + канонический WBNB.
const BSC = {
  positionManager: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
  weth:            "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
  rpc:             "https://bsc-dataseed.binance.org",
  chainId:         56,
};
const BSC_TEST = {
  rpc:     "https://data-seed-prebsc-1-s1.binance.org:8545",
  chainId: 97,
};

const net = TESTNET ? BSC_TEST : BSC;

process.env.RPC_URL = process.env.RPC_URL || net.rpc;
if (!TESTNET) {
  process.env.POSITION_MANAGER = process.env.POSITION_MANAGER || BSC.positionManager;
  process.env.WETH = process.env.WETH || BSC.weth;
} else if (!process.env.POSITION_MANAGER || !process.env.WETH) {
  console.error("BSC testnet: задай POSITION_MANAGER и WETH (официального Uniswap V3 в testnet нет).");
  process.exit(1);
}

process.env.EXPECTED_CHAIN_ID = String(net.chainId);
console.log(`>>> hood v2 -> BNB Smart Chain ${TESTNET ? "TESTNET (97)" : "(56)"}`);
console.log(`>>> RPC: ${process.env.RPC_URL}`);
console.log(`>>> PositionManager: ${process.env.POSITION_MANAGER}`);
console.log(`>>> WBNB: ${process.env.WETH}\n`);

require("./deploy-v2-mainnet.js");
