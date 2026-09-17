// Арена hood — обёртка для сайта: реактивный хук поверх чистого ядра.
// ВСЯ логика правил живёт в arena-core.js (общая с ИИ-казначеем).
import { useEffect, useState } from "react";
import { allTrades, loadTokens } from "./data.js";
import { arenaState, buildChain, setSystemAddresses } from "./arena-core.js";
import { TREASURY_ADDRESS, FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, ARENA_TREASURY_ADDRESS, ARENA_TREASURY_LEGACY_ADDRESS, ARENA_LIVE } from "./config.js";
import { publicClient } from "./web3.js";
import { arenaTreasuryAbi, erc20Abi } from "./abi.js";
import { recentFromBlock } from "./data.js";

setSystemAddresses([TREASURY_ADDRESS, FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, ARENA_TREASURY_ADDRESS].filter(Boolean));

/** Призовой фонд арены. Казна держит ETH (доля от ETH-монет) и валюты
 *  монет за валюту (USDG, акции, крипта — сплиттер отдаёт долю в той же
 *  валюте, что торговалась). Возвращает { eth, usd, assets:[{addr,sym,amt,usd}] }
 *  — usd это всё вместе в долларах; null — казны нет / ошибка. */
const POT_LS = "hood_cache_arena_pot_v1_" + String(ARENA_TREASURY_ADDRESS || "").slice(2, 10);
let _pot = { v: null, t: 0, p: null };
try { const c = JSON.parse(localStorage.getItem(POT_LS) || "null"); if (c && c.v) _pot = { v: c.v, t: 0, p: null }; } catch (e) { /* ignore */ }
/** Фонд арены с памятью на 30 с и снимком в localStorage: страница арены
 *  показывает цифру сразу, свежая подтягивается следом. */
export function loadArenaPot() {
  if (_pot.v && Date.now() - _pot.t < 30_000) return Promise.resolve(_pot.v);
  if (_pot.p) return _pot.p;
  _pot.p = _loadArenaPotFresh().then((v) => { _pot = { v, t: Date.now(), p: null }; try { localStorage.setItem(POT_LS, JSON.stringify({ v })); } catch (e) { /* ignore */ } return v; })
    .catch((e) => { _pot.p = null; if (_pot.v) return _pot.v; throw e; });
  return _pot.p;
}
async function _loadArenaPotFresh() {
  // фонд = казна арены + прежняя казна (туда падают излишки градаций), если задана
  const vaults = [ARENA_TREASURY_ADDRESS, ARENA_TREASURY_LEGACY_ADDRESS].filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a || ""));
  const [bals, tokens, { ethUsd, quoteUsd }] = await Promise.all([
    Promise.all(vaults.map((a) => publicClient.getBalance({ address: a }).catch(() => 0n))),
    loadTokens().catch(() => []),
    import("./price.js"),
  ]);
  const rate = await ethUsd().catch(() => 0);
  const eth = bals.reduce((s, b) => s + Number(b) / 1e18, 0);
  const seen = new Map();
  for (const tk of tokens) if (tk.q?.addr && !seen.has(tk.q.addr)) seen.set(tk.q.addr, tk.q);
  const assets = [];
  await Promise.all([...seen.values()].map(async (q) => {
    try {
      const raws = await Promise.all(vaults.map((a) => publicClient.readContract({ address: q.addr, abi: erc20Abi, functionName: "balanceOf", args: [a] }).catch(() => 0n)));
      const raw = raws.reduce((s, x) => s + x, 0n);
      if (raw === 0n) return;
      const amt = Number(raw) / 10 ** (q.dec ?? 18);
      const px = await quoteUsd(q.addr).catch(() => 0);
      assets.push({ addr: q.addr, sym: q.sym, amt, usd: amt * (px || 0) });
    } catch (e) { /* валюта не ответила — не показываем */ }
  }));
  assets.sort((a, b) => b.usd - a.usd);
  return { eth, usd: eth * rate + assets.reduce((s, a) => s + a.usd, 0), assets };
}

/** Прогрев арены в простое (main.jsx): сделки, фонд, выплаты — чтобы вкладка
 *  открывалась с готовыми данными даже в первый заход. */
export function warmArena() {
  if (!ARENA_LIVE) return;
  Promise.all([loadTokens(), allTrades()]).then(([tokens, trades]) => writeArenaCache(tokens, trades)).catch(() => {});
  loadArenaPot().catch(() => {});
  loadArenaPayouts().catch(() => {});
}

export function useArenaPot() {
  const [pot, setPot] = useState(() => _pot.v);
  useEffect(() => {
    if (!ARENA_LIVE) return undefined;
    let alive = true;
    const pull = async () => {
      try {
        const v = await loadArenaPot();
        if (alive) setPot(v);
      } catch (e) { /* казна не ответила — оставляем прошлое значение */ }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return pot;
}

/** Выкупы казны арены за последние дни — из событий Buyback (пометка
 *  «arena <день> <место> $SYM»). Сгруппировано по дню, новые первыми. */
let _payouts = { v: null, t: 0, p: null };
export async function loadArenaPayouts() {
  if (!ARENA_LIVE) return [];
  if (_payouts.v && Date.now() - _payouts.t < 60_000) return _payouts.v;
  if (_payouts.p) return _payouts.p;
  _payouts.p = _loadArenaPayoutsFresh().then((v) => { _payouts = { v, t: Date.now(), p: null }; return v; }).catch((e) => { _payouts.p = null; throw e; });
  return _payouts.p;
}
async function _loadArenaPayoutsFresh() {
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
const ARENA_LS = "hood_cache_arena_v3_" + String(FACTORY_ADDRESS || "").slice(2, 10);
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
