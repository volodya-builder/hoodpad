#!/usr/bin/env node
/**
 * Симулятор торговли: создаёт несколько тестовых кошельков, раздаёт им ETH
 * и делает случайные мелкие сделки по всем токенам фабрики.
 *
 * Ключи тестовых кошельков сохраняются в scripts/sim-wallets.json (в .gitignore),
 * чтобы деньги можно было вернуть: RECLAIM=1 переводит остатки обратно.
 *
 * Запуск (PowerShell):
 *   $env:PRIVATE_KEY="0x..."; node scripts/trade-sim.js                # 3 кошелька × 0.004 ETH, ~30 сделок
 *   $env:TRADES="60"; $env:WALLETS="5"; node scripts/trade-sim.js      # плотнее
 *   $env:RECLAIM="1"; node scripts/trade-sim.js                        # вернуть остатки на главный кошелёк
 */
const fs = require("fs");
const path = require("path");
const { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");

const RPC_URL = process.env.RPC_URL || "https://robinhood-mainnet.g.alchemy.com/v2/Vs1nO3DOTOw64ThcZAuNf";
const FACTORY = process.env.FACTORY || "0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9";
const WALLETS = Number(process.env.WALLETS || 3);
const ETH_EACH = Number(process.env.ETH_EACH || 0.004);
const TRADES = Number(process.env.TRADES || 30);
const WFILE = path.join(__dirname, "sim-wallets.json");

const factoryAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256 offset, uint256 limit) view returns (address[])",
  "function poolOf(address) view returns (address)",
]);
const poolAbi = parseAbi([
  "function buy(uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256)",
  "function graduated() view returns (bool)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

async function main() {
  let PRIVATE_KEY = (process.env.PRIVATE_KEY || "").replace(/["'\s]/g, "");
  if (PRIVATE_KEY && !PRIVATE_KEY.startsWith("0x")) PRIVATE_KEY = "0x" + PRIVATE_KEY;

  const transport = http(RPC_URL);
  const pub = createPublicClient({ transport });
  const chainId = await pub.getChainId();
  const chain = { id: chainId, name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } } };
  const W = (account) => createWalletClient({ account, chain, transport });

  // ---- возврат остатков -------------------------------------------------
  if (process.env.RECLAIM) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) { console.error("Нужен PRIVATE_KEY (куда вернуть)"); process.exit(1); }
    const to = privateKeyToAccount(PRIVATE_KEY).address;
    const saved = JSON.parse(fs.readFileSync(WFILE, "utf8"));
    for (const pk of saved) {
      const acc = privateKeyToAccount(pk);
      const bal = await pub.getBalance({ address: acc.address });
      const gas = 30000n * (await pub.getGasPrice()) * 2n;
      if (bal <= gas) { console.log(`${acc.address}: пусто`); continue; }
      const hash = await W(acc).sendTransaction({ to, value: bal - gas });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`${acc.address}: вернул ${formatEther(bal - gas)} ETH`);
    }
    return;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) { console.error("Задай PRIVATE_KEY"); process.exit(1); }
  const funder = privateKeyToAccount(PRIVATE_KEY);
  console.log(`Сеть ${chainId} · фандер ${funder.address}`);

  // ---- кошельки ---------------------------------------------------------
  let keys = [];
  try { keys = JSON.parse(fs.readFileSync(WFILE, "utf8")); } catch (e) { /* нет файла */ }
  while (keys.length < WALLETS) keys.push(generatePrivateKey());
  fs.writeFileSync(WFILE, JSON.stringify(keys, null, 2));
  const traders = keys.slice(0, WALLETS).map((k) => privateKeyToAccount(k));
  console.log(`Кошельки-трейдеры (ключи в scripts/sim-wallets.json):`);
  for (const t of traders) {
    const bal = await pub.getBalance({ address: t.address });
    if (bal < parseEther(String(ETH_EACH / 2))) {
      const hash = await W(funder).sendTransaction({ to: t.address, value: parseEther(String(ETH_EACH)) });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`  ${t.address} ← ${ETH_EACH} ETH`);
    } else {
      console.log(`  ${t.address} (уже с балансом ${formatEther(bal)})`);
    }
  }

  // ---- токены -----------------------------------------------------------
  const count = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenCount" });
  const list = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokens", args: [0n, count] });
  const pools = [];
  for (const tok of list) {
    const pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [tok] });
    const grad = await pub.readContract({ address: pool, abi: poolAbi, functionName: "graduated" });
    if (!grad) pools.push({ tok, pool });
  }
  console.log(`\nТокенов в торговле: ${pools.length}. Делаю ${TRADES} случайных сделок…\n`);

  // ---- торговля ---------------------------------------------------------
  for (let i = 0; i < TRADES; i++) {
    const tr = traders[Math.floor(Math.random() * traders.length)];
    const { tok, pool } = pools[Math.floor(Math.random() * pools.length)];
    const doSell = Math.random() < 0.3; // 30% продаж, 70% покупок
    try {
      if (doSell) {
        const bal = await pub.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [tr.address] });
        if (bal > 1_000_000n * 10n ** 18n) {
          const part = BigInt(Math.floor(Number(bal) * rnd(0.2, 0.6)));
          let h = await W(tr).writeContract({ address: tok, abi: erc20Abi, functionName: "approve", args: [pool, part] });
          await pub.waitForTransactionReceipt({ hash: h });
          h = await W(tr).writeContract({ address: pool, abi: poolAbi, functionName: "sell", args: [part, 0n] });
          await pub.waitForTransactionReceipt({ hash: h });
          console.log(`${String(i + 1).padStart(2)}/${TRADES} SELL ${tok.slice(0, 8)}… от ${tr.address.slice(0, 8)}…`);
        } else { i--; continue; }
      } else {
        const eth = rnd(0.00005, 0.0004);
        const h = await W(tr).writeContract({
          address: pool, abi: poolAbi, functionName: "buy",
          args: [0n, tr.address], value: parseEther(eth.toFixed(6)),
        });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`${String(i + 1).padStart(2)}/${TRADES} BUY  ${tok.slice(0, 8)}… ${eth.toFixed(5)} ETH от ${tr.address.slice(0, 8)}…`);
      }
      await sleep(rnd(1000, 4000));
    } catch (e) {
      console.error(`${i + 1}/${TRADES} ошибка: ${(e.shortMessage || e.message).slice(0, 80)}`);
    }
  }
  console.log("\nГотово. Вернуть остатки: RECLAIM=1 + PRIVATE_KEY главного кошелька.");
}

main().catch((e) => { console.error(e); process.exit(1); });
