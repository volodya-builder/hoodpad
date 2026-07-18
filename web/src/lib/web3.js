import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  numberToHex,
} from "viem";
import { CHAIN } from "./config.js";

export const publicClient = createPublicClient({
  chain: CHAIN,
  // batch: true склеивает параллельные eth_call в пакетные JSON-RPC запросы —
  // вместо десятков HTTP-запросов уходит несколько.
  transport: http(undefined, { batch: true }),
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

export async function connectWallet() {
  const provider = pickProvider();
  if (!provider) {
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
