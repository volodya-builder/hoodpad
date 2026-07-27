#!/usr/bin/env node
/**
 * Передаёт владение КАЗНОЙ (BuybackTreasuryV2) кошельку ИИ-казначея.
 * Зачем: выкупы (арена/голосование/гранд) может исполнять только owner казны.
 * Класть ключ ГЛАВНОГО кошелька в GitHub нельзя, поэтому казной владеет
 * отдельный кошелёк-казначей. Даже при утечке его ключа деньги казны
 * украсть нельзя (вывода нет by design), фабрика остаётся у главного.
 *
 * Запуск (ключ ТЕКУЩЕГО владельца казны — из deploy-config.json или env):
 *   node scripts/transfer-treasury-owner.js 0xАДРЕС_КАЗНАЧЕЯ
 */
const fs = require("fs");
const path = require("path");

const TREASURY = process.env.TREASURY || "0xb45661df6625decdc697dd2fa0556c2637ea063a";

async function main() {
  const { createPublicClient, createWalletClient, http, parseAbi } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  const newOwner = (process.argv[2] || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(newOwner)) {
    console.error("Использование: node scripts/transfer-treasury-owner.js 0xАДРЕС_НОВОГО_ВЛАДЕЛЬЦА");
    process.exit(1);
  }

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) {}
  const RPC_URL = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  let PK = String(process.env.PRIVATE_KEY || cfg.privateKey || "").replace(/["'\s]/g, "");
  if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
  if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) {
    console.error("Нет ключа владельца: заполни deploy-config.json (privateKey) или задай PRIVATE_KEY.");
    process.exit(1);
  }

  const account = privateKeyToAccount(PK);
  const transport = http(RPC_URL);
  const chainId = await createPublicClient({ transport }).getChainId();
  const chain = { id: chainId, name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } } };
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  const abi = parseAbi([
    "function owner() view returns (address)",
    "function transferOwnership(address newOwner)",
  ]);
  const cur = await pub.readContract({ address: TREASURY, abi, functionName: "owner" });
  console.log(`Казна:          ${TREASURY}`);
  console.log(`Владелец сейчас: ${cur}`);
  console.log(`Новый владелец:  ${newOwner}`);
  if (cur.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Ключ не от владельца (ключ даёт ${account.address}).`);
    process.exit(1);
  }
  const hash = await wallet.writeContract({ address: TREASURY, abi, functionName: "transferOwnership", args: [newOwner] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`transferOwnership: ${rc.status} ${hash}`);
  const now2 = await pub.readContract({ address: TREASURY, abi, functionName: "owner" });
  console.log(`Владелец теперь: ${now2}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
