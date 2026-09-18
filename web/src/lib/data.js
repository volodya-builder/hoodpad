import { parseAbi, parseAbiItem } from "viem";
import { useEffect, useState } from "react";
import { publicClient } from "./web3.js";
import { factoryAbi, poolAbi, tokenAbi, quoteFactoryAbi, quotePoolAbi, erc20Abi } from "./abi.js";
import { FACTORY_ADDRESS, QUOTE_FACTORY_ADDRESS, QUOTE_LIVE, ZAP_ADDRESS, FEE_SPLITTER_ADDRESS, SPLITTER_LIVE, VIRTUAL_ETH } from "./config.js";

// Метаданные приходят из блокчейна и полностью подконтрольны создателю токена.
// Любой мусор здесь не должен ронять интерфейс: JSON.parse("null") исключения
// НЕ бросает, поэтому проверяем результат явно и нормализуем поля.
const STR = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
const IMG_OK = /^(data:image\/(png|jpe?g|webp|gif|svg\+xml);|https:\/\/)/i;

export function parseMeta(uri) {
  let m = null;
  try {
    if (uri?.startsWith("data:application/json;base64,")) {
      m = JSON.parse(decodeURIComponent(escape(atob(uri.split(",")[1]))));
    }
  } catch (e) { /* ignore malformed metadata */ }
  if (!m || typeof m !== "object" || Array.isArray(m)) return {};
  const img = STR(m.image, 400_000);
  return {
    image: img && IMG_OK.test(img) ? img : undefined,
    description: STR(m.description, 1000),
    x: STR(m.x, 120),
    telegram: STR(m.telegram, 120),
    website: STR(m.website, 200),
    // Модель ИИ монеты (выбор создателя). Без этих двух полей чип модели на
    // странице и карточке не показывался бы: parseMeta пропускает только то,
    // что перечислено здесь, — и это правильно, метадату пишет кто угодно.
    ai: STR(m.ai, 80),
    aiName: STR(m.aiName, 40),
  };
}

const PAGE = 96n;

// ---------------------------------------------------------------- subgraph
// Goldsky-индексатор: сайт получает готовые данные одним запросом.
// При любой ошибке автоматически откатываемся на прямое чтение блокчейна.
// МЕЙННЕТ Goldsky-субграф (индексатор). Сеть robinhood-mainnet.
// hood v2 subgraph (мейннет, фабрика 0x68a9…): версия 2.0.0
// 3.1.0 = + квот-фабрика (монеты за валюту). Пока владелец её не задеплоил,
// сайт сам откатывается на 3.0.0: первая проба _meta решает, дальше кэш.
const SUBGRAPH_BASE = "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/";
// 4.0.0 = перезапуск 16.09.2026 (новые фабрики 0xbe3e…/0x4b55…). Старые версии
// НЕ подставляем: они индексируют старые фабрики и показали бы старые монеты.
// Пока 4.0.0 не задеплоен на Goldsky, сайт читает фабрики напрямую (RPC).
const SUBGRAPH_VERSIONS = ["6.1.0", "6.0.0"]; // 6.1.0: комплект 18.09.2026 (V3, градация 4 ETH); 6.0.0 — запасной, пока 6.1.0 синхронизируется
export let SUBGRAPH_URL = SUBGRAPH_BASE + SUBGRAPH_VERSIONS[0] + "/gn";
let _sgPick = null;
const SG_LS = "hood_subgraph_pick_v2";
async function pickSubgraph() {
  if (_sgPick) return _sgPick;
  // выбор помним 10 минут — без лишней пробы при каждом заходе
  try {
    const c = JSON.parse(localStorage.getItem(SG_LS) || "null");
    // из кэша берём только адрес нашего же индексатора — чужой адрес в
    // localStorage не должен уводить запросы сайта
    if (c && typeof c.u === "string" && c.u.startsWith(SUBGRAPH_BASE) && Date.now() - c.t < 600_000) { SUBGRAPH_URL = c.u; _sgPick = Promise.resolve(c.u); return _sgPick; }
  } catch (e) { /* ignore */ }
  _sgPick = (async () => {
    for (const v of SUBGRAPH_VERSIONS) {
      const u = SUBGRAPH_BASE + v + "/gn";
      try {
        const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ _meta { block { number } } }" }), signal: AbortSignal.timeout(6000) });
        const j = await r.json();
        if (r.ok && j?.data?._meta?.block?.number > 0) {
          SUBGRAPH_URL = u;
          try { localStorage.setItem(SG_LS, JSON.stringify({ u, t: Date.now() })); } catch (e) { /* ignore */ }
          return u;
        }
      } catch (e) { /* следующая версия */ }
    }
    return SUBGRAPH_URL;
  })();
  return _sgPick;
}

async function gql(query, attempts = 3) {
  if (!SUBGRAPH_URL) throw new Error("subgraph disabled"); // сразу на RPC-фолбэк
  const url = await pickSubgraph();
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, {
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

const VIRT_WEI = BigInt(Math.round(VIRTUAL_ETH * 1e6)) * 10n ** 12n; // виртуальный резерв ETH-кривой
const TOTAL_WEI = 10n ** 27n;               // 1e9 токенов
const CAP_WEI = 8n * 10n ** 26n;            // 800M

async function _loadTokensSubgraph() {
  const d = await gql(`{ tokens(first: 96, orderBy: createdBlock, orderDirection: desc) {
    id name symbol metadataURI creator pool createdAt graduated ethReserve tokensSold } }`);
  if (!d?.tokens) throw new Error("no tokens field");
  return d.tokens.map(_mapSubgraphToken);
}

/** Все монеты одного создателя — прямо из индексатора (обе фабрики, без
 *  лимита списка в 96 монет). Для вкладки «Dev-токены». У монет за валюту
 *  цена в единицах валюты — фронт подставит запись из общего списка. */
export async function loadCreatorTokens(creator) {
  const qf = (await subgraphHasQuote()) ? " quote" : "";
  const d = await gql(`{ tokens(first: 300, orderBy: createdBlock, orderDirection: desc,
    where: { creator: "${String(creator).toLowerCase()}" }) {
    id name symbol metadataURI creator pool createdAt graduated ethReserve tokensSold${qf} } }`);
  if (!d?.tokens) throw new Error("no tokens field");
  return d.tokens.map((x) => ({ ..._mapSubgraphToken(x), quoteAddr: x.quote ? String(x.quote).toLowerCase() : null }));
}

function _mapSubgraphToken(x) {
  {
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
  }
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
  const qf = await tradeFields(" fee");
  const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: asc,
    where: { timestamp_gt: "${since}" }) { pool ethAmount tokenAmount${qf} } }`);
  // Монеты за валюту: объём приходит в валюте (GME, USDG…), а не в ETH —
  // пересчитываем в ETH по курсам, иначе 16 GME показывались как «$39k».
  const rows = (d.trades || []).map((tr) => ({
    pool: tr.pool.toLowerCase(), quote: tr.quote ? String(tr.quote).toLowerCase() : null,
    ethRaw: tr.ethAmount, feeRaw: tr.fee || "0", eth: Number(tr.ethAmount) / 1e18, fee: 0,
    tokens: Number(tr.tokenAmount) / 1e18, usd: fixedUsd(tr),
  }));
  await toEthEquivalent(rows);
  // volUsd: объём в долларах по курсу на момент сделок (не «дышит»); null для пула,
  // если у какой-то сделки курса не было — тогда фронт возьмёт vol × текущий курс
  const vol = {}, first = {}, volUsd = {};
  for (const tr of rows) {
    const p = tr.pool;
    vol[p] = (vol[p] || 0) + tr.eth;
    if (volUsd[p] !== null) volUsd[p] = tr.usd == null ? null : (volUsd[p] || 0) + tr.usd;
    // первая цена дня — в единицах валюты пула (для % изменения сравнивается с ценой в тех же единицах)
    const q0 = tr.quote ? Number(tr.ethRaw) / 1e18 : tr.eth;
    if (first[p] == null && tr.tokens > 0) first[p] = q0 / tr.tokens;
  }
  _st24 = { v: { vol, first, volUsd }, t: Date.now() };
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
// Сабграф 3.1.0 отдаёт у сделки поле quote (валюта курвы). До передеплоя
// поля нет — запрос с ним падает целиком, поэтому сначала пробуем.
// Доллары по курсу на момент сделки (сабграф 4.1+): поле usd у сделки.
// Пока версии без него — фронт пересчитывает по текущему курсу, как раньше.
let _hasUsd = null;
export async function subgraphHasUsd() {
  if (_hasUsd !== null) return _hasUsd;
  try { await gql("{ trades(first: 1) { usd } }"); _hasUsd = true; }
  catch (e) { _hasUsd = false; }
  return _hasUsd;
}
/** Поля сделки для запроса: quote/fee + usd, если индексатор их знает. */
async function tradeFields(base) {
  const [hq, hu] = await Promise.all([subgraphHasQuote(), subgraphHasUsd()]);
  return base + (hq ? " quote" : "") + (hu ? " usd feeUsd" : "");
}
/** Доллары сделки из индексатора; null — не записаны (0 = курса не было). */
const fixedUsd = (l) => (l.usd != null && Number(l.usd) > 0 ? Number(l.usd) : null);
const fixedFeeUsd = (l) => (l.feeUsd != null && Number(l.usd) > 0 ? Number(l.feeUsd) : null);

let _hasQuote = null;
async function subgraphHasQuote() {
  if (_hasQuote !== null) return _hasQuote;
  try { await gql("{ trades(first: 1) { quote } }"); _hasQuote = true; }
  catch (e) { _hasQuote = false; }
  return _hasQuote;
}

/** Сделки монет за валюту переводим в ETH-эквивалент: аналитика и арена
 *  считают всё в ETH. Курс валюты — с обозревателя, ETH — как везде.
 *  Нет курса — сделка остаётся с eth = 0 (в объём не попадёт, но видна). */
export async function toEthEquivalent(rows) {
  const qrows = rows.filter((r) => r.quote);
  if (!qrows.length) return rows;
  const { quoteUsd, ethUsd, ethUsdCached } = await import("./price.js");
  const tokens = await loadTokens().catch(() => []);
  const byPool = {};
  for (const tk of tokens) if (tk.q) byPool[(tk.pool || "").toLowerCase()] = tk.q;
  // курс ETH ждём не дольше 4 с — иначе берём последний известный
  const rate = await Promise.race([
    ethUsd().catch(() => ethUsdCached()),
    new Promise((r) => setTimeout(() => r(ethUsdCached()), 4000)),
  ]);
  const quotes = [...new Set(qrows.map((r) => r.quote))];
  const px = {};
  await Promise.all(quotes.map(async (a) => { px[a] = await quoteUsd(a).catch(() => 0); }));
  for (const r of qrows) {
    const q = byPool[r.pool];
    const dec = q?.dec ?? 18;
    const k = rate > 0 && px[r.quote] > 0 ? px[r.quote] / rate : 0;
    r.qAmt = Number(r.ethRaw) / 10 ** dec;
    r.qFee = Number(r.feeRaw) / 10 ** dec;
    r.eth = r.qAmt * k;
    r.fee = r.qFee * k;
  }
  return rows;
}

let _allTr = { v: null, t: 0, p: null };
export async function allTrades() {
  if (_allTr.v && Date.now() - _allTr.t < 60_000) return _allTr.v;
  if (_allTr.p) return _allTr.p;
  _allTr.p = (async () => {
    const out = [];
    let beforeTs = null;
    const qf = await tradeFields("");
    for (let page = 0; page < 3; page++) {
      const cond = beforeTs ? `, where: { timestamp_lt: "${beforeTs}" }` : "";
      const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc${cond}) {
        pool trader isBuy ethAmount tokenAmount fee timestamp block tx${qf} } }`);
      const rows = d?.trades || [];
      for (const l of rows) {
        out.push({
          pool: l.pool.toLowerCase(),
          side: l.isBuy ? "buy" : "sell", addr: l.trader,
          eth: Number(l.ethAmount) / 1e18, tokens: Number(l.tokenAmount) / 1e18,
          fee: Number(l.fee) / 1e18,
          ts: Number(l.timestamp) * 1000, block: BigInt(l.block), tx: l.tx,
          quote: l.quote ? String(l.quote).toLowerCase() : null,
          ethRaw: l.ethAmount, feeRaw: l.fee,
          usd: fixedUsd(l), feeUsd: fixedFeeUsd(l),
        });
      }
      if (rows.length < 1000) break;
      beforeTs = rows[rows.length - 1].timestamp;
    }
    await toEthEquivalent(out);
    _allTr = { v: out, t: Date.now(), p: null };
    return out;
  })().catch(async (e) => {
    // Индексатор недоступен (например, новая версия ещё не задеплоена после
    // перезапуска) — читаем сделки с цепи по каждому пулу. Монет после
    // перезапуска мало, это дёшево; арена и аналитика живут без сабграфа.
    try {
      const v = await _allTradesRpc();
      _allTr = { v, t: Date.now(), p: null };
      return v;
    } catch (e2) { _allTr.p = null; if (_allTr.v) return _allTr.v; throw e; }
  });
  return _allTr.p;
}

async function _allTradesRpc() {
  const tokens = await loadTokens();
  const out = [];
  for (const t of tokens.slice(0, 40)) {
    if (!t.pool) continue;
    const cur = t.q ? { dec: t.q.dec, virt: t.q.virt || 0, token: t.token } : null;
    const h = await poolTrades(t.pool, cur).catch(() => null);
    if (!h) continue;
    const dec = t.q ? t.q.dec : 18;
    for (const tr of h.trades) {
      out.push({
        pool: t.pool.toLowerCase(), side: tr.side, addr: tr.addr,
        eth: tr.eth, tokens: tr.tokens, fee: tr.fee,
        ts: tr.ts || 0, block: tr.block, tx: tr.tx,
        quote: t.q ? String(t.q.addr).toLowerCase() : null,
        // toEthEquivalent ждёт сырые единицы валюты
        ethRaw: t.q ? String(Math.round(tr.eth * 10 ** dec)) : null,
        feeRaw: t.q ? String(Math.round(tr.fee * 10 ** dec)) : null,
      });
    }
  }
  // Время сделок: интерполяция по блокам (2 RPC-вызова), как на странице монеты
  const noTs = out.filter((x) => !x.ts);
  if (noTs.length) {
    const blocks = noTs.map((x) => Number(x.block));
    const minB = Math.min(...blocks);
    const [latest, oldest] = await Promise.all([publicClient.getBlock(), publicClient.getBlock({ blockNumber: BigInt(minB) })]);
    const span = Number(latest.number) - minB;
    const avg = span > 0 ? (Number(latest.timestamp) - Number(oldest.timestamp)) / span : 0;
    for (const x of noTs) x.ts = (Number(oldest.timestamp) + (Number(x.block) - minB) * avg) * 1000;
  }
  out.sort((a, b) => b.ts - a.ts);
  await toEthEquivalent(out);
  return out;
}

/** Все сделки одного пользователя одним запросом (для профиля). */
export async function subgraphUserTrades(trader) {
  const qf = await tradeFields("");
  const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc,
    where: { trader: "${trader.toLowerCase()}" }) {
    pool isBuy ethAmount tokenAmount fee timestamp block tx${qf} } }`);
  if (!d?.trades) throw new Error("no trades field");
  const rows = d.trades.map((l) => ({
    pool: l.pool.toLowerCase(),
    side: l.isBuy ? "buy" : "sell",
    eth: Number(l.ethAmount) / 1e18, tokens: Number(l.tokenAmount) / 1e18,
    fee: Number(l.fee) / 1e18,
    ts: Number(l.timestamp) * 1000, block: BigInt(l.block), tx: l.tx,
    quote: l.quote ? String(l.quote).toLowerCase() : null,
    ethRaw: l.ethAmount, feeRaw: l.fee,
    usd: fixedUsd(l), feeUsd: fixedFeeUsd(l),
  }));
  // сделки за валюту — в ETH-эквиваленте, как везде (PnL, объём, история)
  await toEthEquivalent(rows);
  return rows;
}

/** Цена токена в ETH-эквиваленте: у ETH-монет — как есть, у монет за валюту —
 *  через курс валюты и ETH. Возвращает { tokenLower: priceEth }. */
export async function priceEthMap(tokens) {
  const { quoteUsd, ethUsd, ethUsdCached } = await import("./price.js");
  const { formatEther, formatUnits } = await import("viem");
  const rate = await Promise.race([ethUsd().catch(() => ethUsdCached()), new Promise((r) => setTimeout(() => r(ethUsdCached()), 4000))]);
  const out = {};
  await Promise.all(tokens.map(async (tk) => {
    const k = (tk.token || "").toLowerCase();
    if (!tk.q) { out[k] = Number(formatEther(tk.price || 0n)); return; }
    const px = await quoteUsd(tk.q.addr).catch(() => 0);
    out[k] = rate > 0 && px > 0 ? Number(formatUnits(tk.price || 0n, tk.q.dec)) * px / rate : 0;
  }));
  return out;
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
const TOK_LS = "hood_cache_tokens_v3_" + FACTORY_ADDRESS.slice(2, 10); // v3: кэш v2 успел набрать старые монеты через graft-сабграф 4.0.0 — сбрасываем

const bigReplacer = (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v);
const bigReviver = (k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v);

try {
  const rawLs = localStorage.getItem(TOK_LS);
  if (rawLs) { _tok.v = JSON.parse(rawLs, bigReviver); _tok.t = 0; } // t=0 → сразу обновится в фоне
} catch (e) { /* ignore */ }

// Свежесозданные токены: показываем мгновенно, не дожидаясь индексатора.
// Держим в этом списке, пока токен не появится в «свежих» данных.
const _pending = new Map(); // tokenLower -> row

export function injectNewToken({ token, pool, name, symbol, uri, creator, quote, quoteSym, quoteDec }) {
  const key = token.toLowerCase();
  const row = {
    token, pool, name, symbol,
    price: (VIRT_WEI * 10n ** 18n) / TOTAL_WEI,
    sold: 0n, cap: CAP_WEI, reserve: 0n, graduated: false,
    meta: parseMeta(uri), createdAt: Date.now(), creator,
    // Монета за ERC20-валюту: карточка и страница должны знать, в чём
    // считать цену. Для ETH-монет полей нет — как и раньше.
    ...(quote ? { quote, quoteSym, quoteDec } : {}),
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

/** Монета из уже загруженного списка (память/localStorage) — синхронно,
 *  для мгновенной отрисовки страницы монеты. Нет — null. */
export function cachedToken(addr) {
  const a = String(addr || "").toLowerCase();
  return (_tok.v || []).find((t) => (t.token || "").toLowerCase() === a) || null;
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
  let eth;
  try {
    eth = await _loadTokensSubgraph();
    dataSource.v = "subgraph";
  } catch (e) {
    dataSource.v = "rpc";
    eth = await _loadTokensRpc();
  }
  // Монеты за валюту живут в другой фабрике, и сабграф её пока не
  // индексирует. Читаем их с цепи напрямую: их немного, а один упавший
  // запрос не должен ронять весь список.
  const q = await _loadQuoteTokensRpc().catch(() => []);
  if (!q.length) return eth;
  // сабграф 3.1+ тоже знает монеты за валюту — чтобы не было дублей,
  // из его списка их убираем (с цепи они приходят с курсом и валютой)
  const qs = new Set(q.map((x) => x.token.toLowerCase()));
  // у монет с цепи нет создателя — берём его из записи индексатора (нужен
  // для вкладки «Dev-токены», метки «создатель» в держателях и т.п.)
  const creBy = {};
  for (const x of eth) if (x.creator) creBy[x.token.toLowerCase()] = x.creator;
  for (const x of q) if (!x.creator && creBy[x.token.toLowerCase()]) x.creator = creBy[x.token.toLowerCase()];
  const all = [...q, ...eth.filter((x) => !qs.has(x.token.toLowerCase()))];
  // Общий порядок — по времени создания, новые первыми: иначе монеты за
  // валюту всегда стояли впереди ETH-монет, и свежая ETH-монета оказывалась
  // ниже вчерашних. Без дат (RPC-запасной путь) порядок оставляем как есть.
  if (all.every((x) => x.createdAt > 0)) all.sort((a, b) => b.createdAt - a.createdAt);
  return all;
}

/** Монеты quote-фабрики. Строка — как у ETH-монет, плюс q = {addr, sym, dec}:
 *  цена и резерв здесь в знаках валюты, а не в ETH. */
async function _loadQuoteTokensRpc() {
  if (!QUOTE_LIVE) return [];
  const count = await publicClient.readContract({
    address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "tokenCount",
  });
  if (count === 0n) return [];
  const offset = count > PAGE ? count - PAGE : 0n;
  const addrs = await publicClient.readContract({
    address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "tokens", args: [offset, PAGE],
  });
  const createdAt = await loadCreationTimes(addrs).catch(() => ({}));
  const qcache = new Map(); // одна валюта — один запрос символа/знаков
  const quoteInfo = async (addr) => {
    const k = addr.toLowerCase();
    if (!qcache.has(k)) {
      qcache.set(k, Promise.all([
        publicClient.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
        publicClient.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
      ]).then(([sym, dec]) => ({ addr: k, sym: String(sym), dec: Number(dec) })));
    }
    return qcache.get(k);
  };
  const items = await Promise.all(
    addrs.map(async (token) => {
      const [pool, qaddr] = await Promise.all([
        publicClient.readContract({ address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "poolOf", args: [token] }),
        publicClient.readContract({ address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "quoteOf", args: [token] }),
      ]);
      const [name, symbol, uri, price, sold, cap, reserve, graduated, divBps, q] = await Promise.all([
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "metadataURI" }),
        publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "spotPrice" }),
        publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "tokensSold" }),
        publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "saleCap" }),
        publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "quoteReserve" }),
        publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "graduated" }),
        publicClient.readContract({ address: pool, abi: quotePoolAbi, functionName: "divBps" }).catch(() => 0),
        quoteInfo(qaddr),
      ]);
      return { token, pool, name, symbol, price, sold, cap, reserve, graduated,
               meta: parseMeta(uri), createdAt: createdAt[token.toLowerCase()],
               q, divBps: Number(divBps) };
    })
  );
  return items.reverse();
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
// Продажа через зап (монету → ETH одной транзакцией): пул видит продавцом
// сам зап, а настоящий продавец — в событии запа SoldForEth.
const zapSoldEvent = parseAbi([
  "event SoldForEth(address indexed token, address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 ethOut)",
]);

/** All trades of a pool, oldest first, replayed into price points. */
const _trades = new Map(); // pool -> { v, t, p }

/** Сбросить кэш сделок пула — следующий poolTrades() пойдёт за свежими данными. */
export function invalidateTrades(pool) {
  for (const k of [..._trades.keys()]) if (k === pool || k.startsWith(pool + ":")) _trades.delete(k);
}

// cur — валюта кривой для монет за ERC20 (quote-фабрика): { dec, virt }.
// Без cur — ETH-пул (18 знаков, виртуал VIRTUAL_ETH). Сабграф индексирует
// только ETH-фабрику, поэтому монеты за валюту читаем прямо из логов.
/** Прогрев страницы монеты при наведении на карточку: сделки и график
 *  подтягиваются заранее, клик открывает страницу уже с данными. */
const _prefetched = new Set();
export function prefetchToken(token) {
  const k = String(token || "").toLowerCase();
  if (!k || _prefetched.has(k)) return;
  _prefetched.add(k);
  const tk = (_tok.v || []).find((x) => (x.token || "").toLowerCase() === k);
  if (!tk?.pool) return;
  poolTrades(tk.pool, tk.q ? { dec: tk.q.dec, virt: tk.q.virt, token: tk.token } : null).catch(() => {});
}

export async function poolTrades(pool, cur = null) {
  // Кэш — по пулу И виртуалу: у монеты за валюту virt приходит с сетью позже
  // кэша (сначала 0) — иначе первый расчёт с виртуалом ETH-кривой оседал в кэше и
  // график монеты за AAPL показывал капу в разы меньше шапки.
  const key = cur ? `${pool}:${cur.virt || 0}:${cur.dec ?? 18}` : pool;
  const c = _trades.get(key);
  if (c?.v) {
    // мгновенный ответ + тихое обновление в фоне
    if (Date.now() - c.t > 10_000 && !c.p) {
      const p = _poolTradesFresh(pool, cur)
        .then((v) => { _trades.set(key, { v, t: Date.now(), p: null }); return v; })
        .catch(() => { _trades.set(key, { ...c, p: null }); return c.v; });
      _trades.set(key, { ...c, p });
    }
    return c.v;
  }
  if (c?.p) return c.p;
  const p = _poolTradesFresh(pool, cur)
    .then((v) => { _trades.set(key, { v, t: Date.now(), p: null }); return v; })
    .catch((e) => { _trades.set(key, { p: null }); throw e; });
  _trades.set(key, { p });
  return p;
}

async function _poolTradesSubgraph(pool) {
  const uf = (await subgraphHasUsd()) ? " usd feeUsd" : "";
  const d = await gql(`{ trades(first: 1000, orderBy: block, orderDirection: asc,
    where: { pool: "${pool.toLowerCase()}" }) {
    isBuy trader ethAmount tokenAmount fee timestamp block tx${uf} } }`);
  if (!d?.trades) throw new Error("no trades field");
  const VIRT = VIRTUAL_ETH, TOTAL = 1e9;
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
      usd: fixedUsd(l), feeUsd: fixedFeeUsd(l),
    });
    points.push({ i: trades.length, mcap: price * TOTAL, ts });
  }
  const res = { trades: trades.reverse(), points };
  if (res.trades.length > 0) res.now = Date.now();
  return res;
}

async function _poolTradesFresh(pool, cur = null) {
  if (cur) return _poolTradesRpc(pool, cur);
  try { return await _poolTradesSubgraph(pool); }
  catch (e) { return _poolTradesRpc(pool); }
}

// События Buy/Sell у quote-пула имеют ту же сигнатуру, что у ETH-пула
// (имена полей другие — quoteIn/quoteOut, но топик тот же), поэтому
// декодер общий; отличаются только знаки валюты и виртуальный резерв.
async function _poolTradesRpc(pool, cur = null) {
  const fromBlock = await recentFromBlock();
  const logs = await publicClient.getLogs({
    address: pool, events: tradeEvents, fromBlock, toBlock: "latest",
  });
  logs.sort((a, b) => (a.blockNumber === b.blockNumber
    ? Number(a.logIndex - b.logIndex) : Number(a.blockNumber - b.blockNumber)));
  // Кто на самом деле продавал через зап: tx → адрес продавца.
  const zapSeller = new Map();
  if (cur?.token && ZAP_ADDRESS) {
    try {
      const zl = await publicClient.getLogs({
        address: ZAP_ADDRESS, events: zapSoldEvent, args: { token: cur.token }, fromBlock, toBlock: "latest",
      });
      for (const l of zl) zapSeller.set(l.transactionHash, l.args.seller);
    } catch (e) { /* без запа — продавцом останется его адрес */ }
  }

  const VIRT = cur?.virt || VIRTUAL_ETH, TOTAL = 1e9;
  const D = 10 ** (cur?.dec ?? 18);
  let eth = 0, sold = 0;
  const trades = [];
  const points = [{ i: 0, mcap: (VIRT / TOTAL) * TOTAL }];
  for (const l of logs) {
    const isBuy = l.eventName === "Buy";
    const ethAmt = Number(isBuy ? l.args.ethIn : l.args.ethOut) / D;
    const tokAmt = Number(isBuy ? l.args.tokensOut : l.args.tokensIn) / 1e18;
    const fee = Number(l.args.fee) / D;
    if (isBuy) { eth += ethAmt; sold += tokAmt; }
    else { eth -= ethAmt + fee; sold -= tokAmt; }
    const price = (VIRT + eth) / (TOTAL - sold);
    trades.push({
      side: isBuy ? "buy" : "sell",
      addr: isBuy ? l.args.buyer : (zapSeller.get(l.transactionHash) || l.args.seller),
      eth: ethAmt, tokens: tokAmt, fee,
      block: l.blockNumber, tx: l.transactionHash,
    });
    points.push({ i: trades.length, mcap: price * TOTAL });
  }
  // Страховка: если стороной сделки всё ещё стоит зап (событие запа не
  // прочиталось), настоящий трейдер — отправитель транзакции. Иначе
  // держатели считались неверно: покупки на человеке, продажи на запе —
  // и у человека «висело» 4% эмиссии, которых у него нет.
  const zapL = String(ZAP_ADDRESS || "").toLowerCase();
  const fix = zapL ? trades.filter((tr) => String(tr.addr).toLowerCase() === zapL) : [];
  if (fix.length) {
    const byTx = new Map();
    await Promise.all([...new Set(fix.map((tr) => tr.tx))].map(async (h) => {
      try { const tx = await publicClient.getTransaction({ hash: h }); byTx.set(h, tx.from); } catch (e) { /* оставим как есть */ }
    }));
    for (const tr of fix) if (byTx.has(tr.tx)) tr.addr = byTx.get(tr.tx);
  }
  return { trades: trades.reverse(), points };
}


// ---------------------------------------------------------------- fee split
import { splitterAbi, feeSplitterAbi } from "./abi.js";

let splitCache = null;
// Куда идёт комиссия 1% — по обеим фабрикам. Для каждой: creator — доля
// создателя в пуле; если казна фабрики — FeeSplitterV4, остаток делится
// на team / agent, и без ИИ доля агента возвращается создателю
// (creatorNoAi). Старая схема (ETH-фабрика со сплиттером выкупа):
// creator / team / buyback, агента нет, creatorNoAi = creator.
async function splitFor(shareBps, treasury) {
  const creator = Number(shareBps) / 100;
  const rest = 100 - creator;
  if (SPLITTER_LIVE && treasury.toLowerCase() === FEE_SPLITTER_ADDRESS.toLowerCase()) {
    const teamBps = await publicClient.readContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "teamShareBps" });
    // V5 — часть входящего уходит казне арены; у V4 такой функции нет — 0
    const arenaBps = await publicClient.readContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "arenaShareBps" }).catch(() => 0n);
    // V6 — треть остатка уходит казне выкупа монеты hood; у V5 такой функции нет — 0
    const buybackBps = await publicClient.readContract({ address: FEE_SPLITTER_ADDRESS, abi: feeSplitterAbi, functionName: "buybackShareBps" }).catch(() => 0n);
    const team = (rest * Number(teamBps)) / 10000;
    const arena = (rest * Number(arenaBps)) / 10000;
    const buyback = (rest * Number(buybackBps)) / 10000;
    const agent = Math.max(0, rest - team - arena - buyback);
    return { creator, team: +team.toFixed(1), arena: +arena.toFixed(1), agent: +agent.toFixed(1), buyback: +buyback.toFixed(1), creatorNoAi: +(creator + agent).toFixed(1), live: true };
  }
  let team = 0;
  try {
    const teamBps = await publicClient.readContract({ address: treasury, abi: splitterAbi, functionName: "teamBps" });
    team = (rest * Number(teamBps)) / 10000;
  } catch (e) {
    // Казна — не сплиттер, а обычный кошелёк (у фабрики за валюту до
    // переезда это кошелёк команды): весь остаток — команде.
    team = rest;
  }
  return { creator, team: Math.round(team), arena: 0, agent: 0, buyback: Math.round(rest - team), creatorNoAi: creator, live: false };
}

async function splitOf(factory, fAbi) {
  const [shareBps, treasury] = await Promise.all([
    publicClient.readContract({ address: factory, abi: fAbi, functionName: "creatorFeeShareBps" }),
    publicClient.readContract({ address: factory, abi: fAbi, functionName: "treasury" }),
  ]);
  const cur = await splitFor(shareBps, treasury);
  // У фабрики с таймлоком может висеть заявка на новые доли: показываем,
  // что будет и когда, — но монета, созданная до этого, остаётся на текущих.
  try {
    const p = await publicClient.readContract({ address: factory, abi: fAbi, functionName: "pendingConfig" });
    if (p && p[4] > 0n) cur.pending = { ...(await splitFor(p[3], p[0])), readyAt: Number(p[4]) * 1000 };
  } catch (e) { /* без таймлока — заявки нет */ }
  return cur;
}

export async function loadSplit() {
  if (splitCache) return splitCache;
  const fallback = { creator: 50, team: 20, buyback: 30, agent: 0, creatorNoAi: 50, live: false };
  let eth = fallback, q = null;
  try { eth = await splitOf(FACTORY_ADDRESS, factoryAbi); } catch (e) { /* оставляем запасные цифры */ }
  if (QUOTE_LIVE) {
    try { q = await splitOf(QUOTE_FACTORY_ADDRESS, quoteFactoryAbi); } catch (e) { q = { ...fallback, buyback: 50, team: 0 }; }
  }
  splitCache = { ...eth, q: q || eth };
  return splitCache;
}

export function useSplit() {
  const [split, setSplit] = useState({ creator: 50, team: 20, buyback: 30, agent: 0, creatorNoAi: 50, live: false,
    q: { creator: 50, team: 0, buyback: 50, agent: 0, creatorNoAi: 50, live: false } });
  useEffect(() => { loadSplit().then(setSplit).catch(() => {}); }, []);
  return split;
}

// ---------------------------------------------------------------- «подушка выкупа»
// Сколько ETH казна потратила на выкуп каждого токена (+ общий счётчик)
// и сколько токенов сожгла. Источник — treasuryOps из Goldsky, SWR-кэш.
let _sup = { v: null, t: 0, p: null };
const SUP_LS = "hood_cache_support_v3_" + FACTORY_ADDRESS.slice(2, 10);
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

/** enabled=false — казна выкупа выключена (FEATURES.treasury): в сеть не ходим,
 *  «выкуп казны» на карточках и странице монеты не показывается. */
export function useSupport(enabled = true) {
  const [sup, setSup] = useState(enabled ? (_sup.v ?? { per: {}, totalEth: 0 }) : { per: {}, totalEth: 0 });
  useEffect(() => { if (enabled) loadSupport().then(setSup).catch(() => {}); }, [enabled]);
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
  // обозреватель за Cloudflare отвечает по 5–9 с — не ждём дольше 4 с на запрос
  const a = await fetch(`${EXPLORER}/api/v2/addresses/${addr}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
  const tx = a.creation_tx_hash || a.creation_transaction_hash;
  if (!tx) return null;
  const t = await fetch(`${EXPLORER}/api/v2/transactions/${tx}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
  return t.timestamp ? new Date(t.timestamp).getTime() : null;
}

/** Даты создания из индексатора — одним запросом, быстро. Нет — {}. */
async function creationTimesViaSubgraph(keys) {
  const ids = keys.map((k) => `"${k}"`).join(",");
  const d = await gql(`{ tokens(first: ${keys.length}, where: { id_in: [${ids}] }) { id createdAt } }`);
  const out = {};
  for (const t of d?.tokens || []) if (Number(t.createdAt) > 0) out[t.id.toLowerCase()] = Number(t.createdAt) * 1000;
  return out;
}

export async function loadCreationTimes(addrs) {
  const out = {};
  const missing = [];
  for (const addr of addrs) {
    const k = addr.toLowerCase();
    const c = cacheGet(k);
    if (c) out[k] = c; else missing.push(k);
  }
  // сначала индексатор: один быстрый запрос на все адреса
  if (missing.length) {
    try {
      const sg = await creationTimesViaSubgraph(missing);
      for (const k of Object.keys(sg)) { out[k] = sg[k]; cacheSet(k, sg[k]); }
    } catch (e) { /* индексатор недоступен — ниже обозреватель и события */ }
  }
  const viaExplorer = missing.filter((k) => !out[k]);
  await Promise.all(viaExplorer.map(async (k) => {
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
  let lang = "ru";
  try { lang = localStorage.getItem("hood_lang") || "ru"; } catch (e) { /* ignore */ }
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (lang === "zh") {
    if (s < 15) return "刚刚";
    if (s < 60) return `${Math.floor(s)}秒前`;
    if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
    return `${Math.floor(s / 86400)}天前`;
  }
  const en = lang === "en";
  const ago = en ? "ago" : "назад";
  if (s < 15) return en ? "just now" : "только что";
  if (s < 60) return `${Math.floor(s)}${en ? "s" : "с"} ${ago}`;
  if (s < 3600) return `${Math.floor(s / 60)}${en ? "m" : "м"} ${ago}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${en ? "h" : "ч"} ${ago}`;
  return `${Math.floor(s / 86400)}${en ? "d" : "д"} ${ago}`;
}
