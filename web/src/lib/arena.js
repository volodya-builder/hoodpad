// Арена hood — обёртка для сайта: реактивный хук поверх чистого ядра.
// ВСЯ логика правил живёт в arena-core.js (общая с ИИ-казначеем).
import { useEffect, useState } from "react";
import { allTrades, loadTokens } from "./data.js";
import { arenaState, buildChain, setSystemAddresses } from "./arena-core.js";
import { TREASURY_ADDRESS, FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, ARENA_TREASURY_ADDRESS, ARENA_LIVE } from "./config.js";
import { publicClient } from "./web3.js";
import { arenaTreasuryAbi } from "./abi.js";
import { recentFromBlock } from "./data.js";

setSystemAddresses([TREASURY_ADDRESS, FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, ARENA_TREASURY_ADDRESS].filter(Boolean));

/** Призовой фонд арены — баланс казны арены в ETH (число). null — казны нет / ошибка. */
export function useArenaPot() {
  const [pot, setPot] = useState(null);
  useEffect(() => {
    if (!ARENA_LIVE) return undefined;
    let alive = true;
    const pull = () => publicClient.getBalance({ address: ARENA_TREASURY_ADDRESS })
      .then((b) => alive && setPot(Number(b) / 1e18)).catch(() => {});
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return pot;
}

/** Выкупы казны арены за последние дни — из событий Buyback (пометка
 *  «arena <день> <место> $SYM»). Сгруппировано по дню, новые первыми. */
export async function loadArenaPayouts() {
  if (!ARENA_LIVE) return [];
  const fromBlock = await recentFromBlock();
  const ev = arenaTreasuryAbi.find((x) => x.type === "event" && x.name === "Buyback");
  const logs = await publicClient.getLogs({ address: ARENA_TREASURY_ADDRESS, event: ev, fromBlock, toBlock: "latest" });
  const byDay = new Map();
  for (const l of logs) {
    const m = /^arena (\d{4}-\d{2}-\d{2}) (\d) ?\$?(\S*)/.exec(l.args.note || "");
    if (!m) continue;
    const day = m[1];
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({
      place: Number(m[2]), symbol: m[3] || "", token: l.args.token,
      eth: l.args.asset === "0x0000000000000000000000000000000000000000" ? Number(l.args.amountIn) / 1e18 : 0,
      tokens: Number(l.args.tokensOut) / 1e18, tx: l.transactionHash, block: l.blockNumber,
    });
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, rows]) => ({ day, rows: rows.sort((a, b) => a.place - b.place) }));
}

export function useArenaPayouts() {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!ARENA_LIVE) { setList([]); return undefined; }
    let alive = true;
    const pull = () => loadArenaPayouts().then((v) => alive && setList(v)).catch(() => alive && setList([]));
    pull();
    const id = setInterval(pull, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return list;
}

export {
  DAY, dayStart, arenaState, podium, buildChain, grandArena, hallOfFame,
} from "./arena-core.js";

/** Реактивный хук: текущая арена (с защитой трона), тикает каждые 30с. */
/** enabled=false — арена выключена (FEATURES.arena): ни одного запроса в сеть.
 *  Раньше главная каждые 30 с тянула ВСЕ сделки платформы ради скрытой вкладки. */
// Кэш исходных данных арены в localStorage: страница рисуется мгновенно из
// прошлого захода, свежие данные подтягиваются следом (владелец 15.09.2026:
// «читаю блокчейн» на пару секунд — недопустимо).
// Ключ кэша привязан к фабрике: после перезапуска старые монеты из кэша не всплывают
const ARENA_LS = "hood_cache_arena_v2_" + String(FACTORY_ADDRESS || "").slice(2, 10);
const _bigR = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v);
const _bigV = (k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v);
function readArenaCache() {
  try {
    const c = JSON.parse(localStorage.getItem(ARENA_LS) || "null", _bigV);
    if (c && c.t && Date.now() - c.t < 6 * 3600 * 1000 && Array.isArray(c.tokens) && Array.isArray(c.trades)) return c;
  } catch (e) { /* ignore */ }
  return null;
}
function writeArenaCache(tokens, trades) {
  try { localStorage.setItem(ARENA_LS, JSON.stringify({ t: Date.now(), tokens, trades: trades.slice(0, 4000) }, _bigR)); } catch (e) { /* переполнение — просто без кэша */ }
}
function computeArena(tokens, trades) {
  const { chain, today } = buildChain(tokens, trades, 31);
  const todaySt = chain.get(today) ?? arenaState(tokens, trades, today);
  return { ...todaySt, tokens, trades };
}

export function useArena(enabled = true) {
  const [st, setSt] = useState(() => {
    if (!enabled) return null;
    const c = readArenaCache();
    try { return c ? { ...computeArena(c.tokens, c.trades), cached: true } : null; } catch (e) { return null; }
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const pull = async () => {
      try {
        const [tokens, trades] = await Promise.all([loadTokens(), allTrades()]);
        if (!alive) return;
        setSt(computeArena(tokens, trades));
        writeArenaCache(tokens, trades);
      } catch (e) { /* ignore */ }
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [enabled]);
  return st;
}
