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
import { quoteFactoryAbi, erc20Abi } from "./abi.js";
import { EXPLORER, QUOTE_FACTORY_ADDRESS, QUOTE_LIVE } from "./config.js";

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
export async function loadCryptoQuotes(limit = 40) {
  if (!EXPLORER) return [];
  const out = [];
  let url = `${EXPLORER}/api/v2/tokens?type=ERC-20`;
  try {
    for (let page = 0; page < 6 && url; page++) {
      const j = await fetch(url).then((r) => (r.ok ? r.json() : null));
      if (!j) break;
      for (const t of j.items || []) {
        if (isStock(t) || t.reputation !== "ok" || !(num(t.exchange_rate) > 0)) continue;
        out.push(shape(t));
      }
      if (!j.next_page_params) break;
      url = `${EXPLORER}/api/v2/tokens?type=ERC-20&${new URLSearchParams(j.next_page_params)}`;
    }
  } catch { /* обозреватель лёг — вернём что успели */ }
  out.sort((a, b) => b.volume - a.volume);
  return out.slice(0, limit);
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
export async function loadAllowedQuotes() {
  if (!QUOTE_LIVE) return new Set();
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
  } catch { return new Set(); }
}

/** Поиск по чипам: тикер, название, адрес. */
export const matchQuote = (q, s) => {
  const x = String(s || "").trim().toLowerCase();
  if (!x) return true;
  return `${q.sym} ${q.name} ${q.addr}`.toLowerCase().includes(x);
};

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
