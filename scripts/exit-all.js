#!/usr/bin/env node
/**
 * Полный выход из v1: продаёт ВСЕ позиции по всем токенам фабрики
 * (главный кошелёк + тестовые из scripts/sim-wallets.json), забирает
 * комиссии создателя из каждого пула и возвращает весь ETH на главный.
 *
 * Что вернуть нельзя (by design): доля комиссий, уже ушедшая в казну.
 *
 * Запуск (PowerShell):
 *   $env:PRIVATE_KEY="0x..."; $env:RPC_URL="https://rpc.mainnet.chain.robinhood.com"; node scripts/exit-all.js
 */
const fs = require("fs");
const path = require("path");
const { createPublicClient, createWalletClient, http, parseAbi, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY || "0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9";

const factoryAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256,uint256) view returns (address[])",
  "function poolOf(address) view returns (address)",
]);
const poolAbi = parseAbi([
  "function graduated() view returns (bool)",
  "function creator() view returns (address)",
  "function creatorFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(address to)",
  "function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

async function main() {
  let PK = (process.env.PRIVATE_KEY || "").replace(/["'\s]/g, "");
  if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
  if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Задай PRIVATE_KEY"); process.exit(1); }

  const transport = http(RPC_URL);
  const pub = createPublicClient({ transport });
  const chainId = await pub.getChainId();
  const chain = { id: chainId, name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } } };
  const main_ = privateKeyToAccount(PK);
  const W = (a) => createWalletClient({ account: a, chain, transport });

  // кошельки: главный + тестовые
  const wallets = [main_];
  try {
    const keys = JSON.parse(fs.readFileSync(path.join(__dirname, "sim-wallets.json"), "utf8"));
    for (const k of keys) wallets.push(privateKeyToAccount(k));
  } catch (e) { console.log("(sim-wallets.json не найден — только главный кошелёк)"); }

  const startBal = await pub.getBalance({ address: main_.address });
  console.log(`Главный: ${main_.address} · ${formatEther(startBal)} ETH · кошельков всего: ${wallets.length}`);

  // токены фабрики
  const count = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenCount" });
  const toks = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokens", args: [0n, count] });
  console.log(`Токенов на фабрике: ${toks.length}\n`);

  for (const tok of toks) {
    const pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [tok] });
    const grad = await pub.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }).catch(() => false);
    if (grad) { console.log(`${tok.slice(0, 8)}… градуировал — кривая закрыта, пропуск`); continue; }

    // продажи со всех кошельков
    for (const w of wallets) {
      const bal = await pub.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [w.address] }).catch(() => 0n);
      if (bal < 10n ** 18n) continue; // меньше 1 токена — пыль
      try {
        let h = await W(w).writeContract({ address: tok, abi: erc20Abi, functionName: "approve", args: [pool, bal] });
        await pub.waitForTransactionReceipt({ hash: h });
        h = await W(w).writeContract({ address: pool, abi: poolAbi, functionName: "sell", args: [bal, 0n] });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`SELL ${tok.slice(0, 8)}… ${w.address.slice(0, 8)}… ${(Number(bal) / 1e18 / 1e6).toFixed(2)}M токенов ✓`);
      } catch (e) { console.error(`  ошибка продажи ${tok.slice(0, 8)}: ${(e.shortMessage || e.message).slice(0, 70)}`); }
    }

    // комиссии создателя (если создатель — главный)
    try {
      const creator = await pub.readContract({ address: pool, abi: poolAbi, functionName: "creator" });
      if (creator.toLowerCase() === main_.address.toLowerCase()) {
        const fees = await pub.readContract({ address: pool, abi: poolAbi, functionName: "creatorFeesAccrued" });
        if (fees > 0n) {
          const h = await W(main_).writeContract({ address: pool, abi: poolAbi, functionName: "claimCreatorFees", args: [main_.address] });
          await pub.waitForTransactionReceipt({ hash: h });
          console.log(`CLAIM ${tok.slice(0, 8)}… комиссии создателя +${formatEther(fees)} ETH ✓`);
        }
      }
    } catch (e) { /* ok */ }
  }

  // сгоняем ETH тестовых кошельков на главный
  console.log("");
  for (const w of wallets.slice(1)) {
    const bal = await pub.getBalance({ address: w.address });
    const gasPrice = await pub.getGasPrice();
    const gas = 21000n * gasPrice * 2n;
    if (bal <= gas) { console.log(`${w.address.slice(0, 10)}…: пусто`); continue; }
    const h = await W(w).sendTransaction({ to: main_.address, value: bal - gas });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`RETURN ${w.address.slice(0, 10)}… → главный: ${formatEther(bal - gas)} ETH ✓`);
  }

  const endBal = await pub.getBalance({ address: main_.address });
  console.log(`\nИтог: на главном кошельке ${formatEther(endBal)} ETH (было ${formatEther(startBal)}).`);
  console.log("В казне останется её доля комиссий — вывести её нельзя по коду (так и задумано).");
}

main().catch((e) => { console.error(e); process.exit(1); });
