// ============================================================================
//  hood ИИ-казначей — автономный, прозрачный, экономный.
//
//  Что делает без участия человека:
//   1. sweep  — раз в день собирает несобранные комиссии пулов в казну
//               (claimProtocolFees), но ТОЛЬКО если накопилось выше порога —
//               иначе газ съест смысл. Максимальная эффективность.
//   2. settle — в конце недельного раунда голосования:
//               • читает победителя (сила голоса),
//               • публикует обоснование (голоса, объём, Trust, арена),
//               • выкупает победителя из казны и сжигает (buybackAndReward).
//
//  Экономия: газ тратится только когда есть что делать; выкуп раз в неделю
//  одной транзакцией. Отчёт пишется в bot/treasurer/reports/*.json — фронт
//  показывает «Почему казна выбрала X».
//
//  Запуск (GitHub Actions cron, ключ — секрет TREASURER_PRIVATE_KEY):
//     node bot/treasurer/treasurer.mjs
//
//  ⚠ Ключ казначея = owner казны. Держать ТОЛЬКО в GitHub Secret, не в файле.
// ============================================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient, createWalletClient, http, parseAbi, formatEther, defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ конфиг
const RPC_URL  = process.env.RPC_URL  || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY  = process.env.FACTORY  || "";      // LaunchpadFactoryV2
const TREASURY = process.env.TREASURY || "";      // BuybackTreasuryV2
const VOTEPOWER = process.env.VOTEPOWER || "";    // VotePower
const SUBGRAPH = process.env.SUBGRAPH ||
  "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/1.0.0/gn";
// пороги (в ETH), чтобы газ не съедал смысл
const SWEEP_MIN = Number(process.env.SWEEP_MIN || 0.002); // собирать, если у пула >= столько
const BUYBACK_MIN = Number(process.env.BUYBACK_MIN || 0.003); // выкуп, если в казне >= столько

let PK = (process.env.TREASURER_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет TREASURER_PRIVATE_KEY"); process.exit(1); }
if (!FACTORY || !TREASURY || !VOTEPOWER) { console.error("Задай FACTORY / TREASURY / VOTEPOWER (адреса v2)"); process.exit(1); }

const chainId = 4663;
const chain = defineChain({ id: chainId, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } } });
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

const factoryAbi = parseAbi([
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256,uint256) view returns (address[])",
  "function poolOf(address) view returns (address)",
]);
const poolAbi = parseAbi([
  "function protocolFeesAccrued() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function claimProtocolFees()",
]);
const vpAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function totalFor(uint256,address) view returns (uint256)",
]);
const treAbi = parseAbi([
  "function buybackAndReward(address,uint256,uint256,uint256) returns (uint256)",
  "function treasuryBalance() view returns (uint256)",
]);

const gql = (q) => fetch(SUBGRAPH, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) }).then((r) => r.json()).then((j) => j.data);

async function tx(fn, args, label) {
  const hash = await wallet.writeContract({ address: args.to, abi: args.abi, functionName: fn, args: args.a });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${rc.status} ${hash}`);
  return rc;
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  console.log(`hood ИИ-казначей · ${new Date().toISOString()} · ${account.address}`);

  // ---- список активных пулов
  const count = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenCount" });
  const toks = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokens", args: [0n, count] });
  const pools = [];
  for (const tok of toks) {
    const pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [tok] });
    pools.push({ tok, pool });
  }

  // ---- 1) SWEEP: собираем накопившиеся комиссии выше порога
  let swept = 0;
  for (const { pool } of pools) {
    const acc = await pub.readContract({ address: pool, abi: poolAbi, functionName: "protocolFeesAccrued" }).catch(() => 0n);
    if (Number(formatEther(acc)) >= SWEEP_MIN) {
      await tx("claimProtocolFees", { to: pool, abi: poolAbi, a: [] }, `sweep ${pool.slice(0, 8)} (+${formatEther(acc)} ETH)`);
      swept += Number(formatEther(acc));
    }
  }
  console.log(`Собрано в казну: ${swept.toFixed(6)} ETH`);

  // ---- 2) SETTLE: если только что закончился недельный раунд — выкуп победителя
  const EPOCH = 7 * 86400;
  const epochNow = Math.floor(now / EPOCH);
  const secsIntoEpoch = now % EPOCH;
  const justRolled = secsIntoEpoch < 26 * 3600; // окно ~сутки после старта нового раунда
  const settledFile = path.join(__dirname, "state.json");
  let settled = {};
  try { settled = JSON.parse(fs.readFileSync(settledFile, "utf8")); } catch (e) { /* нет */ }
  const finishedEpoch = epochNow - 1;

  if (justRolled && !settled[finishedEpoch]) {
    // победитель прошлого раунда = наибольшая totalFor
    let winner = null, winPower = 0n;
    for (const { tok } of pools) {
      const p = await pub.readContract({ address: VOTEPOWER, abi: vpAbi, functionName: "totalFor", args: [BigInt(finishedEpoch), tok] }).catch(() => 0n);
      if (p > winPower) { winPower = p; winner = tok; }
    }
    const bal = await pub.readContract({ address: TREASURY, abi: treAbi, functionName: "treasuryBalance" });

    if (winner && Number(formatEther(bal)) >= BUYBACK_MIN) {
      // обоснование для отчёта: голоса + объём недели из сабграфа
      const since = (epochNow - 1) * EPOCH;
      const d = await gql(`{ trades(first:1000, where:{timestamp_gt:"${since}"}){ pool ethAmount } }`).catch(() => ({ trades: [] }));
      const volByPool = {};
      for (const tr of d.trades || []) volByPool[tr.pool.toLowerCase()] = (volByPool[tr.pool.toLowerCase()] || 0) + Number(tr.ethAmount) / 1e18;
      const winPool = pools.find((p) => p.tok.toLowerCase() === winner.toLowerCase())?.pool;

      const report = {
        epoch: finishedEpoch,
        ts: Date.now(),
        winner,
        votePower: formatEther(winPower),
        weekVolumeEth: volByPool[(winPool || "").toLowerCase()] || 0,
        treasuryEth: formatEther(bal),
        reason: `Токен ${winner} победил в голосовании раунда #${finishedEpoch}: набрал ${formatEther(winPower)} ETH силы голоса (оплаченных комиссий). Казна выкупает его на ${formatEther(bal)} ETH и сжигает купленное — поддержка цены и дефляция.`,
      };
      const rc = await tx("buybackAndReward",
        { to: TREASURY, abi: treAbi, a: [winner, bal, 0n, BigInt(finishedEpoch)] },
        `BUYBACK+BURN ${winner.slice(0, 8)} на ${formatEther(bal)} ETH`);
      report.tx = rc.transactionHash;
      report.status = rc.status;

      const dir = path.join(__dirname, "reports");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `epoch-${finishedEpoch}.json`), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(report, null, 2));
      settled[finishedEpoch] = report.tx;
      fs.writeFileSync(settledFile, JSON.stringify(settled, null, 2));
      console.log("Отчёт записан:", report.reason);
    } else {
      console.log(`Выкуп пропущен: ${winner ? `казна ${formatEther(bal)} ETH < порога` : "нет победителя"}`);
    }
  } else {
    console.log(justRolled ? `Раунд #${finishedEpoch} уже обработан` : `Раунд ещё идёт (осталось ${Math.floor((EPOCH - secsIntoEpoch) / 3600)}ч)`);
  }
  console.log("Готово.");
}

main().catch((e) => { console.error(e); process.exit(1); });
