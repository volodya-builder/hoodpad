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

// BNB Smart Chain (порт hood на BSC; фабрика деплоится scripts/deploy-v2-bsc.js)
export const bnbChain = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.binance.org"] } },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
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
  NETWORK === "mainnet" ? robinhoodMainnet
  : NETWORK === "bsc" ? bnbChain
  : NETWORK === "local" ? localChain
  : robinhoodTestnet;
// Символ нативной монеты для UI (на BSC цены в BNB, не в ETH)
export const NATIVE_SYMBOL = CHAIN.nativeCurrency.symbol;

// hood v2 (мейннет, передеплой 24.07.2026 на новом кошельке): 50/20/30,
// «голос за шкуру». Прошлые фабрики выведены из конфига — чистый лист.
export const FACTORY_ADDRESS =
  import.meta.env.VITE_FACTORY_ADDRESS ?? "0x08a887196fc31b89305ae03aa991917f6b1d23ec";

// При смене сети ИЛИ адреса фабрики чистим весь кэш данных — иначе после
// переезда на v2 в localStorage остаются старые токены с прошлой фабрики.
try {
  const tag = NETWORK + ":" + FACTORY_ADDRESS.toLowerCase();
  if (localStorage.getItem("hood_net") !== tag) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("hood_cache_") || k.startsWith("hood_created_")) localStorage.removeItem(k);
    }
    localStorage.setItem("hood_net", tag);
  }
} catch (e) { /* ignore */ }

// BuybackTreasuryV2 (60% комиссий; ETH уходит только на выкупы; выкуп→сжигание)
export const TREASURY_ADDRESS =
  import.meta.env.VITE_TREASURY_ADDRESS ?? "0xb45661df6625decdc697dd2fa0556c2637ea063a";

// Кошелёк команды (владелец контрактов). По нему открываются админ-панели
// на фронте — то, что не должно видеть большинство посетителей.
export const TEAM_ADDRESS =
  (import.meta.env.VITE_TEAM_ADDRESS ?? "0xD3d14c10020ad9C582404669a2Fa11AfF2386255").toLowerCase();
export const isTeam = (addr) => !!addr && addr.toLowerCase() === TEAM_ADDRESS;

// ——— Коты-брокеры (NFT + награды акциями) ———
// Пусто = контракты не задеплоены: вкладка живёт в демо/песочнице.
// После деплоя (scripts/deploy-cats.js) достаточно вписать адреса сюда
// или задать переменные окружения — фронт сам переключится на он-чейн.
export const CATS_ADDRESS = import.meta.env.VITE_CATS_ADDRESS ?? "";
export const CAT_VAULT_ADDRESS = import.meta.env.VITE_CAT_VAULT_ADDRESS ?? "";
export const CAT_BOX_ADDRESS = import.meta.env.VITE_CAT_BOX_ADDRESS ?? "";
export const CAT_MARKET_ADDRESS = import.meta.env.VITE_CAT_MARKET_ADDRESS ?? "";
/** Игра работает на контрактах, а не в песочнице. */
export const CATS_LIVE = Boolean(CATS_ADDRESS && CAT_BOX_ADDRESS);

// ——— RWA-лончпад: запуск токенов за токенизированные акции ———
// Пусто = форма запуска за акции сохраняет черновик вместо транзакции.
export const QUOTE_FACTORY_ADDRESS = import.meta.env.VITE_QUOTE_FACTORY_ADDRESS ?? "";
export const QUOTE_LIVE = Boolean(QUOTE_FACTORY_ADDRESS);

// On-chain chat contract (messages are events; zero = not deployed yet)
export const CHAT_ADDRESS =
  import.meta.env.VITE_CHAT_ADDRESS ?? "0xbaf4de9b8f35c384058d31e2730a3146c0d1af3c";

// Weekly advisory buyback poll (zero = not deployed yet)
export const VOTE_ADDRESS =
  import.meta.env.VITE_VOTE_ADDRESS ?? "0xf663b704929b8c0562f6e1ae5c0387ad264d4ef3";

// v2 «голос за шкуру»: пока пусто — страница голосования работает в режиме v1.
// После деплоя v2 вписать адрес VotePower (или задать VITE_VOTEPOWER_ADDRESS).
export const VOTEPOWER_ADDRESS =
  import.meta.env.VITE_VOTEPOWER_ADDRESS ?? "0x352b66605283d3b492a20a61f1f9aa541816def8";

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
  // История 05.08.2026: Alchemy отключил эндпоинт за неоплаченный инвойс
  // ($2.02, карта не прошла) — сайт завис, т.к. старый транспорт долго
  // ждал мёртвый RPC. Инвойс оплачен, эндпоинт жив. Теперь Alchemy снова
  // основной, но web3.js делает быстрый отвал (8с, 1 повтор) + rank —
  // при повторении истории сайт мгновенно уходит на публичный RPC.
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
