import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  numberToHex,
} from "viem";
import { CHAIN, RPC_URLS, WC_PROJECT_ID } from "./config.js";

// Устойчивый транспорт: несколько RPC с автопереключением при сбое.
// Урок 05.08.2026: Alchemy-эндпоинт отдавал 503, а старые настройки
// (retryCount 4 × timeout 20с × fallback retry 2) заставляли страницы
// «читать блокчейн» минутами, прежде чем уйти на живой публичный RPC.
// Теперь: быстрый отвал от больного эндпоинта (1 повтор, 8с) и
// авторанжирование — viem сам ставит первым тот RPC, что реально отвечает,
// и периодически перепроверяет остальные.
const rpcTransport = fallback(
  RPC_URLS.map((url) =>
    http(url, {
      batch: { wait: 16, batchSize: 20 },
      timeout: 8_000,
      retryCount: 1,
      retryDelay: 300,
    })
  ),
  { rank: { interval: 30_000, sampleCount: 5 }, retryCount: 1 }
);

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: rpcTransport,
});

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
