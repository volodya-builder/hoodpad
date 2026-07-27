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
// ЕДИНОЕ ядро арены — тот же код, что считает бой на сайте.
// Подиум на экране и выкупы в блокчейне не могут разойтись.
import {
  buildChain, grandArena, podium, dayStart, DAY, ARENA_DAYS, setSystemAddresses,
} from "../../web/src/lib/arena-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- распределение казны (решение владельца, 25.07.2026) ----
// АКЦЕНТ НА ЕЖЕДНЕВНОЙ АРЕНЕ: битва каждый день — главный магнит платформы.
// Арена: каждый день 50% баланса казны → подиум 70/20/10 (1-2-3 места).
// Голосование: раз в неделю 20% баланса → победитель голосования.
// Гранд-Арена: раз в месяц 30% баланса → Гранд-чемпион.
// Всё — выкуп и сжигание. Проценты от ТЕКУЩЕГО баланса: казна не пустеет,
// а дневной приз автоматически растёт вместе с оборотом торгов.
const ARENA_DAILY_PCT = 0.50;
const ARENA_SPLIT = [0.7, 0.2, 0.1];
const VOTE_WEEKLY_PCT = 0.20;
const GRAND_MONTHLY_PCT = 0.30;
const DUST_ETH = 0.0003; // не тратим газ на пыль
const SLIPPAGE_BPS = 300n; // 3% допуск на выкупах: minOut считаем из кривой (анти-MEV)

// ------------------------------------------------------------ конфиг
const RPC_URL  = process.env.RPC_URL  || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY  = process.env.FACTORY  || "";      // LaunchpadFactoryV2
const TREASURY = process.env.TREASURY || "";      // BuybackTreasuryV2
const VOTEPOWER = process.env.VOTEPOWER || "";    // VotePower
const SUBGRAPH = process.env.SUBGRAPH ||
  "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/3.0.0/gn";
// пороги (в ETH), чтобы газ не съедал смысл
const SWEEP_MIN = Number(process.env.SWEEP_MIN || 0.002); // собирать, если у пула >= столько
const BUYBACK_MIN = Number(process.env.BUYBACK_MIN || 0.003); // выкуп, если в казне >= столько

let PK = (process.env.TREASURER_PRIVATE_KEY || "").replace(/["'\s]/g, "");
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) { console.error("Нет TREASURER_PRIVATE_KEY"); process.exit(1); }
if (!FACTORY || !TREASURY || !VOTEPOWER) { console.error("Задай FACTORY / TREASURY / VOTEPOWER (адреса v2)"); process.exit(1); }

// казна и фабрика не создают «честный объём» — иначе выкуп кормит очки призёра
setSystemAddresses([TREASURY, FACTORY]);

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
  "function quoteBuy(uint256 ethInGross) view returns (uint256)",
]);
const vpAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function totalFor(uint256,address) view returns (uint256)",
  "event Voted(address indexed trader, uint256 indexed epoch, address indexed token, uint256 power)",
]);
const MIN_VOL_USD = 500;
const MIN_VOL_DAYS = 2; // столько разных дней торговли нужно для голоса (как на сайте)
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

  // ---- данные для арены: токены + сделки из сабграфа (формат = фронтенд)
  const loadArenaData = async () => {
    const td = await gql(`{ tokens(first: 500) {
      id symbol creator pool createdAt graduated ethReserve tokensSold } }`).catch(() => null);
    const tokens = (td?.tokens || []).map((x) => ({
      token: x.id, symbol: x.symbol, creator: x.creator, pool: (x.pool || "").toLowerCase(),
      createdAt: Number(x.createdAt) * 1000, graduated: !!x.graduated,
      reserve: x.ethReserve, sold: x.tokensSold, meta: {},
    }));
    // ПОЛНАЯ пагинация: обрезка истории привела бы к другому подиуму,
    // чем показывает сайт (обещание «экран = блокчейн»).
    const trades = [];
    let beforeTs = null;
    for (let page = 0; page < 60; page++) {
      const cond = beforeTs ? `, where: { timestamp_lt: "${beforeTs}" }` : "";
      const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc${cond}) {
        pool trader isBuy ethAmount tokenAmount fee timestamp } }`).catch(() => null);
      const rows = d?.trades || [];
      for (const l of rows) {
        trades.push({
          pool: l.pool.toLowerCase(), side: l.isBuy ? "buy" : "sell", addr: l.trader,
          eth: Number(l.ethAmount) / 1e18, tokens: Number(l.tokenAmount) / 1e18,
          fee: Number(l.fee) / 1e18, ts: Number(l.timestamp) * 1000,
        });
      }
      if (rows.length < 1000) break;
      beforeTs = rows[rows.length - 1].timestamp;
    }
    // свежесть индексатора: платить по отставшим данным нельзя
    let fresh = false;
    try {
      const meta = await gql(`{ _meta { block { number } } }`);
      const head = await pub.getBlockNumber();
      const lag = Number(head) - Number(meta?._meta?.block?.number ?? 0);
      fresh = lag >= 0 && lag < 300; // ~несколько минут отставания допустимо
      if (!fresh) console.warn(`⚠ Индексатор отстаёт на ${lag} блоков`);
    } catch (e) { console.warn("⚠ Не удалось проверить свежесть индексатора:", e.message); }
    return { tokens, trades, fresh };
  };

  const utc = new Date();
  // Состояние выплат читаем ОДИН раз: защита от повторной выплаты важнее,
  // чем окно по часам (ручной запуск workflow_dispatch тоже попадал в окно).
  const stateFile = path.join(__dirname, "state.json");
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (e) { /* первый запуск */ }
  state.paidArena ??= {};
  state.paidGrand ??= {};
  const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  const dayKey = new Date(dayStart(Date.now()) - DAY).toISOString().slice(0, 10); // вчера
  const monthKey = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

  // minOut из он-чейн кривой: без него казну сэндвичит MEV-бот
  const minOutFor = async (token, amountWei) => {
    try {
      const pool = pools.find((p) => p.tok.toLowerCase() === token.toLowerCase())?.pool;
      if (!pool) return 0n;
      const q = await pub.readContract({ address: pool, abi: poolAbi, functionName: "quoteBuy", args: [amountWei] });
      return (q * (10000n - SLIPPAGE_BPS)) / 10000n;
    } catch (e) { return 0n; }
  };

  // ---- 2) АРЕНА: подиум вчерашнего дня (50% казны, 70/20/10)
  if (state.paidArena[dayKey]) {
    console.log(`Арена: подиум за ${dayKey} уже выплачен (${state.paidArena[dayKey].length} мест).`);
  } else {
    try {
      const { tokens, trades, fresh } = await loadArenaData();
      const yesterday = dayStart(Date.now()) - DAY;
      // не платим на отставших/пустых данных — лучше отложить до следующего запуска
      if (!tokens.length || !fresh) {
        console.warn(`⚠ Арена: данные индексатора неполные или отстают — выплата за ${dayKey} ОТЛОЖЕНА.`);
      } else {
        const { chain } = buildChain(tokens, trades, ARENA_DAYS, yesterday + DAY - 1);
        const st = chain.get(yesterday);
        // Градуировавшие токены выкупить нельзя: кривая закрыта, buy() ревертит.
        // Пропускаем их, иначе весь подиум падает и день не выплачивается.
        const gradSet = new Set(tokens.filter((x) => x.graduated).map((x) => x.token.toLowerCase()));
        const pod = podium(st).filter((p) => !gradSet.has(p.token.toLowerCase()));
        const bal = await pub.getBalance({ address: TREASURY });
        const pot = Number(formatEther(bal)) * ARENA_DAILY_PCT;
        if (!pod.length) {
          console.log("Арена: вчера не было подиума — выплат нет.");
          state.paidArena[dayKey] = []; saveState();
        } else if (pot < DUST_ETH) {
          console.log(`Арена: фонд дня ${pot.toFixed(6)} ETH — пыль, копим дальше.`);
        } else {
          const medals = ["🥇", "🥈", "🥉"];
          const payouts = [];
          for (let i = 0; i < pod.length; i++) {
            const amtEth = pot * ARENA_SPLIT[i];
            if (amtEth < DUST_ETH) continue;
            const amt = BigInt(Math.floor(amtEth * 1e18));
            const minOut = await minOutFor(pod[i].token, amt);
            const rc = await tx("buybackAndReward",
              { to: TREASURY, abi: treAbi, a: [pod[i].token, amt, minOut, 0n] },
              `${medals[i]} АРЕНА ${pod[i].symbol}: выкуп+сжигание ${amtEth.toFixed(6)} ETH`);
            payouts.push({ place: i + 1, token: pod[i].token, symbol: pod[i].symbol,
              ethAmount: amtEth, score: pod[i].score ?? 0, tx: rc.transactionHash });
            // фиксируем после КАЖДОЙ выплаты: падение в середине не приведёт к повтору
            state.paidArena[dayKey] = payouts.map((x) => x.tx); saveState();
          }
          if (payouts.length) {
            const dir = path.join(__dirname, "reports");
            fs.mkdirSync(dir, { recursive: true });
            const rep = { day: yesterday, ts: Date.now(), potEth: pot, payouts,
              reason: `Подиум арены за ${dayKey}: казна потратила 50% баланса (${pot.toFixed(6)} ETH), 70/20/10 между местами. Выкупленное сожжено.` };
            fs.writeFileSync(path.join(dir, `arena-${dayKey}.json`), JSON.stringify(rep, null, 2));
            fs.writeFileSync(path.join(dir, "latest-arena.json"), JSON.stringify(rep, null, 2));
          }
        }
      }
    } catch (e) { console.error("Арена-подиум: ошибка", e.shortMessage || e.message); }
  }

  // ---- 3) ГРАНД-АРЕНА: первый день месяца — гранд-выкуп чемпиона (30% казны)
  if (utc.getUTCDate() === 1 && !state.paidGrand[monthKey]) {
    try {
      const { tokens, trades, fresh } = await loadArenaData();
      const prevMonthEnd = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), 1) - 1;
      if (!tokens.length || !fresh) {
        console.warn(`⚠ Гранд: данные индексатора неполные — выкуп за ${monthKey} ОТЛОЖЕН.`);
        throw new Error("stale data");
      }
      const g = grandArena(tokens, trades, prevMonthEnd);
      const winner = g.table[0];
      const bal = await pub.getBalance({ address: TREASURY });
      const potEth = Number(formatEther(bal)) * GRAND_MONTHLY_PCT;
      if (winner && potEth >= DUST_ETH) {
        const amt = BigInt(Math.floor(potEth * 1e18));
        const minOut = await minOutFor(winner.token.token, amt);
        const rc = await tx("buybackAndReward",
          { to: TREASURY, abi: treAbi, a: [winner.token.token, amt, minOut, 0n] },
          `👑 ГРАНД-ВЫКУП ${winner.token.symbol}: ${potEth.toFixed(6)} ETH`);
        state.paidGrand[monthKey] = rc.transactionHash; saveState();
        const dir = path.join(__dirname, "reports");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "latest-grand.json"), JSON.stringify({
          month: new Date(prevMonthEnd).toISOString().slice(0, 7), ts: Date.now(),
          winner: winner.token.token, symbol: winner.token.symbol,
          wins: winner.wins, points: winner.points, ethAmount: potEth, tx: rc.transactionHash,
          reason: `Гранд-чемпион месяца — ${winner.token.symbol} (${winner.wins} побед). Гранд-выкуп 20% казны (${potEth.toFixed(6)} ETH), всё сожжено.`,
        }, null, 2));
      } else console.log("Гранд-Арена: нет чемпиона или фонд-пыль — пропуск.");
    } catch (e) { console.error("Гранд-выкуп: ошибка", e.shortMessage || e.message); }
  }

  // ---- 4) SETTLE: если только что закончился недельный раунд — выкуп победителя
  const EPOCH = 7 * 86400;
  const epochNow = Math.floor(now / EPOCH);
  const secsIntoEpoch = now % EPOCH;
  // окно уже одного крон-интервала (6ч): двойной выплаты нет даже если
  // state.json не сохранился, а settled[] закрывает ручной запуск
  const justRolled = secsIntoEpoch < 5.5 * 3600;
  const settled = state; // единый файл состояния
  const finishedEpoch = epochNow - 1;

  if (justRolled && !settled[finishedEpoch]) {
    // Победитель = токен с наибольшим числом голосов от кошельков, прошедших
    // ТОТ ЖЕ допуск, что на сайте: честный объём (|покупки−продажи| по дням,
    // по каждому токену) >= $500 И торговля минимум в 2 разных дня.
    const ethUsd = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")
      .then((r) => r.json()).then((j) => Number(j?.data?.amount) || 0).catch(() => 0);
    if (!ethUsd) console.warn("⚠ Курс ETH/USD недоступен — беру запасной 2000");
    const rate = ethUsd || 2000;

    // полная история сделок (пагинация): без неё часть избирателей теряет объём
    const allRows = [];
    let bTs = null;
    for (let page = 0; page < 60; page++) {
      const cond = bTs ? `, where: { timestamp_lt: "${bTs}" }` : "";
      const d = await gql(`{ trades(first:1000, orderBy:timestamp, orderDirection:desc${cond}){ trader pool isBuy ethAmount fee timestamp } }`).catch(() => null);
      const rows = d?.trades || [];
      allRows.push(...rows);
      if (rows.length < 1000) break;
      bTs = rows[rows.length - 1].timestamp;
    }
    // честный объём: wallet -> day -> pool -> {buy, sell}
    const acc = {};
    for (const tr of allRows) {
      const w = tr.trader.toLowerCase();
      const day = Math.floor((Number(tr.timestamp) * 1000) / DAY);
      const cell = ((acc[w] ??= {})[day] ??= {})[tr.pool] ??= { buy: 0, sell: 0 };
      const v = (Number(tr.ethAmount) + Number(tr.fee)) / 1e18;
      if (tr.isBuy) cell.buy += v; else cell.sell += v;
    }
    const volUsd = {}, daysOf = {};
    for (const [w, days] of Object.entries(acc)) {
      let sum = 0, nd = 0;
      for (const poolsOfDay of Object.values(days)) {
        let dayVol = 0;
        for (const c of Object.values(poolsOfDay)) dayVol += Math.abs(c.buy - c.sell);
        if (dayVol > 0) nd++;
        sum += dayVol;
      }
      volUsd[w] = sum * rate;
      daysOf[w] = nd;
    }
    // голоса раунда (окнами блоков: fromBlock:0 на активной цепи отваливается)
    const head = await pub.getBlockNumber();
    const votedEvent = vpAbi.find((x) => x.type === "event" && x.name === "Voted");
    const logs = [];
    const STEP = 500_000n;
    for (let from = 0n; from <= head; from += STEP) {
      const to = from + STEP - 1n > head ? head : from + STEP - 1n;
      const part = await pub.getLogs({ address: VOTEPOWER, event: votedEvent,
        args: { epoch: BigInt(finishedEpoch) }, fromBlock: from, toBlock: to }).catch(() => []);
      logs.push(...part);
    }
    const seen = new Set(), byToken = {};
    let rejected = 0;
    for (const l of logs) {
      const v = l.args.trader.toLowerCase();
      if (seen.has(v)) continue; seen.add(v);
      if ((volUsd[v] || 0) < MIN_VOL_USD || (daysOf[v] || 0) < MIN_VOL_DAYS) { rejected++; continue; }
      const tk = l.args.token.toLowerCase();
      byToken[tk] = (byToken[tk] || 0) + 1;
    }
    console.log(`Голоса: принято ${seen.size - rejected}, отклонено по допуску ${rejected} (порог $${MIN_VOL_USD} честного объёма + ${MIN_VOL_DAYS} дня)`);
    let winner = null, winVotes = 0;
    for (const [tk, n] of Object.entries(byToken)) if (n > winVotes) { winVotes = n; winner = tk; }
    const winPower = BigInt(winVotes); // для отчёта — число голосов
    const bal = await pub.readContract({ address: TREASURY, abi: treAbi, functionName: "treasuryBalance" });

    // выкуп голосования = 30% ТЕКУЩЕГО баланса казны (см. распределение выше)
    const voteAmtEth = Number(formatEther(bal)) * VOTE_WEEKLY_PCT;
    const voteAmt = BigInt(Math.floor(voteAmtEth * 1e18));
    if (winner && voteAmtEth >= Math.max(BUYBACK_MIN * VOTE_WEEKLY_PCT, DUST_ETH)) {
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
        votes: winVotes,
        weekVolumeEth: volByPool[(winPool || "").toLowerCase()] || 0,
        treasuryEth: formatEther(bal),
        reason: `Токен ${winner} победил в голосовании раунда #${finishedEpoch}: собрал ${winVotes} голосов от кошельков, прошедших допуск (честный объём >= $500 и торговля в 2+ дня). Казна выкупает его на ${voteAmtEth.toFixed(6)} ETH (30% баланса) и сжигает купленное — поддержка цены и дефляция.`,
      };
      const voteMinOut = await minOutFor(winner, voteAmt);
      const rc = await tx("buybackAndReward",
        { to: TREASURY, abi: treAbi, a: [winner, voteAmt, voteMinOut, BigInt(finishedEpoch)] },
        `BUYBACK+BURN ${winner.slice(0, 8)} на ${voteAmtEth.toFixed(6)} ETH`);
      report.tx = rc.transactionHash;
      report.status = rc.status;

      const dir = path.join(__dirname, "reports");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `epoch-${finishedEpoch}.json`), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(report, null, 2));
      settled[finishedEpoch] = report.tx;
      saveState();
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
