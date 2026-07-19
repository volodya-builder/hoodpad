import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  numberToHex,
} from "viem";
import { CHAIN, RPC_URLS } from "./config.js";

// Устойчивый транспорт: несколько RPC с автопереключением при сбое.
// Каждый эндпоинт повторяет запрос до 4 раз с нарастающей паузой, ждёт до 20с,
// и склеивает параллельные вызовы в пакеты (batch). Если один RPC лёг —
// viem сам уходит на следующий, а через минуту снова пробует основной.
const rpcTransport = fallback(
  RPC_URLS.map((url) =>
    http(url, {
      batch: { wait: 16, batchSize: 20 },
      timeout: 20_000,
      retryCount: 4,
      retryDelay: 400,
    })
  ),
  { rank: false, retryCount: 2 }
);

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: rpcTransport,
});

// ---------------------------------------------------------------- providers
// EIP-6963 multi-wallet discovery: in browsers with several wallet
// extensions, window.ethereum may be hijacked by a non-MetaMask wallet.
// We collect announced providers and prefer MetaMask explicitly.
const discovered = [];
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    if (e.detail?.provider) discovered.push(e.detail);
  });
  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch (e) { /* ignore */ }
}

export function pickProvider() {
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

const isMobile = () =>
  typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

export async function connectWallet() {
  const provider = pickProvider();
  if (!provider) {
    if (isMobile()) {
      // На телефоне MetaMask — приложение, а не расширение браузера.
      // Открываем сайт внутри встроенного браузера MetaMask через deep link:
      // там window.ethereum есть, и подключение работает как на компьютере.
      const target = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.hash}`;
      window.location.href = target;
      throw new Error("Открываю сайт в приложении MetaMask… Если ничего не произошло — установите MetaMask из App Store / Google Play.");
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

export function fmtEth(n) {
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
