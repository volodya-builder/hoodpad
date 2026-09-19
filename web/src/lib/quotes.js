// Валюты курвы, кроме нативного ETH: чем ещё можно оплачивать монету.
//
// Два источника, и у каждого своя роль.
//
// 1. КАТАЛОГ — что вообще есть в сети. Берём у обозревателя (Blockscout):
//    он знает про все ERC20 сети, их знаки, курс, оборот и логотип, и сам
//    помечает мусор (reputation). Список живой: вбивать руками адреса
//    600 токенов — верный способ показать мёртвое и не показать живое.
//
// 2. БЕЛЫЙ СПИСОК — за что реально можно запустить. Лежит в самой фабрике
//    (LaunchpadFactoryQuote.allowedQuotes) и ставится только владельцем.
//    Это не бюрократия: валюта с комиссией на перевод или ребейзом ломает
//    расчёт кривой и запирает чужие деньги в пуле. Поэтому каталог —
//    для поиска, а решает белый список. Форма показывает и то и другое
//    честно: «можно» и «пока нельзя», а не одно вместо другого.

import { publicClient } from "./web3.js";
import { quoteFactoryAbi, erc20Abi, zapAbi } from "./abi.js";
import { EXPLORER, QUOTE_FACTORY_ADDRESS, QUOTE_LIVE, ZAP_ADDRESS, ZAP_LIVE, WETH_ADDRESS } from "./config.js";

const isStock = (t) => /Robinhood Token/i.test(t?.name || "");
const num = (x) => Number(x || 0);

/** Одна валюта в том виде, с которым работает форма. */
const shape = (t) => ({
  addr: String(t.address_hash || t.address || "").toLowerCase(),
  sym: String(t.symbol || "?").toUpperCase(),
  name: t.name || "",
  dec: Number(t.decimals ?? 18),
  icon: t.icon_url || "",
  price: num(t.exchange_rate),
  holders: num(t.holders_count ?? t.holders),
  volume: num(t.volume_24h),
});

/**
 * Крипто-валюты сети, самые оборотистые сверху. Акции сюда не попадают —
 * у них своя вкладка и свой канонический список (rwa.js).
 *
 * Фильтр по обороту и репутации — не снобизм: валюта курвы должна быть
 * тем, что люди реально держат и меняют, иначе цена монеты будет
 * привязана к пустоте.
 */
const CRYPTO_LS = "hood_crypto_quotes_v1";
const CRYPTO_TTL = 24 * 3600_000;
let _cryptoP = null;
export async function loadCryptoQuotes(limit = 60, onProgress) {
  if (!EXPLORER) return [];
  // Обозреватель отвечает по 1–3 с на страницу, а список валют меняется
  // редко: держим его сутки в localStorage и отдаём сразу, обновляя в фоне.
  let cached = null;
  try { const v = JSON.parse(localStorage.getItem(CRYPTO_LS) || "null"); if (v && Array.isArray(v.list) && v.list.length) cached = v; } catch (e) { /* ignore */ }
  if (cached) {
    // есть кэш — отдаём сразу; протух (старше суток) — обновляем в фоне и
    // досылаем свежий список через onProgress
    const stale = Date.now() - (cached.t || 0) > CRYPTO_TTL;
    if (stale && !_cryptoP) _cryptoP = _loadCryptoQuotesNet(limit, null).then((list) => { _cryptoP = null; if (list.length) onProgress?.(list); return list; });
    return cached.list.slice(0, limit);
  }
  return _cryptoP || (_cryptoP = _loadCryptoQuotesNet(limit, onProgress).then((list) => { _cryptoP = null; return list; }));
}
async function _loadCryptoQuotesNet(limit, onProgress) {
  const out = [];
  let url = `${EXPLORER}/api/v2/tokens?type=ERC-20`;
  const snapshot = () => [...out].sort((a, b) => b.volume - a.volume).slice(0, limit);
  const remember = (list) => { try { if (list.length) localStorage.setItem(CRYPTO_LS, JSON.stringify({ t: Date.now(), list })); } catch (e) { /* ignore */ } };
  try {
    // Страницы у обозревателя курсорные, читать можно только по очереди.
    // Поэтому отдаём результат по мере чтения: первая страница — это уже
    // WETH, USDG и прочие крупные, и ждать остальные пять незачем.
    for (let page = 0; page < 4 && url; page++) {
      const j = await fetch(url, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null));
      if (!j) break;
      for (const t of j.items || []) {
        if (isStock(t) || t.reputation !== "ok" || !(num(t.exchange_rate) > 0)) continue;
        out.push(shape(t));
      }
      if (onProgress) onProgress(snapshot());
      if (!j.next_page_params) break;
      url = `${EXPLORER}/api/v2/tokens?type=ERC-20&${new URLSearchParams(j.next_page_params)}`;
    }
  } catch { /* обозреватель лёг — вернём что успели */ }
  const list = snapshot();
  remember(list);
  return list;
}

/**
 * Что показать до поиска. Когда фабрика живая — её белый список, и только
 * он: витрина обещает ровно то, за что можно запустить. Пока фабрики нет —
 * те же валюты, что пойдут в белый список (scripts/deploy-quote.js), чтобы
 * витрина не менялась в день деплоя; следом — остальное по обороту.
 *
 * PLANNED дублирует список из скрипта деплоя, и это осознанно: после
 * деплоя источник правды — сама фабрика, а этот список станет запасным.
 */
export const PLANNED = ["WETH", "USDG", "USDE", "CBBTC", "LINK", "TAO", "PENDLE", "VIRTUAL"];

export function featuredQuotes(list, allowed, limit = 11) {
  const rows = list || [];
  const rank = (q) => { const i = PLANNED.indexOf(q.sym); return i < 0 ? 99 : i; };
  if (allowed && allowed.size) {
    // Витрина — только курируемый список (PLANNED) в его порядке; всё
    // остальное из белого списка (ZFORGE, PENGU, JOHN…) доступно через поиск
    // (владелец 19.09.2026: «неправильный список крипты»).
    return rows.filter((q) => allowed.has(q.addr) && PLANNED.includes(q.sym))
      .sort((a, b) => rank(a) - rank(b)).slice(0, limit);
  }
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.volume - a.volume).slice(0, limit);
}

/** Одна валюта по адресу — для поля «свой контракт». */
export async function lookupQuote(addr) {
  const a = String(addr || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return null;
  // Сначала обозреватель: там есть логотип и курс.
  try {
    const t = await fetch(`${EXPLORER}/api/v2/tokens/${a}`).then((r) => (r.ok ? r.json() : null));
    if (t && t.type === "ERC-20") return { ...shape(t), addr: a.toLowerCase(), stock: isStock(t) };
  } catch { /* дальше — цепь */ }
  // Обозреватель не знает — спрашиваем сам контракт. Нет decimals — не ERC20.
  try {
    const [sym, name, dec] = await Promise.all([
      publicClient.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({ address: a, abi: erc20Abi, functionName: "name" }).catch(() => ""),
      publicClient.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { addr: a.toLowerCase(), sym: String(sym).toUpperCase(), name, dec: Number(dec), icon: "", price: 0, holders: 0, volume: 0, stock: false };
  } catch { return null; }
}

/**
 * Белый список фабрики: адреса валют, за которые запуск реально пройдёт.
 * Фабрика не задеплоена — список пуст, и форма об этом скажет.
 */
/** null — сеть не ответила (вызывающий оставит прошлый список), Set — ответ. */
export async function loadAllowedQuotes() {
  if (!QUOTE_LIVE) return new Set();
  // Полторы сотни вызовов; узел иногда обрывает пачку на середине — тогда
  // вкладка «Акции» была пустой. Три попытки, и ошибка — это null, а не пусто.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const n = Number(await publicClient.readContract({
        address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "allowedQuotesCount",
      }));
      const addrs = await Promise.all(Array.from({ length: n }, (_, i) =>
        publicClient.readContract({ address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "allowedQuotes", args: [BigInt(i)] })
      ));
      // allowed могли выключить через setQuote(false) — массив это не чистит,
      // поэтому сверяемся с конфигом каждой.
      const cfgs = await Promise.all(addrs.map((q) =>
        publicClient.readContract({ address: QUOTE_FACTORY_ADDRESS, abi: quoteFactoryAbi, functionName: "quoteConfig", args: [q] })
      ));
      return new Set(addrs.filter((q, i) => cfgs[i]?.[0]).map((q) => q.toLowerCase()));
    } catch (e) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
  }
  return null;
}

/** Поиск по чипам: тикер, название, адрес. */
export const matchQuote = (q, s) => {
  const x = String(s || "").trim().toLowerCase();
  if (!x) return true;
  return `${q.sym} ${q.name} ${q.addr}`.toLowerCase().includes(x);
};

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * Какие валюты из белого списка можно купить за ETH через zap. Монета, которую
 * нельзя купить за ETH, — мёртвая монета: у покупателя на кошельке ETH, а не
 * TAO. Поэтому форма запуска предлагает только эти валюты. WETH — всегда.
 * Zap не задеплоен — считаем, что умеет всё (ограничивать нечем).
 */
export async function loadZapQuotes(allowed) {
  const list = [...(allowed || [])];
  if (!ZAP_LIVE) return new Set(list);
  const ok = new Set();
  await Promise.all(list.map(async (q) => {
    if (q === WETH_ADDRESS.toLowerCase()) { ok.add(q); return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const has = await publicClient.readContract({ address: ZAP_ADDRESS, abi: zapAbi, functionName: "hasRoute", args: [q] });
        if (has) ok.add(q);
        break;
      } catch { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
    }
  }));
  return ok;
}
