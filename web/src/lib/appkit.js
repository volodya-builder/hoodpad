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
import { defineChain, mainnet } from "@reown/appkit/networks";
import { AssetController } from "@reown/appkit-controllers";
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

// Ethereum в списке сетей — только чтобы реестр показывал все EVM-кошельки
// (540+, как у Pons), а не 80 с явной поддержкой Robinhood Chain. Работает
// сайт всё равно в Robinhood Chain: после подключения ensureChain переключит.
const NETWORKS = [robinhood, mainnet];
const wagmiAdapter = new WagmiAdapter({ networks: NETWORKS, projectId: PROJECT_ID, ssr: false });
export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const modal = createAppKit({
  adapters: [wagmiAdapter],
  networks: NETWORKS,
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
  // остальное — как у Pons: стандартный вид AppKit (шрифт, скругления), только акцент наш
  themeVariables: {
    "--w3m-accent": isLight() ? "#5f8a00" : "#c8f542",
    // темнее стандартного, как у Pons: подмешиваем чёрный в фон и плашки
    "--w3m-color-mix": isLight() ? "#ffffff" : "#000000",
    "--w3m-color-mix-strength": isLight() ? 0 : 35,
    "--w3m-z-index": 1000,
  },
});

// Кнопка «?» (What is a wallet) в шапке окна — лишняя, у AppKit нет настройки
// её убрать; прячем стилем внутри shadow DOM шапки при каждом открытии.
function hideHelpButton() {
  try {
    const header = document.querySelector("w3m-modal")?.shadowRoot?.querySelector("w3m-header");
    const root = header?.shadowRoot;
    if (!root || root.querySelector("#hood-no-help")) return;
    const st = document.createElement("style");
    st.id = "hood-no-help";
    st.textContent = 'wui-icon-button[icon="helpCircle"] { visibility: hidden; pointer-events: none; }';
    root.appendChild(st);
  } catch (e) { /* ignore */ }
}
modal.subscribeState((s) => { if (s.open) [0, 60, 300, 1000].forEach((ms) => setTimeout(hideHelpButton, ms)); });

// Логотип WalletConnect: AppKit тянет картинки коннекторов один раз, при первом
// открытии окна, а WalletConnect-коннектор к этому моменту ещё не создан —
// остаётся пустой квадрат. Ставим картинку сами: тот же файл из реестра Reown.
const WC_IMAGE_ID = "ef1a1fcf-7fe8-4d69-bd6d-fda1345b4400";
AssetController.setConnectorImage(WC_IMAGE_ID, `https://api.web3modal.org/public/getAssetImage/${WC_IMAGE_ID}?projectId=${PROJECT_ID}&st=appkit&sv=html-wagmi-1.8.24`);

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
  // AppKit сам восстанавливает прошлую сессию при инициализации — тогда окно не нужно
  if (getAccount(wagmiConfig).status === "connected") return current();
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
