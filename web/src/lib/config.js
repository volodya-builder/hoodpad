import { defineChain } from "viem";

// ---------------------------------------------------------------- chains
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
});

// Local hardhat node for development
export const localChain = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

// Active network: switch to robinhoodMainnet for production.
const NETWORK = import.meta.env.VITE_NETWORK ?? "mainnet";
export const CHAIN =
  NETWORK === "mainnet" ? robinhoodMainnet : NETWORK === "local" ? localChain : robinhoodTestnet;

// При смене сети чистим весь кэш данных (иначе на мейннете мелькают
// старые тестнет-токены из localStorage, пока не подтянутся свежие).
try {
  if (localStorage.getItem("hood_net") !== NETWORK) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("hood_cache_") || k.startsWith("hood_created_")) localStorage.removeItem(k);
    }
    localStorage.setItem("hood_net", NETWORK);
  }
} catch (e) { /* ignore */ }

// hood v2 (мейннет, задеплоено 22.07.2026): фабрика 20/20/60, «голос за шкуру».
// Старая v1-фабрика выведена из конфига — чистый лист.
export const FACTORY_ADDRESS =
  import.meta.env.VITE_FACTORY_ADDRESS ?? "0x68a983f0c73f1a5dc13aa3ae71a19a5787162cdb";

// BuybackTreasuryV2 (60% комиссий; ETH уходит только на выкупы; выкуп→сжигание)
export const TREASURY_ADDRESS =
  import.meta.env.VITE_TREASURY_ADDRESS ?? "0x232cf3b0026ed39e1448567e8da55206375945e4";

// On-chain chat contract (messages are events; zero = not deployed yet)
export const CHAT_ADDRESS =
  import.meta.env.VITE_CHAT_ADDRESS ?? "0xbaf4de9b8f35c384058d31e2730a3146c0d1af3c";

// Weekly advisory buyback poll (zero = not deployed yet)
export const VOTE_ADDRESS =
  import.meta.env.VITE_VOTE_ADDRESS ?? "0xf663b704929b8c0562f6e1ae5c0387ad264d4ef3";

// v2 «голос за шкуру»: пока пусто — страница голосования работает в режиме v1.
// После деплоя v2 вписать адрес VotePower (или задать VITE_VOTEPOWER_ADDRESS).
export const VOTEPOWER_ADDRESS =
  import.meta.env.VITE_VOTEPOWER_ADDRESS ?? "0x421b28dd32a16591afecb4b5ba31e0bee2c9f25a";

// Off-chain chat storage: Firebase Realtime Database URL
export const CHAT_DB_URL = (import.meta.env.VITE_CHAT_DB_URL ?? "https://hood-chat-4b664-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/$/, "");

export const EXPLORER = CHAIN.blockExplorers?.default?.url ?? "";

// Список RPC-эндпоинтов с автоматическим переключением при сбое.
// Можно задать приватный (Alchemy и т.п.) через VITE_RPC_URL или сохранить
// в localStorage["hood_rpc"] — он встанет ПЕРВЫМ, публичный останется резервом.
// Выделенный RPC от Alchemy (высокие лимиты, стабильность) — основной канал.
// Ключ фронтенд-типа: защищается ограничением по домену в панели Alchemy.
const ALCHEMY_RPC = {
  testnet: "https://robinhood-testnet.g.alchemy.com/v2/Vs1nO3DOTOw64ThcZAuNf",
  mainnet: "https://robinhood-mainnet.g.alchemy.com/v2/Vs1nO3DOTOw64ThcZAuNf",
};
function rpcList() {
  const def = CHAIN.rpcUrls?.default?.http ?? [];
  const urls = [...def];                       // публичный — резерв
  const dedicated = ALCHEMY_RPC[NETWORK];
  if (dedicated) urls.unshift(dedicated);      // Alchemy — основной
  const envUrl = import.meta.env.VITE_RPC_URL;
  if (envUrl) urls.unshift(envUrl);
  try {
    const ls = localStorage.getItem("hood_rpc");
    if (ls && /^https?:\/\//.test(ls)) urls.unshift(ls.trim());
  } catch (e) { /* ignore */ }
  return [...new Set(urls)]; // без дублей, приоритетные первыми
}
export const RPC_URLS = rpcList();
