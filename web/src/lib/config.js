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
// WalletConnect / Reown AppKit: Project ID с cloud.reown.com (переменная GitHub WC_PROJECT_ID).
// Пусто — окно кошельков работает в простом режиме без WalletConnect (components/WalletModal.jsx).
export const WC_PROJECT_ID = String(import.meta.env.VITE_WC_PROJECT_ID || "").trim();
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
  import.meta.env.VITE_FACTORY_ADDRESS ?? "0xe16ccf7c12ce0256473fff60a1c3f18def64f861";

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

// Перезапуск 16.09.2026: казна арены (ArenaTreasury) — по её owner() открывается
// админка; старая BuybackTreasuryV2 0xb456… ушла вместе со старыми фабриками.
export const TREASURY_ADDRESS =
  import.meta.env.VITE_TREASURY_ADDRESS ?? "0x0f82981d3630595b38943f4349f41ac1f2045eca";

// Кошелёк команды (владелец контрактов). По нему открываются админ-панели
// на фронте — то, что не должно видеть большинство посетителей.
export const TEAM_ADDRESS =
  (import.meta.env.VITE_TEAM_ADDRESS ?? "0xd2E49356804b8a82E5DED94a4D3E1a14d80A6F33").toLowerCase();
export const isTeam = (addr) => !!addr && addr.toLowerCase() === TEAM_ADDRESS;

// AgentTreasury — бюджеты агентов по монетам (ETH и валюта). Задеплоен
// владельцем 14.09.2026, пополняется сплиттером. Пусто = счётчик бюджета
// на странице монеты не показывается вовсе.
// Пустой счётчик с нулями выглядит как работающая система, которой нет.
export const AGENT_TREASURY_ADDRESS = import.meta.env.VITE_AGENT_TREASURY ?? "0xe39e61c2e2897a59dde71d75b7b84f42ed09fd0c";

// ArenaTreasury — казна арены: 10% каждой комиссии (через FeeSplitterV6),
// деньги уходят только на выкуп и сжигание подиума. Пусто = ещё не
// задеплоена: страница арены показывает фонд как «…».
// Задеплоить: node scripts/deploy-arena-economy.js --deploy (владелец).
export const ARENA_TREASURY_ADDRESS = import.meta.env.VITE_ARENA_TREASURY ?? "0x0f82981d3630595b38943f4349f41ac1f2045eca";
export const ARENA_LIVE = /^0x[0-9a-fA-F]{40}$/.test(ARENA_TREASURY_ADDRESS);
// Прежняя казна арены: после перехода на казну V2 (копит в ETH) туда всё ещё
// падают излишки градаций — фонд на сайте считается по обеим. Пусто — одна казна.
export const ARENA_TREASURY_LEGACY_ADDRESS = import.meta.env.VITE_ARENA_TREASURY_LEGACY ?? "";
// Казна выкупа монеты hood (тот же контракт ArenaTreasury): 10% каждой
// комиссии; бот bot/buyback раз в сутки выкупает hood и сжигает.
export const BUYBACK_TREASURY_ADDRESS = import.meta.env.VITE_BUYBACK_TREASURY ?? "0x7800ef8dbef42ffbce7573291d6e1fe4828b5936";

// ProfileRegistry — имя, аватар, соцсети кошелька в блокчейне. Задеплоен
// владельцем 15.09.2026 (scripts/deploy-profiles.js); без владельца, переживёт
// передеплой фабрик. Пусто = имена не показываются, форма в профиле ждёт.
// Контракт ProfileRegistry задеплоен (0x71ccb2eb…), но профили теперь живут
// в базе сайта по подписи кошелька — бесплатно (решение владельца 15.09.2026).
export const PROFILE_REGISTRY_ADDRESS = import.meta.env.VITE_PROFILE_REGISTRY ?? "0x71ccb2eb2b2719d0d316385fc276ebeb1275a8c2";
export const PROFILES_LIVE = true; // база — CHAT_DB_URL ниже
// FeeClaimer — сбор комиссий протокола со всех пулов одной транзакцией
// (contracts/FeeClaimer.sol, scripts/deploy-fee-claimer.js). Пусто — админка
// шлёт по транзакции на пул.
export const FEE_CLAIMER_ADDRESS = import.meta.env.VITE_FEE_CLAIMER ?? "0x1675389096cfb6f49c35a82b503eafad1c2c2af2"; // задеплоен владельцем 15.09.2026

// FeeSplitterV4 — делит протокольную долю комиссии (команда / агент /
// создатель) и хранит, включён ли у монеты ИИ (enableAi — решение
// создателя, навсегда). Задеплоен владельцем 14.09.2026; ETH-фабрика
// переключена на него сразу, фабрика за валюту — заявка, вступает
// 16.09.2026 (applyConfig). Пусто = сайт живёт по старой схеме.
export const FEE_SPLITTER_ADDRESS = import.meta.env.VITE_FEE_SPLITTER ?? "0xad10637462a0e8abaabacc1cceb16ffabe56e529";
export const SPLITTER_LIVE = Boolean(FEE_SPLITTER_ADDRESS);

// Кошелёк, чьей подписью заверяются записи журнала агента (lib/journal.js).
// Пока это кошелёк команды: записи заполняются руками из админ-формы на
// вкладке «Мастерская». Когда появится агент, сюда встанет ЕГО адрес —
// отдельный, а не командный, чтобы по подписи было видно, кто написал.
export const AGENT_OPERATOR =
  (import.meta.env.VITE_AGENT_OPERATOR ?? TEAM_ADDRESS).toLowerCase();

// ——— Политика трат казны (решение владельца 06.08.2026) ———
// Комиссия сделки (1%) делится контрактами: 70% создателю / 10% команде / 10% выкуп hood / 10% арена //
// 30% в казну. Дальше уже казна распределяется по направлениям:
//   20% баланса — кошачья казна: покупка токенизированных акций и раздача
//                 наград держателям NFT-котов;
//   10% баланса — арена: выкуп токенов-призёров подиума и их сжигание;
//   70% баланса — выкуп токенов платформы с рынка и сжигание купленного.
// Это параметры политики, а не контракта: их исполняет ИИ-казначей, и
// поменять их можно без передеплоя. Проценты считаются от баланса казны
// на момент траты, поэтому у разных ритмов они не складываются в 100.
// ——— Скрытые фичи (разворот концепции 13.09.2026, см. CONCEPT-V3.md) ———
// Код НЕ удалён. Чтобы вернуть вкладку — поставить true и пересобрать.
//   arena    — lib/arena.js, lib/arena-core.js, lib/fairvol.js, pages/Arena.jsx
//   cats     — pages/Cats.jsx, pages/CatsGuide.jsx, lib/catstate.js, lib/clicker.js,
//              contracts/BrokerCats.sol, CatBox.sol, CatMarket.sol, CatStockVault.sol, CatRenderer.sol
//   vote     — contracts/VotePower.sol, BuybackVote.sol (интерфейса нет с 06.08.2026)
//   treasury — pages/Treasury.jsx, contracts/BuybackTreasuryV2.sol
export const FEATURES = {
  arena: true,         // «Арена» — суточный турнир, приз: 10% всех комиссий → выкуп и сжигание подиума (возвращена 15.09.2026)
  grandArena: false,   // месячная Гранд-Арена старой схемы казны — спрятана 15.09.2026 (код в pages/Arena.jsx)
  arenaBanner: false,  // полоска «Арена: N токенов в бою…» на главной — убрана 15.09.2026 по просьбе владельца
  leaders: false,      // блок «Лидеры» (топ создателей и трейдеров) в аналитике — убран 15.09.2026 по просьбе владельца («дешевит»); pages/Leaderboard.jsx на месте
  cats: false,
  vote: false,
  treasury: false,
  ticker: false,   // components/Ticker.jsx — бегущая строка под шапкой
  headerSearch: false, // кнопка-лупа в шапке (поиск по Ctrl+K и поле на главной работают)
  netSwitch: false,    // выбор сети в шапке (пока сеть одна — Robinhood Chain)
  about: false,        // «О нас» выключена целиком (и пункт, и маршрут #/about) — решение владельца 14.09.2026; файл pages/About.jsx не трогать и не обновлять
  ai: false,           // ИИ монет (вкладка «ИИ», доска идей, чат, выбор модели при создании) — выключено владельцем 15.09.2026; код и воркер на месте
  weeklyWorkshop: false, // старая недельная мастерская (Workshop/Queue/Journal) — заменена живой доской идей 14.09.2026, код остаётся
  taxToken: false,     // вкладка «Tax-токен» на «Создать» — скрыта 14.09.2026: контракт есть, фабрики и пула под него нет, кнопка лишь сохраняла черновик
  customQuote: false,  // поле «Свой контракт: 0x…» на «Создать» — спрятано 14.09.2026 по просьбе владельца (код остаётся)
  payInQuote: false,   // переключатель «платить ETH / валютой» на странице монеты — выключен 14.09.2026, платят только ETH (через зап)
  // Запуск монеты, торгующейся за акцию/крипту, с дивидендами холдерам в
  // ней же — модель Pons, Flap, Stockpad, Long. Включён 14.09.2026 после
  // разбора: «покупка за ETH» у Pons на GMGN — это терминал меняет ETH на
  // акцию по дороге, монета всё равно за акцией. Такой же обмен по дороге
  // делаем контрактом-помощником (zap), а не переделкой фабрики.
  quoteLaunch: true,
  // «hood AI» — оценка доверия к монете (Trust Score) в блоке «О токене».
  // Скрыта 14.09.2026 по решению владельца: лишняя информация. Код и
  // lib/trust.js на месте — включается флагом.
  trustScore: false,
  // Чат холдеров с ИИ монеты (components/AgentChat.jsx + worker/). Включён
  // 15.09.2026; сообщения ходят через воркер Cloudflare на /api/chat/*.
  aiChat: true,
  creatorSellBanner: false, // «Создатель продаёт: за сутки слил…» на странице монеты — убрана 15.09.2026 по просьбе владельца
  dividendsCard: false,     // блок дивидендов в «О токене» (чип, «роздано», кнопка «забрать») — убран 15.09.2026: ставка и валюта показаны в шапке монеты, выплаты приходят сами (бот раз в час)
  activityTab: false,       // вкладка «Активность» в нижней таблице страницы монеты — убрана 15.09.2026 по просьбе владельца (лента сделок есть справа, во вкладке «Активность» боковой панели)
};

// Доля создателя в комиссии, как её обещает сайт (решение владельца 15.09.2026:
// показывать только «создателю 70%», без остальных получателей). Цепь после
// передеплоя фабрик даст ровно это; до него новые монеты получают 80%.
export const CREATOR_FEE_PCT = 70;

export const TREASURY_POLICY = { cats: 20, arena: 10, buyback: 70 };

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
// Фабрика монет за ERC20-валюту (USDG, акции, WETH…) с дивидендами холдерам.
// Задеплоена владельцем 14.09.2026, проверена на цепи: MAX_DIV_BPS=300,
// 15 валют в белом списке, USDG в 6 знаках. Мигратор: 0xa487…1fd0.
export const QUOTE_FACTORY_ADDRESS =
  import.meta.env.VITE_QUOTE_FACTORY_ADDRESS ?? "0x655b7ce112336ad29dacdce7cf434b03930407a3";
export const QUOTE_LIVE = Boolean(QUOTE_FACTORY_ADDRESS);

// CurveZap — «купить/продать монету за валюту, платя ETH»: меняет ETH на
// валюту монеты через Uniswap V3 и покупает на кривой одной транзакцией.
// Как терминал GMGN для монет Pons. Пусто = покупка только за саму валюту.
// Задеплоен владельцем 14.09.2026, проверен на цепи: смотрит на quote-фабрику
// 0xd729…9a4f, WETH и Uniswap V3 Factory сети; 12 маршрутов (LINK/PENDLE —
// без пулов, маршрута нет). Владелец — кошелёк команды.
export const ZAP_ADDRESS = import.meta.env.VITE_ZAP_ADDRESS ?? "0x81345f67f3cb7c68ad17a4b63f9f6f1392c013ce";
export const ZAP_LIVE = Boolean(ZAP_ADDRESS);
export const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

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

// Воркер чата с ИИ монеты (worker/): живёт на том же домене, /api/*.
// Пусто = чат выключен. Локально можно указать VITE_CHAT_API.
export const CHAT_API_URL = (import.meta.env.VITE_CHAT_API ?? "https://hoodandarrow.com/api").replace(/\/$/, "");

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
    if (ls && /^https:\/\//.test(ls)) urls.unshift(ls.trim()); // только https
  } catch (e) { /* ignore */ }
  return [...new Set(urls)]; // без дублей, приоритетные первыми
}
export const RPC_URLS = rpcList();
