// ============================================================================
//  Окно кошельков Reown AppKit (17.09.2026, просьба владельца: «как у них —
//  все кошельки, 540+, с поиском, включая Ledger»).
//
//  Что даёт: установленные расширения (EIP-6963) со своими иконками,
//  WalletConnect по QR-коду / deep link для телефонных кошельков и Ledger
//  Live, «All wallets» — весь реестр WalletConnect с поиском и картинками.
//  Внутри — wagmi; наружу отдаём то же, что и раньше: { account, walletClient
//  (viem), provider (EIP-1193) }, поэтому остальной сайт ничего не заметил.
//
//  Модуль тяжёлый — грузится динамически (см. web3.js): при первом клике
//  «Подключить» или тихо после загрузки, если человек уже подключался.
//  Нужен Project ID (cloud.reown.com) → переменная GitHub WC_PROJECT_ID.
// ============================================================================
import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { defineChain } from "@reown/appkit/networks";
import { reconnect, getAccount, watchAccount, disconnect as wagmiDisconnect } from "@wagmi/core";
import { createWalletClient, custom } from "viem";
import { CHAIN, WC_PROJECT_ID as PROJECT_ID } from "./config.js";

const robinhood = defineChain({
  id: CHAIN.id,
  caipNetworkId: `eip155:${CHAIN.id}`,
  chainNamespace: "eip155",
  name: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [...CHAIN.rpcUrls.default.http] } },
  blockExplorers: CHAIN.blockExplorers ? { default: { name: CHAIN.blockExplorers.default.name, url: CHAIN.blockExplorers.default.url } } : undefined,
});

const isLight = () => document.documentElement.dataset.theme === "light";

const wagmiAdapter = new WagmiAdapter({ networks: [robinhood], projectId: PROJECT_ID, ssr: false });
export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const modal = createAppKit({
  adapters: [wagmiAdapter],
  networks: [robinhood],
  defaultNetwork: robinhood,
  projectId: PROJECT_ID,
  metadata: {
    name: "hood",
    description: "hood — launchpad on Robinhood Chain",
    url: window.location.origin,
    icons: [`${window.location.origin}/icon-192.png`],
  },
  // только кошельки: без почты, соцсетей, свопов, покупки крипты и истории
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, receive: false, history: false, emailShowWallets: false },
  allWallets: "SHOW",
  enableWalletGuide: false,
  enableNetworkSwitch: false,
  allowUnsupportedChain: true, // сеть переключит ensureChain — не пугаем «unsupported»
  themeMode: isLight() ? "light" : "dark",
  themeVariables: {
    "--w3m-accent": isLight() ? "#5f8a00" : "#c8f542",
    "--w3m-font-family": "Inter, system-ui, sans-serif",
    "--w3m-border-radius-master": "2px",
    "--w3m-z-index": 1000,
  },
});

// тема сайта переключилась — окно за ней
new MutationObserver(() => modal.setThemeMode(isLight() ? "light" : "dark"))
  .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/** Текущее подключение в виде, привычном сайту, или null. */
export async function current() {
  const acc = getAccount(wagmiConfig);
  if (acc.status !== "connected" || !acc.address || !acc.connector) return null;
  const provider = await acc.connector.getProvider();
  const walletClient = createWalletClient({ account: acc.address, chain: CHAIN, transport: custom(provider) });
  return { account: acc.address, walletClient, provider, appkit: true };
}

/** Тихое восстановление после перезагрузки (без окна). */
export async function restore() {
  try { await reconnect(wagmiConfig); } catch (e) { /* нечего восстанавливать */ }
  return current();
}

/** Открыть окно и дождаться подключения; закрыл окно — ошибка «rejected». */
export function connect() {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => { if (done) return; done = true; unAcc(); unState(); fn(); };
    const unAcc = watchAccount(wagmiConfig, {
      onChange(acc) {
        if (acc.status === "connected" && acc.address) finish(() => current().then(resolve, reject));
      },
    });
    const unState = modal.subscribeState((s) => {
      // окно закрыли, а подключения нет — человек передумал
      if (!s.open && getAccount(wagmiConfig).status !== "connected") setTimeout(() => finish(() => reject(Object.assign(new Error("rejected"), { code: 4001 }))), 300);
    });
    modal.open({ view: "Connect" }).catch((e) => finish(() => reject(e)));
  });
}

/** Отключить (и разорвать сессию WalletConnect, если была). */
export async function disconnectAll() {
  try { await modal.disconnect(); } catch (e) { /* ignore */ }
  try { await wagmiDisconnect(wagmiConfig); } catch (e) { /* ignore */ }
}
