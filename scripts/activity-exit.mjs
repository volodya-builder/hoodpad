#!/usr/bin/env node
// Вернуть деньги с кошельков бота активности (bot/activity) на главный кошелёк.
//
// Кошельки бота выводятся из ACTIVITY_PRIVATE_KEY детерминированно
// (keccak256(PK + ":hood-trader:" + i)), поэтому ничего хранить не надо:
// скрипт продаёт все их позиции по монетам ETH-фабрики (пулы не градуировали)
// и переводит ETH обратно на кошелёк-фандер (адрес ключа) — или на TO.
//
//   ACTIVITY_PRIVATE_KEY=… node scripts/activity-exit.mjs           # сухой прогон
//   ACTIVITY_PRIVATE_KEY=… node scripts/activity-exit.mjs --send    # продать и вернуть
//   Переменные: WALLETS (4), TO (куда слать ETH; по умолчанию — адрес ключа), RPC_URL
//
// Ключ в чат и в файлы репозитория не класть: только переменная окружения
// на машине владельца (тот же секрет, что в GitHub Actions).
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, keccak256, stringToHex, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.HOOD_FACTORY || "0x08a887196fc31b89305ae03aa991917f6b1d23ec";
const WALLETS = Number(process.env.WALLETS || 4);
const SEND = process.argv.includes("--send");
let PK = String(process.env.ACTIVITY_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нужен ACTIVITY_PRIVATE_KEY в окружении (66 символов)."); process.exit(1); }

const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const W = (a) => createWalletClient({ account: a, chain, transport: http(RPC) });
const funder = privateKeyToAccount(PK);
const TO = process.env.TO || funder.address;

const factoryAbi = parseAbi(["function tokenCount() view returns (uint256)", "function tokens(uint256,uint256) view returns (address[])", "function poolOf(address) view returns (address)"]);
const poolAbi = parseAbi(["function graduated() view returns (bool)", "function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function symbol() view returns (string)"]);

const traders = Array.from({ length: WALLETS }, (_, i) => privateKeyToAccount(keccak256(stringToHex(`${PK}:hood-trader:${i}`))));
console.log(`${SEND ? "БОЕВОЙ запуск" : "Сухой прогон"} · фандер ${funder.address} · ETH вернётся на ${TO}`);

const cnt = Number(await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenCount" }));
const toks = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokens", args: [0n, BigInt(cnt)] });
const pools = [];
for (const tok of toks) {
  const pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [tok] });
  const grad = await pub.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }).catch(() => true);
  const sym = await pub.readContract({ address: tok, abi: erc20Abi, functionName: "symbol" }).catch(() => "?");
  pools.push({ tok, pool, grad, sym });
}

let total = 0n;
for (const tr of traders) {
  console.log(`\nкошелёк ${tr.address}`);
  for (const p of pools) {
    const bal = await pub.readContract({ address: p.tok, abi: erc20Abi, functionName: "balanceOf", args: [tr.address] }).catch(() => 0n);
    if (bal === 0n) continue;
    if (p.grad) { console.log(`  $${p.sym}: ${formatEther(bal)} — пул градуировал, продавать на DEX руками`); continue; }
    console.log(`  $${p.sym}: продать ${formatEther(bal)}`);
    if (SEND) {
      try {
        let h = await W(tr).writeContract({ address: p.tok, abi: erc20Abi, functionName: "approve", args: [p.pool, bal] });
        await pub.waitForTransactionReceipt({ hash: h });
        h = await W(tr).writeContract({ address: p.pool, abi: poolAbi, functionName: "sell", args: [bal, 0n] });
        const rc = await pub.waitForTransactionReceipt({ hash: h });
        console.log(`    ${rc.status === "success" ? "✓" : "✗"} ${h}`);
      } catch (e) { console.log(`    ! ${(e.shortMessage || e.message).slice(0, 80)}`); }
    }
  }
  const eth = await pub.getBalance({ address: tr.address });
  total += eth;
  const gas = 21_000n * ((await pub.getGasPrice()) * 2n);
  const send = eth > gas ? eth - gas : 0n;
  console.log(`  ETH: ${formatEther(eth)} → вернуть ${formatEther(send)}`);
  if (SEND && send > 0n && tr.address.toLowerCase() !== TO.toLowerCase()) {
    try { const h = await W(tr).sendTransaction({ to: TO, value: send }); await pub.waitForTransactionReceipt({ hash: h }); console.log(`    ✓ ${h}`); }
    catch (e) { console.log(`    ! ${(e.shortMessage || e.message).slice(0, 80)}`); }
  }
}
console.log(`\nИтого ETH на кошельках бота до продаж: ${formatEther(total)}${SEND ? "" : " — сухой прогон, ничего не отправлено. Выполнить: --send"}`);
