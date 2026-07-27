// ============================================================================
//  hood burst-trade — интенсивная торговая сессия «прямо сейчас».
//  ~15 минут активной торговли всеми токенами фабрики с нескольких кошельков
//  (те же детерминированные трейдеры, что у бота активности).
//
//  Чистый убыток = комиссии 1% + газ. Скрипт следит за лимитом MAX_LOSS_USD
//  и останавливается при его достижении или по таймеру.
//
//  Запуск (PowerShell):
//    $env:ACTIVITY_PRIVATE_KEY="0xКЛЮЧ_БОТА"; node scripts/burst-trade.mjs
//  Опции через env: MAX_LOSS_USD (30), MINUTES (15), WALLETS (6)
// ============================================================================
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther, defineChain,
  keccak256, stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.HOOD_FACTORY || "0x08a887196fc31b89305ae03aa991917f6b1d23ec";
const MAX_LOSS_USD = Number(process.env.MAX_LOSS_USD || 30);
const MINUTES = Number(process.env.MINUTES || 15);
const WALLETS = Number(process.env.WALLETS || 6);
const ETH_USD = Number(process.env.ETH_USD || 1860);

let PK = (process.env.ACTIVITY_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Задай ACTIVITY_PRIVATE_KEY (ключ кошелька hood bot)"); process.exit(1); }

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } } });
const funder = privateKeyToAccount(PK);
const pub = createPublicClient({ chain, transport: http(RPC) });
const W = (a) => createWalletClient({ account: a, chain, transport: http(RPC) });

const factoryAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256,uint256) view returns (address[])",
  "function poolOf(address) view returns (address)",
]);
const poolAbi = parseAbi([
  "function graduated() view returns (bool)",
  "function buy(uint256 minTokensOut, address to) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const deadline = Date.now() + MINUTES * 60_000;
  const maxLossEth = MAX_LOSS_USD / ETH_USD;

  // детерминированные трейдеры — те же, что у бота активности
  const traders = Array.from({ length: WALLETS }, (_, i) =>
    privateKeyToAccount(keccak256(stringToHex(`${PK}:hood-trader:${i}`))));

  const startFunder = await pub.getBalance({ address: funder.address });
  console.log(`Фандер ${funder.address}: ${formatEther(startFunder)} ETH`);
  console.log(`Лимит убытка: $${MAX_LOSS_USD} (~${maxLossEth.toFixed(5)} ETH) · ${MINUTES} мин · ${WALLETS} кошельков\n`);

  // раздаём оборотку
  const per = parseEther("0.0018");
  for (const tr of traders) {
    const bal = await pub.getBalance({ address: tr.address });
    if (bal < parseEther("0.001")) {
      const need = per - bal;
      const h = await W(funder).sendTransaction({ to: tr.address, value: need });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`fund ${tr.address.slice(0, 8)}… +${formatEther(need)} ETH`);
    }
  }

  // суммарный старт (фандер + трейдеры) — для честного подсчёта убытка
  const totalOf = async () => {
    let t = await pub.getBalance({ address: funder.address });
    for (const tr of traders) t += await pub.getBalance({ address: tr.address });
    return t;
  };
  const startTotal = await totalOf();

  // пулы
  const cnt = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenCount" });
  const toks = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokens", args: [0n, cnt] });
  const pools = [];
  for (const tok of toks) {
    const pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [tok] });
    const grad = await pub.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }).catch(() => true);
    if (!grad) pools.push({ tok, pool });
  }
  console.log(`Токенов в торговле: ${pools.length}\n`);

  let trades = 0, fails = 0;
  while (Date.now() < deadline) {
    // контроль убытка каждые 10 сделок
    if (trades % 10 === 0 && trades > 0) {
      const now = await totalOf();
      const lossEth = Number(formatEther(startTotal - now));
      console.log(`— сделок ${trades}, убыток ~$${(lossEth * ETH_USD).toFixed(2)} из $${MAX_LOSS_USD}`);
      if (lossEth >= maxLossEth) { console.log("Лимит убытка достигнут — стоп."); break; }
    }
    const tr = traders[Math.floor(Math.random() * traders.length)];
    const { tok, pool } = pools[Math.floor(Math.random() * pools.length)];
    const doSell = Math.random() < 0.45;
    try {
      if (doSell) {
        const bal = await pub.readContract({ address: tok, abi: erc20Abi, functionName: "balanceOf", args: [tr.address] });
        if (bal > 500_000n * 10n ** 18n) {
          const part = BigInt(Math.floor(Number(bal) * rnd(0.3, 0.8)));
          let h = await W(tr).writeContract({ address: tok, abi: erc20Abi, functionName: "approve", args: [pool, part] });
          await pub.waitForTransactionReceipt({ hash: h });
          h = await W(tr).writeContract({ address: pool, abi: poolAbi, functionName: "sell", args: [part, 0n] });
          await pub.waitForTransactionReceipt({ hash: h });
          console.log(`SELL ${tok.slice(0, 8)}… ${tr.address.slice(0, 8)}…`); trades++;
        }
      } else {
        const bal = await pub.getBalance({ address: tr.address });
        if (bal < parseEther("0.0004")) continue;
        const eth = rnd(0.00012, 0.0006);
        const h = await W(tr).writeContract({ address: pool, abi: poolAbi, functionName: "buy",
          args: [0n, tr.address], value: parseEther(eth.toFixed(6)) });
        await pub.waitForTransactionReceipt({ hash: h });
        console.log(`BUY  ${tok.slice(0, 8)}… ${tr.address.slice(0, 8)}… ${eth.toFixed(5)} ETH`); trades++;
      }
      await sleep(rnd(1500, 5000)); // живой ритм: сделка каждые 1.5-5 сек
    } catch (e) {
      fails++;
      if (fails % 5 === 0) console.warn(`! ${(e.shortMessage || e.message).slice(0, 60)}`);
      await sleep(1200);
    }
  }

  const endTotal = await totalOf();
  const lossEth = Number(formatEther(startTotal - endTotal));
  console.log(`\nИтог: сделок ${trades}, чистый убыток ~${lossEth.toFixed(6)} ETH (~$${(lossEth * ETH_USD).toFixed(2)}).`);
  console.log("Позиции остаются на трейдерах (графики живые); вернуть всё: node scripts/exit-all.js с этим же ключом.");
}

main().catch((e) => { console.error(e); process.exit(1); });
