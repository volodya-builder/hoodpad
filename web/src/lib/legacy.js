// ============================================================================
//  Монеты создателя со СТАРЫХ фабрик — прямо из блокчейна (16.09.2026).
//
//  После перезапуска индексатор знает только новые фабрики, а у кошелька
//  могут быть монеты с прошлых версий площадки. Для вкладки «Dev-токены»
//  читаем события TokenCreated старых фабрик с фильтром по создателю
//  (одно обращение к RPC на фабрику — узел отвечает за секунду), достаём
//  тикер, дату запуска и градацию. Торговых данных по ним нет (цены,
//  объёмы) — показываем то, что есть, и ссылку на обозреватель.
//  Результат запоминается в браузере на час.
// ============================================================================
import { parseAbiItem } from "viem";
import { publicClient } from "./web3.js";
import { poolAbi, tokenAbi } from "./abi.js";
import { parseMeta } from "./data.js";

// Прошлые фабрики (из истории config.js): за ETH и за валюту
export const LEGACY_ETH_FACTORIES = [
  "0x08a887196fc31b89305ae03aa991917f6b1d23ec", // 14–15.09.2026
  "0x68a983f0c73f1a5dc13aa3ae71a19a5787162cdb", // 23.07.2026
  "0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9", // 22.07.2026
  "0x22079e9f1c5acd14a1d3f1c41fd9798b33775518", // 19.07.2026
];
export const LEGACY_QUOTE_FACTORIES = [
  "0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f", // 15.09.2026
];

const EV_ETH = parseAbiItem("event TokenCreated(address indexed token, address indexed pool, address indexed creator, string name, string symbol, string metadataURI)");
const EV_QUOTE = parseAbiItem("event TokenCreated(address indexed token, address indexed pool, address indexed creator, address quote, uint16 divBps)");
const LS = "hood.legacyCoins.v1";
const TTL = 3600_000;

function readCache(cre) {
  try {
    const all = JSON.parse(localStorage.getItem(LS) || "{}");
    const c = all[cre];
    if (c && Date.now() - c.t < TTL) return c.v;
  } catch (e) { /* ignore */ }
  return null;
}
function writeCache(cre, v) {
  try {
    const all = JSON.parse(localStorage.getItem(LS) || "{}");
    all[cre] = { t: Date.now(), v };
    localStorage.setItem(LS, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Все монеты кошелька со старых фабрик: [{token, pool, symbol, name, meta, createdAt(ms), graduated, legacy: true, quoteAddr}] */
export async function loadLegacyCreatorTokens(creator) {
  const cre = String(creator || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(cre)) return [];
  const cached = readCache(cre);
  if (cached) return cached;

  const head = await publicClient.getBlockNumber();
  const found = [];
  // последовательно с паузой — публичный узел режет частые getLogs (429)
  for (const f of LEGACY_ETH_FACTORIES) {
    try {
      const logs = await publicClient.getLogs({ address: f, event: EV_ETH, args: { creator: cre }, fromBlock: 0n, toBlock: head });
      for (const l of logs) found.push({ token: l.args.token, pool: l.args.pool, name: l.args.name, symbol: l.args.symbol, uri: l.args.metadataURI, block: l.blockNumber, quoteAddr: null, factory: f });
    } catch (e) { /* фабрика молчит — идём дальше */ }
    await sleep(250);
  }
  for (const f of LEGACY_QUOTE_FACTORIES) {
    try {
      const logs = await publicClient.getLogs({ address: f, event: EV_QUOTE, args: { creator: cre }, fromBlock: 0n, toBlock: head });
      for (const l of logs) found.push({ token: l.args.token, pool: l.args.pool, name: "", symbol: "", uri: "", block: l.blockNumber, quoteAddr: String(l.args.quote).toLowerCase(), factory: f });
    } catch (e) { /* ignore */ }
    await sleep(250);
  }
  if (!found.length) { writeCache(cre, []); return []; }

  // время запуска — по блоку (один запрос на блок, блоки часто повторяются)
  const blocks = [...new Set(found.map((x) => x.block))];
  const ts = {};
  await Promise.all(blocks.map(async (b) => {
    try { const blk = await publicClient.getBlock({ blockNumber: b }); ts[b] = Number(blk.timestamp) * 1000; } catch (e) { ts[b] = 0; }
  }));
  // градация и тикер (у монет за валюту тикера в событии нет)
  await Promise.all(found.map(async (x) => {
    x.graduated = await publicClient.readContract({ address: x.pool, abi: poolAbi, functionName: "graduated" }).catch(() => false);
    if (!x.symbol) {
      x.symbol = await publicClient.readContract({ address: x.token, abi: tokenAbi, functionName: "symbol" }).catch(() => "?");
      x.name = await publicClient.readContract({ address: x.token, abi: tokenAbi, functionName: "name" }).catch(() => "");
      x.uri = await publicClient.readContract({ address: x.token, abi: tokenAbi, functionName: "metadataURI" }).catch(() => "");
    }
  }));

  const out = found.map((x) => ({
    token: x.token, pool: x.pool, name: x.name, symbol: x.symbol, meta: parseMeta(x.uri || ""),
    createdAt: ts[x.block] || 0, graduated: !!x.graduated, creator: cre, legacy: true,
    quoteAddr: x.quoteAddr, price: null,
  })).sort((a, b) => b.createdAt - a.createdAt);
  writeCache(cre, out);
  return out;
}
