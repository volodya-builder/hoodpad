// ============================================================================
//  Бот выкупа монеты hood — тратит казну выкупа на монету платформы.
//
//  Экономика (перезапуск 09.2026): 10% каждой торговой комиссии приходит
//  в казну выкупа hood (ArenaTreasuryV3, отдельный контракт от казны арены).
//  РАЗ В ЧАС (решение владельца 17.09.2026) бот берёт ВСЁ, что накопилось в
//  ETH, покупает на это монету hood и сжигает купленное в той же транзакции:
//  пока монета на кривой — у кривой (buybackEth), после градации — на
//  Uniswap V3 (buybackDex). Вывода из казны нет по замыслу — она умеет
//  только выкупать и сжигать.
//
//  Состояние — в блокчейне: перед выкупом бот читает события Buyback казны
//  за последние дни и не повторяет час, у которого уже есть событие с
//  пометкой «hood <день> <час>». Повторный запуск безопасен.
//
//  Запуск (GitHub Actions, .github/workflows/buyback.yml — цикл раз в час):
//     node bot/buyback/buyback.mjs           # выкуп за этот час, если ещё не было
//     node bot/buyback/buyback.mjs --dry     # только показать, что бы сделал
//
//  Переменные: ARENA_PRIVATE_KEY (ключ оператора казны — тот же, что у
//  арены), BUYBACK_TREASURY (адрес казны выкупа), HOOD_TOKEN (адрес монеты
//  hood — переменная GitHub, задаётся после создания монеты). Необязательно:
//  FACTORY, RPC_URL, DUST_ETH, SLIPPAGE_BPS.
// ============================================================================
import {
  createPublicClient, createWalletClient, http, parseAbi, formatEther, defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { treasuryCanConvert, convertTreasuryToEth, treasuryAccess } from "../lib/to-eth.mjs";
import { getLogsSafe, DEPLOY_BLOCK, maxBig } from "../lib/logs.mjs";

const DRY = process.argv.includes("--dry");
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = (process.env.FACTORY || "0xad8af2b36ff1c5891322cb4c82d74bac54fd80fb").toLowerCase();
const TREASURY = (process.env.BUYBACK_TREASURY || "0x868b79a57f7e347e4ae35f68d467d1555cbffa25").toLowerCase();
const HOOD = (process.env.HOOD_TOKEN || "").toLowerCase();
const DUST_ETH = Number(process.env.DUST_ETH || 0.0003);       // меньше — не тратим газ, копим
const SLIPPAGE_BPS = BigInt(process.env.SLIPPAGE_BPS || 300);  // 3% от симуляции: анти-MEV
const LOOKBACK_DAYS = 3;
const SUBGRAPH = process.env.SUBGRAPH || "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/6.1.0/gn";

let PK = (process.env.ARENA_PRIVATE_KEY || process.env.TREASURER_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!DRY && !/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет ARENA_PRIVATE_KEY (ключ владельца казны)."); process.exit(1); }
if (!/^0x[0-9a-fA-F]{40}$/.test(HOOD)) { console.error("Нет HOOD_TOKEN (адрес монеты hood) — Settings → Variables."); process.exit(1); }
if (DRY && !/^0x[0-9a-fA-F]{64}$/.test(PK)) PK = "0x" + "1".padStart(64, "0");

const chain = defineChain({ id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } } });
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

const treasuryAbi = parseAbi([
  "function owner() view returns (address)",
  "function buybackEth(address token, uint256 ethAmount, uint256 minTokensOut, string note) returns (uint256)",
  "function buybackDex(address token, uint256 ethAmount, uint256 minTokensOut, string note) returns (uint256)",
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
]);
const factoryAbi = parseAbi(["function poolOf(address) view returns (address)"]);
const poolAbi = parseAbi(["function graduated() view returns (bool)"]);
const tokenAbi = parseAbi(["function symbol() view returns (string)"]);

/** Уже был выкуп с пометкой этого часа? */
async function alreadyPaid(hourKey) {
  const head = await pub.getBlockNumber();
  const hb = await pub.getBlock({ blockNumber: head });
  const old = await pub.getBlock({ blockNumber: head > 5000n ? head - 5000n : 0n });
  const secPerBlock = Math.max(0.05, (Number(hb.timestamp) - Number(old.timestamp)) / Number(head - old.number || 1n));
  const span = BigInt(Math.ceil((LOOKBACK_DAYS * 86400) / secPerBlock));
  const fromBlock = maxBig(DEPLOY_BLOCK, head > span ? head - span : 0n);
  const logs = await getLogsSafe(pub, { address: TREASURY, event: treasuryAbi.find((x) => x.type === "event"), fromBlock, toBlock: head, log: console.log });
  for (const l of logs) if ((l.args.note || "") === `hood ${hourKey}`) return true;
  return false;
}

async function main() {
  // ключ часа: «2026-09-18 01» — один выкуп в час, повтор в тот же час — холостой
  const hourKey = new Date().toISOString().slice(0, 13).replace("T", " ");
  console.log(`hood · бот выкупа hood · ${new Date().toISOString()} · кошелёк ${account.address}${DRY ? " · СУХОЙ ПРОГОН" : ""}`);

  // казна V2: выкупать может владелец или оператор (ключ бота); старая — только владелец
  const acc = await treasuryAccess(pub, TREASURY, account.address);
  if (!acc.owner) throw new Error(acc.why);
  if (!DRY && !acc.ok) { console.error(acc.why); process.exit(1); }

  const pool = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "poolOf", args: [HOOD] });
  if (!pool || /^0x0{40}$/.test(pool)) { console.error(`Монета ${HOOD} не найдена в фабрике ${FACTORY}.`); process.exit(1); }
  const symbol = await pub.readContract({ address: HOOD, abi: tokenAbi, functionName: "symbol" }).catch(() => "HOOD");
  const graduated = await pub.readContract({ address: pool, abi: poolAbi, functionName: "graduated" });

  // Казна V2 копит в ETH: сперва вся валюта (GME, USDG…) → ETH, потом выкуп hood за ETH
  if (await treasuryCanConvert(pub, TREASURY)) {
    let assets = [];
    try {
      const d = await fetch(SUBGRAPH, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ trades(first: 1000, orderBy: timestamp, orderDirection: desc) { quote } }" }) }).then((r) => r.json());
      assets = [...new Set((d?.data?.trades || []).map((t) => t.quote).filter(Boolean))];
    } catch (e) { /* без индексатора — менять нечего */ }
    console.log(`Казна V2 · валюта → ETH (${assets.length} актив.)…`);
    await convertTreasuryToEth(pub, wallet, TREASURY, assets, { dry: DRY });
  }
  const bal = await pub.getBalance({ address: TREASURY });
  const balEth = Number(formatEther(bal));
  console.log(`Казна выкупа: ${balEth.toFixed(6)} ETH · монета $${symbol} ${HOOD}${graduated ? " · градуировала — покупаем на Uniswap" : " · на кривой"}`);

  if (balEth < DUST_ETH) { console.log("Фонд — пыль, копим дальше."); return; }
  if (await alreadyPaid(hourKey)) { console.log(`Выкуп за час ${hourKey} уже был.`); return; }

  // до градации — у кривой, после — на Uniswap V3 через казну (buybackDex)
  const fn = graduated ? "buybackDex" : "buybackEth";
  const note = `hood ${hourKey}`;
  let expected;
  try {
    const sim = await pub.simulateContract({ account, address: TREASURY, abi: treasuryAbi, functionName: fn, args: [HOOD, bal, 0n, note] });
    expected = sim.result;
  } catch (e) {
    console.error(`Симуляция выкупа (${fn}) не прошла — ${e.shortMessage || e.message}`); process.exit(DRY ? 0 : 3);
  }
  const minOut = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
  console.log(`Выкуп ${fn === "buybackDex" ? "на DEX" : "с кривой"}: ${balEth.toFixed(6)} ETH → ≈${(Number(expected) / 1e18).toFixed(0)} $${symbol}, сжигаем${DRY ? " (сухо)" : ""}`);
  if (DRY) return;
  const hash = await wallet.writeContract({ address: TREASURY, abi: treasuryAbi, functionName: fn, args: [HOOD, bal, minOut, note] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${rc.status} ${hash}`);
  if (rc.status !== "success") { console.error("Выкуп не прошёл — остаток ждёт следующего часа."); process.exit(3); }
  console.log("Готово.");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
