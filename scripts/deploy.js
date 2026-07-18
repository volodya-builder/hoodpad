#!/usr/bin/env node
/**
 * Deploys the launchpad to Robinhood Chain (or any EVM chain).
 *
 * Usage:
 *   PRIVATE_KEY=0x... RPC_URL=https://rpc.testnet.chain.robinhood.com node scripts/deploy.js
 *
 * Optional env:
 *   TREASURY          - protocol fee recipient (default: deployer)
 *   POSITION_MANAGER  - Uniswap V3 NonfungiblePositionManager address
 *   WETH              - WETH9 address
 *     If both are set, the real UniswapV3Migrator is deployed.
 *     Otherwise a MockMigrator is deployed (fine for testnet experiments,
 *     NOT for production).
 */
const fs = require("fs");
const path = require("path");

async function main() {
  const { createPublicClient, createWalletClient, http } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY env var");
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(RPC_URL);
  const pub = createPublicClient({ transport });
  const chainId = await pub.getChainId();
  const chain = {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };
  const wallet = createWalletClient({ account, chain, transport });
  const pubc = createPublicClient({ chain, transport });

  const ART = (n) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));

  async function deploy(name, args = []) {
    const art = ART(name);
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rcpt = await pubc.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`${name} deploy failed`);
    console.log(`${name}: ${rcpt.contractAddress}`);
    return rcpt.contractAddress;
  }

  console.log(`Deployer: ${account.address}`);
  console.log(`Chain id: ${chainId}`);

  const treasury = process.env.TREASURY || account.address;

  let migrator;
  if (process.env.POSITION_MANAGER && process.env.WETH) {
    migrator = await deploy("UniswapV3Migrator", [
      process.env.POSITION_MANAGER,
      process.env.WETH,
    ]);
  } else {
    console.warn("POSITION_MANAGER/WETH not set -> deploying MockMigrator (testnet only!)");
    migrator = await deploy("MockMigrator");
  }

  const factory = await deploy("LaunchpadFactory", [treasury, migrator]);

  // Buyback treasury: 80% of fees flow here; ETH can only leave via buybacks.
  const buyback = await deploy("BuybackTreasury", [factory]);
  {
    const art = ART("LaunchpadFactory");
    const hash = await wallet.writeContract({
      address: factory,
      abi: art.abi,
      functionName: "setConfig",
      args: [buyback, migrator, 100, 2000], // 1% fee: 20% creator / 80% buyback
    });
    await pubc.waitForTransactionReceipt({ hash });
    console.log(`Factory wired: treasury=BuybackTreasury, split 20/80`);
  }

  console.log("\n--- next steps ---");
  console.log(`echo 'VITE_FACTORY_ADDRESS=${factory}' >> web/.env`);
  console.log(`echo 'VITE_NETWORK=${chainId === 4663 ? "mainnet" : chainId === 46630 ? "testnet" : "local"}' >> web/.env`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
