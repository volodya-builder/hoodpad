import { parseAbi, parseAbiItem } from "viem";
import { useEffect, useState } from "react";
import { publicClient } from "./web3.js";
import { factoryAbi, poolAbi, tokenAbi } from "./abi.js";
import { FACTORY_ADDRESS } from "./config.js";

export function parseMeta(uri) {
  try {
    if (uri?.startsWith("data:application/json;base64,")) {
      return JSON.parse(decodeURIComponent(escape(atob(uri.split(",")[1]))));
    }
  } catch (e) { /* ignore malformed metadata */ }
  return {};
}

const PAGE = 96n;

// ---------------------------------------------------------------- subgraph
// Goldsky-индексатор: сайт получает готовые данные одним запросом.
// При любой ошибке автоматически откатываемся на прямое чтение блокчейна.
// МЕЙННЕТ Goldsky-субграф (индексатор). Сеть robinhood-mainnet.
// hood v2 subgraph (мейннет, фабрика 0x68a9…): версия 2.0.0
export const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/2.0.0/gn";

async function gql(query, attempts = 3) {
  if (!SUBGRAPH_URL) throw new Error("subgraph disabled"); // сразу на RPC-фолбэк
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error("subgraph " + r.status);
      const j = await r.json();
      if (j.errors) throw new Error(j.errors[0]?.message || "subgraph error");
      return j.data;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

// Публичный RPC отклоняет getLogs на огромных диапазонах. Считаем безопасный
// стартовый блок: не глубже LOOKBACK от текущего (раунды/история за неделю
// целиком покрываются, а полную историю всё равно отдаёт индексатор).
const LOG_LOOKBACK = 1_200_000n;
export async function recentFromBlock(lookback = LOG_LOOKBACK) {
  try {
    const latest = await publicClient.getBlockNumber();
    return latest > lookback ? latest - lookback : 0n;
  } catch (e) { return 0n; }
}

const VIRT_WEI = 1625000000000000000n;      // 1.625 ETH
const TOTAL_WEI = 10n ** 27n;               // 1e9 токенов
const CAP_WEI = 8n * 10n ** 26n;            // 800M

async function _loadTokensSubgraph() {
  const d = await gql(`{ tokens(first: 96, orderBy: createdBlock, orderDirection: desc) {
    id name symbol metadataURI creator pool createdAt graduated ethReserve tokensSold } }`);
  if (!d?.tokens) throw new Error("no tokens field");
  return d.tokens.map((x) => {
    const reserve = BigInt(x.ethReserve);
    const sold = BigInt(x.tokensSold);
    const denom = TOTAL_WEI - sold;
    const price = denom > 0n ? ((VIRT_WEI + reserve) * 10n ** 18n) / denom : 0n;
    return {
      token: x.id, pool: x.pool, name: x.name, symbol: x.symbol,
      price, sold, cap: CAP_WEI, reserve, graduated: x.graduated,
      meta: parseMeta(x.metadataURI),
      createdAt: Number(x.createdAt) * 1000,
      creator: x.creator,
    };
  });
}

export async function subgraphVotes(epoch) {
  const d = await gql(`{ voteCasts(first: 1000, orderBy: timestamp, orderDirection: desc,
    where: { epoch: "${epoch.toString()}" }) { token voter timestamp } }`);
  if (!d?.voteCasts) throw new Error("no voteCasts");
  return d.voteCasts.map((v) => ({
    voter: v.voter, token: v.token.toLowerCase(),
    ts: Number(v.timestamp) * 1000, block: 0,
  }));
}

/** Статистика за 24ч по всем пулам одним запросом:
 *  vol: poolLower -> ETH объёма; first: poolLower -> цена первой сделки окна (ETH/токен). */
let _st24 = { v: null, t: 0 };
export async function subgraphStats24() {
  if (_st24.v && Date.now() - _st24.t < 60_000) return _st24.v;
  const since = Math.floor(Date.now() / 1000) - 86400;
  const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: asc,
    where: { timestamp_gt: "${since}" }) { pool ethAmount tokenAmount } }`);
  const vol = {}, first = {};
  for (const tr of d.trades || []) {
    const p = tr.pool.toLowerCase();
    const eth = Number(tr.ethAmount) / 1e18;
    const tok = Number(tr.tokenAmount) / 1e18;
    vol[p] = (vol[p] || 0) + eth;
    if (first[p] == null && tok > 0) first[p] = eth / tok;
  }
  _st24 = { v: { vol, first }, t: Date.now() };
  return _st24.v;
}

/** Комиссии трейдера (для рефералки): сумма fee по его сделкам с момента sinceTs. */
export async function subgraphTraderFees(trader, sinceTs = 0) {
  const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc,
    where: { trader: "${trader.toLowerCase()}" }) { fee timestamp } }`);
  if (!d?.trades) throw new Error("no trades field");
  let fees = 0, n = 0;
  for (const t of d.trades) {
    if (Number(t.timestamp) * 1000 < sinceTs) continue;
    fees += Number(t.fee) / 1e18;
    n++;
  }
  return { fees, trades: n };
}

/** Последние сделки ВСЕХ пулов одним запросом (для аналитики и лидербордов).
 *  Вместо обхода каждого пула по отдельности — до 3000 свежих сделок за 1-3 запроса.
 *  SWR-кэш 60с: сто посетителей = те же 1-3 запроса в минуту, а не сотни. */
let _allTr = { v: null, t: 0, p: null };
export async function allTrades() {
  if (_allTr.v && Date.now() - _allTr.t < 60_000) return _allTr.v;
  if (_allTr.p) return _allTr.p;
  _allTr.p = (async () => {
    const out = [];
    let beforeTs = null;
    for (let page = 0; page < 3; page++) {
      const cond = beforeTs ? `, where: { timestamp_lt: "${beforeTs}" }` : "";
      const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc${cond}) {
        pool trader isBuy ethAmount tokenAmount fee timestamp block tx } }`);
      const rows = d?.trades || [];
      for (const l of rows) {
        out.push({
          pool: l.pool.toLowerCase(),
          side: l.isBuy ? "buy" : "sell", addr: l.trader,
          eth: Number(l.ethAmount) / 1e18, tokens: Number(l.tokenAmount) / 1e18,
          fee: Number(l.fee) / 1e18,
          ts: Number(l.timestamp) * 1000, block: BigInt(l.block), tx: l.tx,
        });
      }
      if (rows.length < 1000) break;
      beforeTs = rows[rows.length - 1].timestamp;
    }
    _allTr = { v: out, t: Date.now(), p: null };
    return out;
  })().catch((e) => { _allTr.p = null; if (_allTr.v) return _allTr.v; throw e; });
  return _allTr.p;
}

/** Все сделки одного пользователя одним запросом (для профиля). */
export async function subgraphUserTrades(trader) {
  const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc,
    where: { trader: "${trader.toLowerCase()}" }) {
    pool isBuy ethAmount tokenAmount fee timestamp block tx } }`);
  if (!d?.trades) throw new Error("no trades field");
  return d.trades.map((l) => ({
    pool: l.pool.toLowerCase(),
    side: l.isBuy ? "buy" : "sell",
    eth: Number(l.ethAmount) / 1e18, tokens: Number(l.tokenAmount) / 1e18,
    fee: Number(l.fee) / 1e18,
    ts: Number(l.timestamp) * 1000, block: BigInt(l.block), tx: l.tx,
  }));
}

export async function subgraphTreasuryOps() {
  const d = await gql(`{ treasuryOps(first: 1000, orderBy: timestamp, orderDirection: desc) {
    kind from token ethAmount tokenAmount timestamp tx } }`);
  if (!d?.treasuryOps) throw new Error("no treasuryOps");
  return d.treasuryOps;
}

// Кэш списка токенов в режиме stale-while-revalidate: страница ВСЕГДА
// получает данные мгновенно (пусть и чуть устаревшие), а свежие
// подтягиваются в фоне. Кэш переживает перезагрузку через localStorage.
let _tok = { v: null, t: 0, p: null };
const TOK_LS = "hood_cache_tokens_v1";

const bigReplacer = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v);
const bigReviver = (k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v);

try {
  const rawLs = localStorage.getItem(TOK_LS);
  if (rawLs) { _tok.v = JSON.parse(rawLs, bigReviver); _tok.t = 0; } // t=0 → сразу обновится в фоне
} catch (e) { /* ignore */ }

// Свежесозданные токены: показываем мгновенно, не дожидаясь индексатора.
// Держим в этом списке, пока токен не появится в «свежих» данных.
const _pending = new Map(); // tokenLower -> row

export function injectNewToken({ token, pool, name, symbol, uri, creator }) {
  const key = token.toLowerCase();
  const row = {
    token, pool, name, symbol,
    price: (VIRT_WEI * 10n ** 18n) / TOTAL_WEI,
    sold: 0n, cap: CAP_WEI, reserve: 0n, graduated: false,
    meta: parseMeta(uri), createdAt: Date.now(), creator,
  };
  _pending.set(key, row);
  const cur = _tok.v ?? [];
  if (!cur.some((r) => r.token.toLowerCase() === key)) {
    _tok = { ..._tok, v: [row, ...cur] };
    try { localStorage.setItem(TOK_LS, JSON.stringify(_tok.v, bigReplacer)); } catch (e) { /* ignore */ }
  }
  // подталкиваем фоновые обновления, пока индексатор догоняет
  setTimeout(() => refreshTokens().catch(() => {}), 3000);
  setTimeout(() => refreshTokens().catch(() => {}), 8000);
}

function refreshTokens() {
  if (_tok.p) return _tok.p;
  _tok.p = _loadTokensFresh()
    .then((v) => {
      // не теряем свежесозданные токены, которых индексатор ещё не видит
      for (const [k, row] of _pending) {
        if (v.some((r) => r.token.toLowerCase() === k)) _pending.delete(k);
        else v = [row, ...v];
      }
      _tok = { v, t: Date.now(), p: null };
      try { localStorage.setItem(TOK_LS, JSON.stringify(v, bigReplacer)); } catch (e) { /* ignore */ }
      return v;
    })
    .catch((e) => { _tok.p = null; if (_tok.v) return _tok.v; throw e; });
  return _tok.p;
}

export async function loadTokens() {
  if (_tok.v) {
    if (Date.now() - _tok.t > 20_000) refreshTokens(); // фоновое обновление, не ждём
    return _tok.v; // мгновенный ответ
  }
  return refreshTokens();
}

export const dataSource = { v: "" }; // "subgraph" | "rpc" — что реально отвечает

async function _loadTokensFresh() {
  try {
    const r = await _loadTokensSubgraph();
    dataSource.v = "subgraph";
    return r;
  } catch (e) {
    dataSource.v = "rpc";
    return _loadTokensRpc();
  }
}

async function _loadTokensRpc() {
  const count = await publicClient.readContract({
    address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "tokenCount",
  });
  if (count === 0n) return [];
  const offset = count > PAGE ? count - PAGE : 0n;
  const addrs = await publicClient.readContract({
    address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "tokens", args: [offset, PAGE],
  });
  const createdAt = await loadCreationTimes(addrs).catch(() => ({}));
  const items = await Promise.all(
    addrs.map(async (token) => {
      const pool = await publicClient.readContract({
        address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "poolOf", args: [token],
      });
      const [name, symbol, uri, price, sold, cap, reserve, graduated] = await Promise.all([
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "metadataURI" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "spotPrice" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "tokensSold" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "saleCap" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "ethReserve" }),
        publicClient.readContract({ address: pool, abi: poolAbi, functionName: "graduated" }),
      ]);
      return { token, pool, name, symbol, price, sold, cap, reserve, graduated,
               meta: parseMeta(uri), createdAt: createdAt[token.toLowerCase()] };
    })
  );
  return items.reverse();
}

// ---------------------------------------------------------------- events
export const tradeEvents = parseAbi([
  "event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee)",
  "event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee)",
]);

/** All trades of a pool, oldest first, replayed into price points. */
const _trades = new Map(); // pool -> { v, t, p }

/** Сбросить кэш сделок пула — следующий poolTrades() пойдёт за свежими данными. */
export function invalidateTrades(pool) {
  _trades.delete(pool);
}

export async function poolTrades(pool) {
  const c = _trades.get(pool);
  if (c?.v) {
    // мгновенный ответ + тихое обновление в фоне
    if (Date.now() - c.t > 10_000 && !c.p) {
      const p = _poolTradesFresh(pool)
        .then((v) => { _trades.set(pool, { v, t: Date.now(), p: null }); return v; })
        .catch(() => { _trades.set(pool, { ...c, p: null }); return c.v; });
      _trades.set(pool, { ...c, p });
    }
    return c.v;
  }
  if (c?.p) return c.p;
  const p = _poolTradesFresh(pool)
    .then((v) => { _trades.set(pool, { v, t: Date.now(), p: null }); return v; })
    .catch((e) => { _trades.set(pool, { p: null }); throw e; });
  _trades.set(pool, { p });
  return p;
}

async function _poolTradesSubgraph(pool) {
  const d = await gql(`{ trades(first: 1000, orderBy: block, orderDirection: asc,
    where: { pool: "${pool.toLowerCase()}" }) {
    isBuy trader ethAmount tokenAmount fee timestamp block tx } }`);
  if (!d?.trades) throw new Error("no trades field");
  const VIRT = 1.625, TOTAL = 1e9;
  let eth = 0, sold = 0;
  const trades = [];
  const points = [{ i: 0, mcap: (VIRT / TOTAL) * TOTAL, ts: null }];
  for (const l of d.trades) {
    const ethAmt = Number(l.ethAmount) / 1e18;
    const tokAmt = Number(l.tokenAmount) / 1e18;
    const fee = Number(l.fee) / 1e18;
    if (l.isBuy) { eth += ethAmt; sold += tokAmt; }
    else { eth -= ethAmt + fee; sold -= tokAmt; }
    const price = (VIRT + eth) / (TOTAL - sold);
    const ts = Number(l.timestamp) * 1000;
    trades.push({
      side: l.isBuy ? "buy" : "sell", addr: l.trader,
      eth: ethAmt, tokens: tokAmt, fee,
      block: BigInt(l.block), tx: l.tx, ts,
    });
    points.push({ i: trades.length, mcap: price * TOTAL, ts });
  }
  const res = { trades: trades.reverse(), points };
  if (res.trades.length > 0) res.now = Date.now();
  return res;
}

async function _poolTradesFresh(pool) {
  try { return await _poolTradesSubgraph(pool); }
  catch (e) { return _poolTradesRpc(pool); }
}

async function _poolTradesRpc(pool) {
  const logs = await publicClient.getLogs({
    address: pool, events: tradeEvents, fromBlock: await recentFromBlock(), toBlock: "latest",
  });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber
    ? Number(a.logIndex - b.logIndex) : Number(a.blockNumber - b.blockNumber)));

  const VIRT = 1.625, TOTAL = 1e9;
  let eth = 0, sold = 0;
  const trades = [];
  const points = [{ i: 0, mcap: (VIRT / TOTAL) * TOTAL }];
  for (const l of logs) {
    const isBuy = l.eventName === "Buy";
    const ethAmt = Number(isBuy ? l.args.ethIn : l.args.ethOut) / 1e18;
    const tokAmt = Number(isBuy ? l.args.tokensOut : l.args.tokensIn) / 1e18;
    const fee = Number(l.args.fee) / 1e18;
    if (isBuy) { eth += ethAmt; sold += tokAmt; }
    else { eth -= ethAmt + fee; sold -= tokAmt; }
    const price = (VIRT + eth) / (TOTAL - sold);
    trades.push({
      side: isBuy ? "buy" : "sell",
      addr: isBuy ? l.args.buyer : l.args.seller,
      eth: ethAmt, tokens: tokAmt, fee,
      block: l.blockNumber, tx: l.transactionHash,
    });
    points.push({ i: trades.length, mcap: price * TOTAL });
  }
  return { trades: trades.reverse(), points };
}


// ---------------------------------------------------------------- fee split
import { splitterAbi } from "./abi.js";

let splitCache = null;
export async function loadSplit() {
  if (splitCache) return splitCache;
  try {
    const [shareBps, treasury] = await Promise.all([
      publicClient.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "creatorFeeShareBps" }),
      publicClient.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "treasury" }),
    ]);
    const creator = Number(shareBps) / 100;
    let team = 0;
    try {
      const teamBps = await publicClient.readContract({
        address: treasury, abi: splitterAbi, functionName: "teamBps",
      });
      team = ((100 - creator) * Number(teamBps)) / 10000;
    } catch (e) { /* treasury is not a splitter -> everything goes to buyback */ }
    const buyback = 100 - creator - team;
    splitCache = {
      creator: Math.round(creator), team: Math.round(team), buyback: Math.round(buyback),
    };
  } catch (e) {
    splitCache = { creator: 50, team: 20, buyback: 30 };
  }
  return splitCache;
}

export function useSplit() {
  const [split, setSplit] = useState({ creator: 50, team: 20, buyback: 30 });
  useEffect(() => { loadSplit().then(setSplit).catch(() => {}); }, []);
  return split;
}

// ---------------------------------------------------------------- «подушка выкупа»
// Сколько ETH казна потратила на выкуп каждого токена (+ общий счётчик)
// и сколько токенов сожгла. Источник — treasuryOps из Goldsky, SWR-кэш.
let _sup = { v: null, t: 0, p: null };
const SUP_LS = "hood_cache_support_v1";
try {
  const rawSup = localStorage.getItem(SUP_LS);
  if (rawSup) _sup.v = JSON.parse(rawSup);
} catch (e) { /* ignore */ }

async function _loadSupportFresh() {
  const ops = await subgraphTreasuryOps();
  const per = {};
  let totalEth = 0, totalBought = 0, totalBurned = 0, buybackCount = 0;
  for (const o of ops) {
    const tok = (o.token || "").toLowerCase();
    if (!tok) continue;
    if (!per[tok]) per[tok] = { eth: 0, bought: 0, burned: 0 };
    if (o.kind === "buyback") {
      const eth = Number(o.ethAmount) / 1e18;
      const bought = Number(o.tokenAmount) / 1e18;
      totalEth += eth; totalBought += bought; buybackCount += 1;
      per[tok].eth += eth;
      per[tok].bought += bought;
    } else if (o.kind === "burn") {
      const b = Number(o.tokenAmount) / 1e18;
      totalBurned += b;
      per[tok].burned += b;
    }
  }
  return { per, totalEth, totalBought, totalBurned, buybackCount };
}

export function loadSupport() {
  if (_sup.v && Date.now() - _sup.t < 60_000) return Promise.resolve(_sup.v);
  if (_sup.p) return _sup.p;
  _sup.p = _loadSupportFresh()
    .then((v) => {
      _sup = { v, t: Date.now(), p: null };
      try { localStorage.setItem(SUP_LS, JSON.stringify(v)); } catch (e) { /* ignore */ }
      return v;
    })
    .catch((e) => { _sup.p = null; if (_sup.v) return _sup.v; throw e; });
  return _sup.p;
}

export function useSupport() {
  const [sup, setSup] = useState(_sup.v ?? { per: {}, totalEth: 0 });
  useEffect(() => { loadSupport().then(setSup).catch(() => {}); }, []);
  return sup;
}


// ---------------------------------------------------------------- creation times
// Основной источник — API эксплорера Blockscout (транзакция создания контракта),
// кэш в localStorage навсегда (время запуска неизменно). Фолбэк — события фабрики.
import { EXPLORER } from "./config.js";

const createdEvent = parseAbiItem(
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, string name, string symbol, string metadataURI)"
);

function cacheGet(addr) {
  try { const v = localStorage.getItem("hood_created_" + addr); return v ? Number(v) : null; }
  catch (e) { return null; }
}
function cacheSet(addr, ts) {
  try { localStorage.setItem("hood_created_" + addr, String(ts)); } catch (e) { /* ignore */ }
}

async function creationTimeViaExplorer(addr) {
  const a = await fetch(`${EXPLORER}/api/v2/addresses/${addr}`).then((r) => r.json());
  const tx = a.creation_tx_hash || a.creation_transaction_hash;
  if (!tx) return null;
  const t = await fetch(`${EXPLORER}/api/v2/transactions/${tx}`).then((r) => r.json());
  return t.timestamp ? new Date(t.timestamp).getTime() : null;
}

export async function loadCreationTimes(addrs) {
  const out = {};
  const missing = [];
  for (const addr of addrs) {
    const k = addr.toLowerCase();
    const c = cacheGet(k);
    if (c) out[k] = c; else missing.push(k);
  }
  await Promise.all(missing.map(async (k) => {
    try {
      const ts = await creationTimeViaExplorer(k);
      if (ts) { out[k] = ts; cacheSet(k, ts); }
    } catch (e) { console.warn("creation time (explorer) failed:", k, e); }
  }));
  // фолбэк для тех, кого эксплорер не отдал — события фабрики
  const still = addrs.map((a) => a.toLowerCase()).filter((k) => !out[k]);
  if (still.length) {
    try {
      const logs = await publicClient.getLogs({
        address: FACTORY_ADDRESS, event: createdEvent, fromBlock: await recentFromBlock(), toBlock: "latest",
      });
      for (const l of logs) {
        const k = l.args.token.toLowerCase();
        if (!still.includes(k) || out[k]) continue;
        const b = await publicClient.getBlock({ blockNumber: l.blockNumber });
        out[k] = Number(b.timestamp) * 1000;
        cacheSet(k, out[k]);
      }
    } catch (e) { console.warn("creation time (logs) failed:", e); }
  }
  return out;
}

/** Тикающие часы: перерисовывает компонент раз в `every` мс,
 *  чтобы надписи вида «39с назад» шли в реальном времени. */
export function useClock(every = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), every);
    return () => clearInterval(id);
  }, [every]);
}

export function timeAgo(ms) {
  let en = false;
  try { en = localStorage.getItem("hood_lang") === "en"; } catch (e) { /* ignore */ }
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const ago = en ? "ago" : "назад";
  if (s < 15) return en ? "just now" : "только что";
  if (s < 60) return `${Math.floor(s)}${en ? "s" : "с"} ${ago}`;
  if (s < 3600) return `${Math.floor(s / 60)}${en ? "m" : "м"} ${ago}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${en ? "h" : "ч"} ${ago}`;
  return `${Math.floor(s / 86400)}${en ? "d" : "д"} ${ago}`;
}
