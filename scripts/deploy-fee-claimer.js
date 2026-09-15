#!/usr/bin/env node
/**
 * FeeClaimer — сбор комиссий протокола со всех пулов одной транзакцией.
 *   node scripts/deploy-fee-claimer.js            # сухой прогон
 *   node scripts/deploy-fee-claimer.js --deploy   # деплой (ключ из scripts/deploy-config.json)
 * После деплоя адрес — в web/src/lib/config.js: FEE_CLAIMER_ADDRESS.
 * Контракт без владельца и без денег: только вызывает claimProtocolFees() у пулов.
 */
const fs = require("fs");
const path = require("path");
const CFG = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) { return {}; } })();
const RPC = process.env.RPC_URL || CFG.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";

async function main() {
  const { createPublicClient, createWalletClient, http, formatEther } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const doDeploy = process.argv.includes("--deploy");
  const art = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", "FeeClaimer.json"), "utf8"));
  let pk = process.env.PRIVATE_KEY || CFG.privateKey;
  if (!pk && doDeploy) { console.error("Нет ключа: scripts/deploy-config.json (privateKey) или PRIVATE_KEY."); process.exit(1); }
  if (!pk) pk = "0x" + "1".padStart(64, "0");
  pk = String(pk).replace(/["'\s]/g, ""); if (!pk.startsWith("0x")) pk = "0x" + pk;
  const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  console.log("Кошелёк", doDeploy ? account.address : "(сухой прогон)", "· байткод", (art.bytecode.length / 2).toFixed(0), "байт");
  if (doDeploy) console.log("Баланс", formatEther(await pub.getBalance({ address: account.address })), "ETH");
  if (!doDeploy) { console.log("План: деплой FeeClaimer (без владельца, без параметров). Добавь --deploy."); return; }
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [] });
  console.log("FeeClaimer →", hash);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log("FeeClaimer =", r.contractAddress);
  console.log("\nЗаписать в web/src/lib/config.js: FEE_CLAIMER_ADDRESS =", r.contractAddress);
}
main().catch((e) => { console.error(e); process.exit(1); });
