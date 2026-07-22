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

// Set after deployment (scripts/deploy.js prints it).
export const FACTORY_ADDRESS =
  import.meta.env.VITE_FACTORY_ADDRESS ?? "0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9";

// Buyback treasury (80% of fees; ETH can only leave via buybacks)
export const TREASURY_ADDRESS =
  import.meta.env.VITE_TREASURY_ADDRESS ?? "0xe5544c837f8dfd6b7e082435f7a1d646692239d3";

// On-chain chat contract (messages are events; zero = not deployed yet)
export const CHAT_ADDRESS =
  import.meta.env.VITE_CHAT_ADDRESS ?? "0xbaf4de9b8f35c384058d31e2730a3146c0d1af3c";

// Weekly advisory buyback poll (zero = not deployed yet)
export const VOTE_ADDRESS =
  import.meta.env.VITE_VOTE_ADDRESS ?? "0xf663b704929b8c0562f6e1ae5c0387ad264d4ef3";

// v2 «голос за шкуру»: пока пусто — страница голосования работает в режиме v1.
// После деплоя v2 вписать адрес VotePower (или задать VITE_VOTEPOWER_ADDRESS).
export const VOTEPOWER_ADDRESS = import.meta.env.VITE_VOTEPOWER_ADDRESS ?? "";

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
