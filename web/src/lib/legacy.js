// ============================================================================
//  Кто на самом деле запускал монеты — как это видит GMGN (16.09.2026).
//
//  У нас в событии TokenCreated «создатель» — это кошелёк, которому идут
//  комиссии (creatorWallet), а не тот, кто нажал «создать». Агрегаторы
//  вроде GMGN считают девом ОТПРАВИТЕЛЯ транзакции создания и потому видят
//  связи между кошельками. Делаем так же: читаем ВСЕ события создания со
//  всех фабрик площадки (старых и новых — их немного), для каждой монеты
//  запоминаем отправителя транзакции, и «Dev-токены» — это монеты, где
//  кошелёк был либо отправителем, либо получателем комиссий.
//
//  Ещё — «источник»: откуда дев получил первый ETH (первая входящая
//  транзакция, через обозреватель; лучший источник связей между
//  кошельками). Обозреватель медленный — грузится в фоне, не блокирует.
//
//  Всё запоминается в браузере: события — на час, отправители — навсегда.
// ============================================================================
import { parseAbiItem } from "viem";
import { publicClient } from "./web3.js";
import { poolAbi, tokenAbi } from "./abi.js";
import { parseMeta } from "./data.js";
import { FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, EXPLORER } from "./config.js";

// Все фабрики площадки, старые и текущие (из истории config.js)
export const ETH_FACTORIES = [
  FACTORY_ADDRESS,
  "0xbe3e7ca55b6c4fc9e759bc8b43734b57a582da01", // 16–17.09.2026
  "0x08a887196fc31b89305ae03aa991917f6b1d23ec", // 14–15.09.2026
  "0x68a983f0c73f1a5dc13aa3ae71a19a5787162cdb", // 23.07.2026
  "0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9", // 22.07.2026
  "0x22079e9f1c5acd14a1d3f1c41fd9798b33775518", // 19.07.2026
].map((a) => String(a).toLowerCase());
export const QUOTE_FACTORIES = [
  QUOTE_FACTORY_ADDRESS,
  "0x4b55954a2910cfbb04f49e90e727fb1540b3a940", // 16–17.09.2026
  "0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f", // 15.09.2026
].map((a) => String(a).toLowerCase());
const LIVE = new Set([String(FACTORY_ADDRESS).toLowerCase(), String(QUOTE_FACTORY_ADDRESS).toLowerCase()]);

const EV_ETH = parseAbiItem("event TokenCreated(address indexed token, address indexed pool, address indexed creator, string name, string symbol, string metadataURI)");
const EV_QUOTE = parseAbiItem("event TokenCreated(address indexed token, address indexed pool, address indexed creator, address quote, uint16 divBps)");
const LS_EV = "hood.creations.v2";     // все события создания (час)
const LS_TX = "hood.creationTx.v1";    // tx → отправитель (навсегда)
const LS_SRC = "hood.fundSrc.v1";      // кошелёк → источник первого ETH (сутки)
const TTL = 3600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

let _p = null;
/** Все монеты, когда-либо созданные на площадке: [{token,pool,creator,sender,symbol,name,meta,createdAt,graduated,legacy,quoteAddr,tx}] */
export async function loadAllCreations() {
  const c = lsGet(LS_EV);
  if (c && Date.now() - c.t < TTL) return c.v;
  if (_p) return _p;
  _p = (async () => {
    const head = await publicClient.getBlockNumber();
    const found = [];
    // по очереди с паузой: публичный узел режет частые getLogs (429)
    for (const f of ETH_FACTORIES) {
      try {
        const logs = await publicClient.getLogs({ address: f, event: EV_ETH, fromBlock: 0n, toBlock: head });
        for (const l of logs) found.push({ token: l.args.token, pool: l.args.pool, creator: String(l.args.creator).toLowerCase(), name: l.args.name, symbol: l.args.symbol, uri: l.args.metadataURI, block: l.blockNumber, tx: l.transactionHash, quoteAddr: null, factory: f });
      } catch (e) { /* фабрика молчит — дальше */ }
      await sleep(200);
    }
    for (const f of QUOTE_FACTORIES) {
      try {
        const logs = await publicClient.getLogs({ address: f, event: EV_QUOTE, fromBlock: 0n, toBlock: head });
        for (const l of logs) found.push({ token: l.args.token, pool: l.args.pool, creator: String(l.args.creator).toLowerCase(), name: "", symbol: "", uri: "", block: l.blockNumber, tx: l.transactionHash, quoteAddr: String(l.args.quote).toLowerCase(), factory: f });
      } catch (e) { /* ignore */ }
      await sleep(200);
    }
    // отправитель транзакции создания — «дев» в понимании агрегаторов
    const txCache = lsGet(LS_TX) || {};
    await Promise.all(found.map(async (x) => {
      if (txCache[x.tx]) { x.sender = txCache[x.tx]; return; }
      try { const tx = await publicClient.getTransaction({ hash: x.tx }); x.sender = String(tx.from).toLowerCase(); txCache[x.tx] = x.sender; }
      catch (e) { x.sender = ""; }
    }));
    lsSet(LS_TX, txCache);
    // время — по блоку; тикер и градация — с цепи, где событие их не даёт
    const blocks = [...new Set(found.map((x) => x.block))];
    const ts = {};
    await Promise.all(blocks.map(async (b) => {
      try { const blk = await publicClient.getBlock({ blockNumber: b }); ts[String(b)] = Number(blk.timestamp) * 1000; } catch (e) { ts[String(b)] = 0; }
    }));
    await Promise.all(found.map(async (x) => {
      x.graduated = await publicClient.readContract({ address: x.pool, abi: poolAbi, functionName: "graduated" }).catch(() => false);
      if (!x.symbol) {
        x.symbol = await publicClient.readContract({ address: x.token, abi: tokenAbi, functionName: "symbol" }).catch(() => "?");
        x.name = await publicClient.readContract({ address: x.token, abi: tokenAbi, functionName: "name" }).catch(() => "");
        x.uri = await publicClient.readContract({ address: x.token, abi: tokenAbi, functionName: "metadataURI" }).catch(() => "");
      }
    }));
    const out = found.map((x) => ({
      token: String(x.token).toLowerCase(), pool: x.pool, creator: x.creator, sender: x.sender || "",
      name: x.name, symbol: x.symbol, meta: parseMeta(x.uri || ""),
      createdAt: ts[String(x.block)] || 0, graduated: !!x.graduated,
      legacy: !LIVE.has(x.factory), quoteAddr: x.quoteAddr, tx: x.tx, price: null,
    })).sort((a, b) => b.createdAt - a.createdAt);
    lsSet(LS_EV, { t: Date.now(), v: out });
    return out;
  })().finally(() => { _p = null; });
  return _p;
}

/** Монеты, к которым причастны кошельки (создатель ИЛИ отправитель транзакции создания). */
export function creationsOf(all, wallets) {
  const w = new Set((wallets || []).filter(Boolean).map((a) => String(a).toLowerCase()));
  return (all || []).filter((x) => w.has(x.creator) || w.has(x.sender));
}

/** Откуда кошелёк получил первый ETH — первая входящая транзакция (обозреватель). null — не узнали. */
export async function fundingSource(addr) {
  const a = String(addr || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a) || !EXPLORER) return null;
  const c = lsGet(LS_SRC) || {};
  if (c[a] && Date.now() - c[a].t < 86400_000) return c[a].v;
  let v = null;
  try {
    const r = await fetch(`${EXPLORER}/api/v2/addresses/${a}/transactions?filter=to`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    const j = await r.json();
    const items = (j?.items || []).filter((t) => t?.from?.hash && Number(t.value || 0) > 0);
    // список идёт от новых к старым; берём самую старую входящую с ETH
    const first = items.length ? items[items.length - 1] : null;
    if (first) v = { from: String(first.from.hash).toLowerCase(), eth: Number(first.value) / 1e18, ts: Date.parse(first.timestamp || "") || 0 };
  } catch (e) { /* обозреватель не ответил */ }
  c[a] = { t: Date.now(), v };
  lsSet(LS_SRC, c);
  return v;
}
