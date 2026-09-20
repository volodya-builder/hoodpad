import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  numberToHex,
} from "viem";
import { CHAIN, RPC_URLS, WC_PROJECT_ID } from "./config.js";

// ---------------------------------------------------------------- RPC-шлюз
// Аудит 19.09.2026, один корень всех «то так, то сяк»: узлы режут по числу
// JSON-RPC-вызовов. Публичный узел сети (замер): чтения состояния (eth_call,
// балансы, блоки, транзакции, логи) — около сотни залпом, дальше десятки в
// секунду и лимит плавает; не больше ~25 вызовов в одной пачке; залп
// одновременных запросов режется отдельно. Сверх этого — 429 (с двойным
// CORS-заголовком, в браузере это «CORS error» / «Failed to fetch»).
// Alchemy — 429 внутри JSON. Страница монеты выстреливала 400–700 вызовов
// разом: половина падала, и каждое место сайта молча брало старое или
// пустое значение.
// Лечение в одном месте: (1) чтения контрактов клеятся в один eth_call через
// Multicall3 (batch.multicall ниже) — сотни вызовов становятся единицами;
// (2) этот шлюз ведёт бюджет вызовов по каждому узлу (скорость подстраивается:
// на 429 — вдвое меньше, на серии удач — чуть больше), ставит лишнее в
// очередь по важности (цены и логи раньше, отправители транзакций позже),
// на 429 переключает узел или ждёт, мёртвый узел обходит с растущей паузой;
// (3) отправитель tx и время блока — в памяти браузера навсегда
// (txSenderOf/blockTimeOf ниже), повторный заход их не читает.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NODES = RPC_URLS.map((url) => {
  const alchemy = /alchemy\.com/i.test(url);
  // стартовые оценки; дальше узел сам подстраивает refill (вызовов в секунду)
  const cap = alchemy ? 40 : 60, refill = alchemy ? 12 : 30;
  return { url, alchemy, cap, refill, minRefill: 12, maxRefill: alchemy ? 60 : 80, tokens: cap, at: Date.now(), penaltyUntil: 0, fails: 0, okStreak: 0 };
});
const MAX_IN_FLIGHT = 4;   // одновременных HTTP-запросов ко всем узлам (публичный режет от ~8)
const ATTEMPT_MS = 8_000;  // одна попытка к одному узлу
const ATTEMPTS = 5;
const gwQueue = [];        // { url, init, need, attempt, resolve, reject }
let gwActive = 0, gwTimer = null;

function refillNode(n) {
  const now = Date.now();
  n.tokens = Math.min(n.cap, n.tokens + ((now - n.at) / 1000) * n.refill);
  n.at = now;
}
/** Первый по порядку узел, у которого есть бюджет; иначе — сколько ждать. */
function pickNode(need) {
  const now = Date.now();
  let wait = 1500;
  for (const n of NODES) {
    if (n.penaltyUntil > now) { wait = Math.min(wait, n.penaltyUntil - now); continue; }
    refillNode(n);
    if (n.tokens >= need) return { node: n };
    wait = Math.min(wait, ((need - n.tokens) / n.refill) * 1000);
  }
  return { wait: Math.max(40, wait) };
}
/** Сколько вызовов в теле и насколько они срочны: 0 — цены/логи/номер блока
 *  (то, что видно сразу), 1 — блоки (время сделок), 2 — отправители
 *  транзакций (имена в таблице сделок). */
function classify(body) {
  let need = 1, prio = 0;
  try {
    const b = JSON.parse(body);
    const arr = Array.isArray(b) ? b : [b];
    need = Math.max(1, arr.length);
    const m = arr[0]?.method || "";
    prio = m === "eth_getTransactionByHash" ? 2 : m === "eth_getBlockByNumber" ? 1 : 0;
  } catch (e) { /* ignore */ }
  return { need, prio };
}
function penalize(n, ms) {
  n.tokens = 0;
  n.okStreak = 0;
  n.refill = Math.max(n.minRefill, n.refill * 0.75);  // узел сказал «много» — сбавляем
  n.penaltyUntil = Math.max(n.penaltyUntil, Date.now() + ms);
}
function reward(n) {
  n.fails = 0;
  n.okStreak += 1;
  if (n.okStreak % 5 === 0) n.refill = Math.min(n.maxRefill, n.refill + 4); // всё живо — прибавляем
}
const looksRateLimited = async (res) => {
  if (res.status === 429) return true;
  if (!res.ok) return false;
  try { const txt = await res.clone().text(); return /"code"\s*:\s*429\b/.test(txt); } catch (e) { return false; }
};
async function gwSend(job, node) {
  const { init } = job;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  init.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctl.abort(), ATTEMPT_MS);
  try {
    const res = await fetch(node.url, { ...init, signal: ctl.signal });
    if (await looksRateLimited(res)) {
      // узел перегружен: бюджет в ноль, пауза растёт с повторами
      penalize(node, 800 * (job.attempt + 1));
      return { retry: true, err: new Error(`RPC 429: ${node.url}`) };
    }
    reward(node);
    return { res };
  } catch (e) {
    if (init.signal?.aborted) return { err: e };           // отменил viem (таймаут сверху) — не повторяем
    const timedOut = ctl.signal.aborted;
    // публичный узел на 429 отвечает с двойным CORS — браузер бросает TypeError;
    // у Alchemy сетевой отказ — узел закрыт/не оплачен: обходим с растущей паузой
    node.fails += 1;
    const base = timedOut ? 10_000 : node.alchemy ? 5_000 : 800;
    penalize(node, Math.min(60_000, base * Math.pow(2, Math.min(node.fails - 1, 4))));
    return { retry: true, err: e };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}
function gwPump() {
  if (gwTimer) { clearTimeout(gwTimer); gwTimer = null; }
  while (gwActive < MAX_IN_FLIGHT && gwQueue.length) {
    const job = gwQueue[0];
    if (job.init.signal?.aborted) { gwQueue.shift(); job.reject(job.lastErr || new Error("aborted")); continue; }
    const pick = pickNode(job.need);
    if (!pick.node) { gwTimer = setTimeout(gwPump, pick.wait); return; }
    gwQueue.shift();
    pick.node.tokens -= job.need;
    gwActive += 1;
    gwSend(job, pick.node).then((r) => {
      gwActive -= 1;
      if (r.res) { job.resolve(r.res); }
      else if (r.retry && job.attempt + 1 < ATTEMPTS && !job.init.signal?.aborted) {
        job.attempt += 1; job.lastErr = r.err;
        gwQueue.unshift(job);   // повтор — первым в очереди, на живой узел
      } else job.reject(r.err);
      gwPump();
    });
  }
}
/** fetch для viem: всё через очередь и бюджеты узлов. Адрес от viem не важен — узел выбирает шлюз. */
function gatewayFetch(url, init) {
  return new Promise((resolve, reject) => {
    const { need, prio } = classify(init?.body);
    const job = { url, init: init || {}, need, prio, attempt: 0, lastErr: null, resolve, reject };
    // по важности, внутри одной важности — по порядку
    let i = gwQueue.length;
    while (i > 0 && gwQueue[i - 1].prio > prio) i -= 1;
    gwQueue.splice(i, 0, job);
    gwPump();
  });
}

const rpcTransport = http(RPC_URLS[0], {
  // пачки JSON-RPC: не больше 20 вызовов (публичный узел режет от ~40)
  batch: { wait: 12, batchSize: 20 },
  fetchFn: gatewayFetch,
  // таймаут viem покрывает и ожидание в очереди — щедрый; быстрый отвал от
  // мёртвого узла делает шлюз сам (ATTEMPT_MS и пауза узла)
  timeout: 30_000,
  retryCount: 0,
});

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: rpcTransport,
  // чтения контрактов одного тика — одним eth_call через Multicall3
  // (адрес — в defineChain, config.js); ~4 КБ calldata ≈ 40 чтений в пачке
  batch: { multicall: { wait: 8, batchSize: 4096 } },
});

// ---------------------------------------------------------------- вечные кэши
// Отправитель транзакции и время блока не меняются никогда — держим в памяти
// браузера (localStorage), чтобы каждая страница не тянула их заново.
function persistentMap(key, cap) {
  let map = null, timer = null;
  const load = () => {
    if (map) return map;
    try { map = JSON.parse(localStorage.getItem(key) || "{}"); if (!map || typeof map !== "object") map = {}; }
    catch (e) { map = {}; }
    return map;
  };
  const flush = () => {
    timer = null;
    try {
      const keys = Object.keys(map);
      if (keys.length > cap) { const keep = keys.slice(-Math.floor(cap / 2)); const m = {}; for (const k of keep) m[k] = map[k]; map = m; }
      localStorage.setItem(key, JSON.stringify(map));
    } catch (e) { /* нет места — не страшно */ }
  };
  return {
    get: (k) => load()[k],
    set: (k, v) => { load()[k] = v; if (!timer) timer = setTimeout(flush, 500); },
  };
}
const txSenders = persistentMap("hood_txfrom_v1", 3000);
const blockTimes = persistentMap("hood_blockts_v1", 6000);
const _txP = new Map(), _blkP = new Map();
/** Кошелёк, отправивший транзакцию (в нижнем регистре); null — не узнали. */
export function txSenderOf(hash) {
  const h = String(hash || "").toLowerCase();
  const c = txSenders.get(h);
  if (c) return Promise.resolve(c);
  if (_txP.has(h)) return _txP.get(h);
  const p = publicClient.getTransaction({ hash: h })
    .then((tx) => { const a = String(tx.from).toLowerCase(); txSenders.set(h, a); return a; })
    .catch(() => null)
    .finally(() => _txP.delete(h));
  _txP.set(h, p);
  return p;
}
/** Время блока в миллисекундах; 0 — не узнали. */
export function blockTimeOf(blockNumber) {
  const k = String(blockNumber);
  const c = blockTimes.get(k);
  if (c) return Promise.resolve(c);
  if (_blkP.has(k)) return _blkP.get(k);
  const p = publicClient.getBlock({ blockNumber: BigInt(k) })
    .then((b) => { const t = Number(b.timestamp) * 1000; if (t > 0) blockTimes.set(k, t); return t; })
    .catch(() => 0)
    .finally(() => _blkP.delete(k));
  _blkP.set(k, p);
  return p;
}


/** getLogs с повторами и делением диапазона: узел иногда отвечает отказом
 *  («HTTP request failed», лимит ответа) — тогда держатели, обмены и график
 *  считались с дыр. Три попытки; если не вышло — режем диапазон пополам. */
export async function getLogsSafe(params, depth = 0) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await publicClient.getLogs(params); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); }
  }
  const from = typeof params.fromBlock === "bigint" ? params.fromBlock : null;
  let to = params.toBlock;
  if (from !== null && depth < 6) {
    if (typeof to !== "bigint") to = await publicClient.getBlockNumber();
    if (to - from > 2000n) {
      const mid = from + (to - from) / 2n;
      const [a, b] = await Promise.all([
        getLogsSafe({ ...params, fromBlock: from, toBlock: mid }, depth + 1),
        getLogsSafe({ ...params, fromBlock: mid + 1n, toBlock: to }, depth + 1),
      ]);
      return [...a, ...b];
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- providers
// EIP-6963 multi-wallet discovery: in browsers with several wallet
// extensions, window.ethereum may be hijacked by a non-MetaMask wallet.
// We collect announced providers; the user picks one in the wallet modal
// (components/WalletModal.jsx), the choice is remembered.
const walletId = (d) => d.info?.rdns || d.info?.name || ""; // до слушателя: кошельки отвечают синхронно
const discovered = [];
const LS_WALLET = "hood.wallet"; // id кошелька, который выбрал пользователь (rdns или "appkit")
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = e.detail;
    if (!d?.provider) return;
    // расширения объявляются повторно на каждый requestProvider — без дублей
    if (discovered.some((x) => walletId(x) === walletId(d))) return;
    discovered.push(d);
  });
  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch (e) { /* ignore */ }
}

// Известные кошельки (17.09.2026): порядок в окне выбора, ссылки на установку
// и deep link в приложение на телефоне (сайт откроется во встроенном браузере
// кошелька, где есть window.ethereum). Иконки не рисуем — берём те, что
// объявляет само расширение (EIP-6963); у неустановленных — буква.
const dappUrl = () => `${window.location.host}${window.location.pathname}${window.location.hash}`;
const fullUrl = () => window.location.href;
export const KNOWN_WALLETS = [
  { id: "metamask", name: "MetaMask", match: /metamask/i, install: "https://metamask.io/download/", mobile: () => `https://metamask.app.link/dapp/${dappUrl()}` },
  { id: "okx", name: "OKX Wallet", match: /okx|okex/i, install: "https://www.okx.com/download", mobile: () => `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(fullUrl())}`)}` },
  { id: "rabby", name: "Rabby", match: /rabby/i, install: "https://rabby.io/", mobile: null },
  { id: "coinbase", name: "Coinbase Wallet", match: /coinbase/i, install: "https://www.coinbase.com/wallet/downloads", mobile: () => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(fullUrl())}` },
  { id: "trust", name: "Trust Wallet", match: /trust/i, install: "https://trustwallet.com/download", mobile: () => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(fullUrl())}` },
  { id: "phantom", name: "Phantom", match: /phantom/i, install: "https://phantom.com/download", mobile: () => `https://phantom.app/ul/browse/${encodeURIComponent(fullUrl())}?ref=${encodeURIComponent(window.location.origin)}` },
];
const knownOf = (d) => KNOWN_WALLETS.find((k) => k.match.test(`${d.info?.rdns || ""} ${d.info?.name || ""}`)) || null;

/** Кошельки, которые объявились в браузере (EIP-6963): [{rdns, name, icon, known}], известные — первыми. */
export function listWallets() {
  const rows = discovered.map((d) => ({ rdns: walletId(d), name: d.info?.name || "Wallet", icon: d.info?.icon || "", known: knownOf(d)?.id || "" }));
  const rank = (r) => { const i = KNOWN_WALLETS.findIndex((k) => k.id === r.known); return i < 0 ? 99 : i; };
  return rows.sort((a, b) => rank(a) - rank(b));
}
/** Известные кошельки, которых в браузере нет (для «Установить» / «Открыть в приложении»). */
export function missingWallets() {
  const have = new Set(listWallets().map((w) => w.known).filter(Boolean));
  return KNOWN_WALLETS.filter((k) => !have.has(k.id));
}
/** Какой кошелёк выбрал пользователь — "" если не выбирал. */
export function preferredWallet() {
  try { return localStorage.getItem(LS_WALLET) || ""; } catch (e) { return ""; }
}
export function setPreferredWallet(id) {
  try { id ? localStorage.setItem(LS_WALLET, id) : localStorage.removeItem(LS_WALLET); } catch (e) { /* ignore */ }
}
const byId = (rdns) => discovered.find((d) => walletId(d) === rdns) || null;

export function pickProvider() {
  // 1) кошелёк, который человек выбрал сам (OKX с Ledger, Rabby…)
  const want = preferredWallet();
  if (want && want !== "appkit") { const d = byId(want); if (d) return d.provider; }
  // 2) иначе MetaMask, как раньше
  const mm = discovered.find((d) => /metamask/i.test(d.info?.name || ""));
  if (mm) return mm.provider;
  if (discovered.length) return discovered[0].provider;
  if (window.ethereum?.providers?.length) {
    const p = window.ethereum.providers.find((x) => x.isMetaMask);
    if (p) return p;
  }
  return window.ethereum ?? null;
}

export function hasWallet() {
  return typeof window !== "undefined" && (discovered.length > 0 || !!window.ethereum);
}

export const isMobile = () =>
  typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

// ---------------------------------------------------------------- Reown AppKit
// Полное окно кошельков (расширения, WalletConnect по QR, реестр 540+ с
// поиском, Ledger Live) — lib/appkit.js, грузится только по клику или при
// тихом восстановлении сессии. Без Project ID — простое окно WalletModal.
export const hasAppKit = () => /^[0-9a-f]{32}$/i.test(WC_PROJECT_ID);
let _ak = null;
// Не загрузился (оборвалась сеть на телефоне, реле WalletConnect не ответило) —
// забываем неудачу, иначе «Подключить» до перезагрузки страницы молча не работает.
const appkit = () => _ak || (_ak = import("./appkit.js").catch((e) => { _ak = null; throw e; }));

/** Отключить кошелёк, подключённый через AppKit (в т.ч. сессию WalletConnect). */
export async function disconnectWallet(wallet) {
  if (!wallet?.appkit) return;
  try { const ak = await appkit(); await ak.disconnectAll(); } catch (e) { /* ignore */ }
}

export async function connectWallet(opts = {}) {
  if (hasAppKit() && !opts.rdns) {
    const ak = await appkit();
    const w = await ak.connect();
    try { await ensureChain(w.provider); } catch (e) { /* сеть добавится при первой транзакции */ }
    setPreferredWallet("appkit");
    return w;
  }
  let provider = null;
  if (opts.rdns) {
    const d = byId(opts.rdns);
    if (!d) throw new Error("Кошелёк не найден. Обновите страницу.");
    provider = d.provider;
    setPreferredWallet(opts.rdns);
  } else {
    provider = pickProvider();
  }
  if (!provider) {
    if (isMobile()) {
      // На телефоне MetaMask — приложение, а не расширение браузера.
      // Молча уводим сайт во встроенный браузер MetaMask через deep link:
      // там window.ethereum есть, и подключение работает как на компьютере.
      const target = `https://metamask.app.link/dapp/${dappUrl()}`;
      window.location.href = target;
      return new Promise(() => {}); // навигация заберёт управление, алертов не показываем
    }
    throw new Error("Кошелёк не найден. Установите MetaMask и обновите страницу.");
  }
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  await ensureChain(provider);
  const walletClient = createWalletClient({
    account,
    chain: CHAIN,
    transport: custom(provider),
  });
  return { account, walletClient, provider };
}

/** Тихое восстановление сессии после перезагрузки страницы: без попапов,
 *  через eth_accounts. Возвращает null, если кошелёк не давал доступ. */
export async function reconnectWallet() {
  // подключались через AppKit — он сам помнит кошелёк (и сессию WalletConnect)
  if (hasAppKit() && preferredWallet() === "appkit") {
    try { const ak = await appkit(); return await ak.restore(); } catch (e) { return null; }
  }
  // EIP-6963 объявления приходят асинхронно — подождём провайдера
  for (let i = 0; i < 10 && !pickProvider(); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const provider = pickProvider();
  if (!provider) return null;
  const accs = await provider.request({ method: "eth_accounts" });
  if (!accs || accs.length === 0) return null;
  try { await ensureChain(provider); } catch (e) { /* не блокируем восстановление */ }
  const walletClient = createWalletClient({
    account: accs[0],
    chain: CHAIN,
    transport: custom(provider),
  });
  return { account: accs[0], walletClient, provider };
}

export async function ensureChain(provider) {
  provider = provider || pickProvider();
  const current = await provider.request({ method: "eth_chainId" });
  if (parseInt(current, 16) === CHAIN.id) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: numberToHex(CHAIN.id) }],
    });
  } catch (e) {
    // 4902 = unknown chain -> add it
    if (e.code === 4902 || String(e.message).includes("4902")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: numberToHex(CHAIN.id),
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: CHAIN.rpcUrls.default.http,
            blockExplorerUrls: CHAIN.blockExplorers
              ? [CHAIN.blockExplorers.default.url]
              : [],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

export function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

export function fmt(n, digits = 4) {
  const x = Number(n);
  if (!isFinite(x)) return "0";
  if (x !== 0 && Math.abs(x) < 10 ** -digits) return `<${10 ** -digits}`;
  return x.toLocaleString("en-US", { maximumFractionDigits: digits });
}

// Компактная запись мелких чисел в крипто-стиле: 0.000000002 → 0.0₈2
const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const toSub = (n) => String(n).split("").map((d) => SUBS[+d]).join("");

// Суммы (балансы, комиссии, объёмы): мелочь меньше 0.01 не расписываем —
// «<0.01», глаз не цепляется (решение владельца 15.09.2026). Для цен за
// токен нужна точность — fmtEthFine оставляет запись с нижним индексом.
export function fmtEth(n) {
  const x = Number(n);
  if (!isFinite(x) || x === 0) return "0";
  if (Math.abs(x) < 0.01) return (x < 0 ? "-" : "") + "<0.01";
  return fmtEthFine(x);
}

export function fmtEthFine(n) {
  const x = Number(n);
  if (!isFinite(x) || x === 0) return "0";
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (a >= 1000) return sign + a.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return sign + a.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (a >= 0.001) return sign + a.toLocaleString("en-US", { maximumFractionDigits: 4 });
  // мелочь: считаем нули после запятой и сжимаем их в нижний индекс
  const zeros = Math.ceil(-Math.log10(a) - 1e-9) - 1; // 0.00015 → 3 нуля
  let digits = String(Math.round(a * 10 ** (zeros + 3))).replace(/0+$/, "");
  if (digits === "") digits = "1";
  if (zeros <= 2) return sign + a.toLocaleString("en-US", { maximumFractionDigits: zeros + 3 });
  return `${sign}0.0${toSub(zeros)}${digits}`;
}
