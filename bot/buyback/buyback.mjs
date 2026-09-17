// ============================================================================
//  Бот выкупа монеты hood — тратит казну выкупа на монету платформы.
//
//  Экономика (перезапуск 16.09.2026): 10% каждой торговой комиссии приходит
//  в казну выкупа hood (ArenaTreasury, отдельный контракт от казны арены).
//  Раз в сутки бот берёт ВСЁ, что накопилось в ETH, покупает на это монету
//  hood с кривой и сжигает купленное в той же транзакции. Вывода из казны
//  нет по замыслу — она умеет только выкупать и сжигать.
//
//  Состояние — в блокчейне: перед выкупом бот читает события Buyback казны
//  за последние дни и не повторяет день, у которого уже есть событие с
//  пометкой «hood <день>». Повторный запуск безопасен.
//
//  Запуск (GitHub Actions, .github/workflows/buyback.yml):
//     node bot/buyback/buyback.mjs           # выкуп за сегодня, если ещё не было
//     node bot/buyback/buyback.mjs --dry     # только показать, что бы сделал
//
//  Переменные: ARENA_PRIVATE_KEY (ключ владельца казны — тот же, что у
//  арены), BUYBACK_TREASURY (адрес казны выкупа), HOOD_TOKEN (адрес монеты
//  hood — переменная GitHub, задаётся после создания монеты). Необязательно:
//  FACTORY, RPC_URL, DUST_ETH, SLIPPAGE_BPS.
//
//  Пока монета на кривой, выкуп идёт напрямую у пула (buybackEth). После
//  градации кривая закрыта: казна ещё не умеет покупать на Uniswap — бот
//  пишет предупреждение и копит дальше (следующий шаг: маршрут через
//  Uniswap в ArenaTreasury).
// ============================================================================
import {
  createPublicClient, createWalletClient, http, parseAbi, formatEther, defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { treasuryCanConvert, convertTreasuryToEth, treasuryAccess } from "../lib/to-eth.mjs";

const DRY = process.argv.includes("--dry");
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = (process.env.FACTORY || "0xe16ccf7c12ce0256473fff60a1c3f18def64f861").toLowerCase();
const TREASURY = (process.env.BUYBACK_TREASURY || "0x7800ef8dbef42ffbce7573291d6e1fe4828b5936").toLowerCase();
const HOOD = (process.env.HOOD_TOKEN || "").toLowerCase();
const DUST_ETH = Number(process.env.DUST_ETH || 0.0003);       // меньше — не тратим газ, копим
const SLIPPAGE_BPS = BigInt(process.env.SLIPPAGE_BPS || 300);  // 3% от симуляции: анти-MEV
const LOOKBACK_DAYS = 3;
const SUBGRAPH = process.env.SUBGRAPH || "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/5.0.0/gn";

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
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
]);
const factoryAbi = parseAbi(["function poolOf(address) view returns (address)"]);
const poolAbi = parseAbi(["function graduated() view returns (bool)"]);
const tokenAbi = parseAbi(["function symbol() view returns (string)"]);

/** Уже был выкуп с пометкой этого дня? */
async function alreadyPaid(dayKey) {
  const head = await pub.getBlockNumber();
  const hb = await pub.getBlock({ blockNumber: head });
  const old = await pub.getBlock({ blockNumber: head > 5000n ? head - 5000n : 0n });
  const secPerBlock = Math.max(0.05, (Number(hb.timestamp) - Number(old.timestamp)) / Number(head - old.number || 1n));
  const span = BigInt(Math.ceil((LOOKBACK_DAYS * 86400) / secPerBlock));
  const fromBlock = head > span ? head - span : 0n;
  const STEP = 50_000n;
  for (let from = fromBlock; from <= head; from += STEP + 1n) {
    const to = from + STEP > head ? head : from + STEP;
    const logs = await pub.getLogs({ address: TREASURY, event: treasuryAbi.find((x) => x.type === "event"), fromBlock: from, toBlock: to });
    for (const l of logs) if ((l.args.note || "") === `hood ${dayKey}`) return true;
  }
  return false;
}

async function main() {
  const dayKey = new Date().toISOString().slice(0, 10);
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
  console.log(`Казна выкупа: ${balEth.toFixed(6)} ETH · монета $${symbol} ${HOOD}${graduated ? " · ГРАДУИРОВАЛА" : " · на кривой"}`);

  if (graduated) {
    console.warn("⚠ Монета градуировала — кривая закрыта, казна пока не умеет покупать на Uniswap. Копим.");
    return;
  }
  if (balEth < DUST_ETH) { console.log("Фонд — пыль, копим дальше."); return; }
  if (await alreadyPaid(dayKey)) { console.log(`Выкуп за ${dayKey} уже был.`); return; }

  const note = `hood ${dayKey}`;
  let expected;
  try {
    const sim = await pub.simulateContract({ account, address: TREASURY, abi: treasuryAbi, functionName: "buybackEth", args: [HOOD, bal, 0n, note] });
    expected = sim.result;
  } catch (e) {
    console.error(`Симуляция выкупа не прошла — ${e.shortMessage || e.message}`); process.exit(DRY ? 0 : 3);
  }
  const minOut = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
  console.log(`Выкуп: ${balEth.toFixed(6)} ETH → ≈${(Number(expected) / 1e18).toFixed(0)} $${symbol}, сжигаем${DRY ? " (сухо)" : ""}`);
  if (DRY) return;
  const hash = await wallet.writeContract({ address: TREASURY, abi: treasuryAbi, functionName: "buybackEth", args: [HOOD, bal, minOut, note] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${rc.status} ${hash}`);
  if (rc.status !== "success") { console.error("Выкуп не прошёл — остаток ждёт следующего запуска."); process.exit(3); }
  console.log("Готово.");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
