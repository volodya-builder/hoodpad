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

function refreshTokens() {
  if (_tok.p) return _tok.p;
  _tok.p = _loadTokensFresh()
    .then((v) => {
      _tok = { v, t: Date.now(), p: null };
      try { localStorage.setItem(TOK_LS, JSON.stringify(v, bigReplacer)); } catch (e) { /* ignore */ }
      return v;
    })
    .catch((e) => { _tok.p = null; if (_tok.v) return _tok.v; throw e; });
  return _tok.p;
}

export async function loadTokens() {
  if (_tok.v) {
    if (Date.now() - _tok.t > 10_000) refreshTokens(); // фоновое обновление, не ждём
    return _tok.v; // мгновенный ответ
  }
  return refreshTokens();
}

async function _loadTokensFresh() {
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

async function _poolTradesFresh(pool) {
  const logs = await publicClient.getLogs({
    address: pool, events: tradeEvents, fromBlock: 0n, toBlock: "latest",
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
        address: FACTORY_ADDRESS, event: createdEvent, fromBlock: 0n, toBlock: "latest",
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
