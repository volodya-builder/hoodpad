import { parseAbi } from "viem";

export const factoryAbi = parseAbi([
  "function createToken(string name, string symbol, string metadataURI, address creatorWallet) payable returns (address token, address pool)",
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256 offset, uint256 limit) view returns (address[])",
  "function poolOf(address token) view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function treasury() view returns (address)",
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, string name, string symbol, string metadataURI)",
]);

export const poolAbi = parseAbi([
  "function buy(uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minEthOut) returns (uint256)",
  "function quoteBuy(uint256 ethInGross) view returns (uint256)",
  "function quoteSell(uint256 tokensIn) view returns (uint256)",
  "function spotPrice() view returns (uint256)",
  "function ethReserve() view returns (uint256)",
  "function tokensSold() view returns (uint256)",
  "function saleCap() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function migrated() view returns (bool)",
  "function migrate()",
  "function creator() view returns (address)",
  "function creatorFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(address to)",
]);

export const treasuryAbi = parseAbi([
  "function owner() view returns (address)",
  "function buyback(address token, uint256 ethAmount, uint256 minTokensOut) returns (uint256)",
  "function burn(address token, uint256 amount)",
  "function totalReceived() view returns (uint256)",
  "function totalSpent() view returns (uint256)",
  "function boughtOf(address) view returns (uint256)",
  "function burnedOf(address) view returns (uint256)",
]);

export const poolExtraAbi = parseAbi([
  "function creatorFeesAccrued() view returns (uint256)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function protocolFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(address to)",
  "function claimProtocolFees()",
]);

export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function metadataURI() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const splitterAbi = parseAbi([
  "function teamBps() view returns (uint16)",
]);

// v2: VotePower — «голос за шкуру»
export const votePowerAbi = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochEndsIn() view returns (uint256)",
  "function powerOf(uint256 epoch, address trader) view returns (uint256)",
  "function choiceOf(uint256 epoch, address trader) view returns (address)",
  "function totalFor(uint256 epoch, address token) view returns (uint256)",
  "function rewardOf(uint256 epoch) view returns (address token, uint256 amount)",
  "function pendingReward(uint256 epoch, address trader) view returns (uint256)",
  "function claimed(uint256 epoch, address trader) view returns (bool)",
  "function vote(address token)",
  "function claim(uint256 epoch) returns (uint256)",
  "function minPower() view returns (uint256)",
  "event Voted(address indexed trader, uint256 indexed epoch, address indexed token, uint256 power)",
]);

// ——— Коты-брокеры ————————————————————————————————————————————————
// Минимальный набор для фронта: чтение коллекции и рынка + действия игрока.
// Полные ABI лежат в artifacts/ после компиляции контрактов.

export const catsAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 id) view returns (address)",
  "function totalMinted() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function catInfo(uint256 id) view returns (string ticker, address feed, uint8 rarity, uint8 multiplier)",
  "function rarityMultiplier(uint8 rarity) pure returns (uint8)",
  "function rosterCount() view returns (uint256)",
  "function tokenURI(uint256 id) view returns (string)",
  "function approve(address to, uint256 id)",
  "function getApproved(uint256 id) view returns (address)",
  "function transferFrom(address from, address to, uint256 id)",
  "event CatMinted(address indexed to, uint256 indexed id, uint16 rosterId, uint8 rarity, bool free)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed id)",
]);

export const catBoxAbi = parseAbi([
  "function boxPrice() view returns (uint256)",
  "function sold() view returns (uint256)",
  "function opened() view returns (uint256)",
  "function boxesLeft() view returns (uint256)",
  "function boxesOf(address owner) view returns (uint256[])",
  "function openable(uint256 boxId) view returns (bool ready, bool expired)",
  "function buy() payable",
  "function open(uint256 boxId)",
  "function recommit(uint256 boxId)",
  "event BoxBought(address indexed buyer, uint256 indexed boxId, uint256 commitBlock)",
  "event BoxOpened(address indexed owner, uint256 indexed boxId, uint256 indexed catId, uint8 rarity)",
]);

export const catVaultAbi = parseAbi([
  "function weightOf(uint256 catId) view returns (uint256)",
  "function totalWeight() view returns (uint256)",
  "function pendingOf(uint256 catId, address token) view returns (uint256)",
  "function pendingAll(uint256 catId) view returns (address[] tokens, uint256[] amounts)",
  "function payoutTokens(uint256 index) view returns (address)",
  "function payoutTokensCount() view returns (uint256)",
  "function claim(uint256 catId, address to)",
  "event Funded(address indexed token, uint256 amount, uint256 totalWeight)",
  "event Claimed(uint256 indexed catId, address indexed token, address to, uint256 amount)",
]);

export const catMarketAbi = parseAbi([
  "function FEE_BPS() view returns (uint16)",
  "function listedCount() view returns (uint256)",
  "function listings(uint256 offset, uint256 limit) view returns (uint256[] ids, address[] sellers, uint256[] prices, uint8[] rarities)",
  "function listingOf(uint256 catId) view returns (address seller, uint96 price)",
  "function list(uint256 catId, uint256 price)",
  "function cancel(uint256 catId)",
  "function buy(uint256 catId) payable",
  "event Listed(uint256 indexed catId, address indexed seller, uint256 price)",
  "event Bought(uint256 indexed catId, address indexed buyer, address indexed seller, uint256 price, uint256 fee)",
]);

// Фабрика и пул с ERC20-валютой курвы (акции, USDG, WETH — что в белом
// списке). Отличие от ETH-версии: валюта приходит через transferFrom,
// поэтому перед покупкой нужен approve; продажа и клеймы платят в валюте.
export const quoteFactoryAbi = parseAbi([
  "function createToken(string name, string symbol, string metadataURI, address quote, address creatorWallet, uint16 divBps) returns (address token, address pool)",
  "function tokenCount() view returns (uint256)",
  "function tokens(uint256 offset, uint256 limit) view returns (address[])",
  "function poolOf(address token) view returns (address)",
  "function quoteOf(address token) view returns (address)",
  "function allowedQuotesCount() view returns (uint256)",
  "function allowedQuotes(uint256 i) view returns (address)",
  "function quoteConfig(address quote) view returns (bool allowed, uint256 virtualQuote, uint256 creatorBuyCap)",
  "event TokenCreated(address indexed token, address indexed pool, address indexed creator, address quote, uint16 divBps)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function feeBps() view returns (uint16)",
  "function treasury() view returns (address)",
  "function pendingConfig() view returns (address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt)",
]);

export const quotePoolAbi = parseAbi([
  "function buy(uint256 quoteInGross, uint256 minTokensOut, address recipient) returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut) returns (uint256)",
  "function quoteBuy(uint256 quoteInGross) view returns (uint256)",
  "function quoteSell(uint256 tokensIn) view returns (uint256)",
  "function spotPrice() view returns (uint256)",
  "function quote() view returns (address)",
  "function quoteReserve() view returns (uint256)",
  "function virtualQuote() view returns (uint256)",
  "function tokensSold() view returns (uint256)",
  "function saleCap() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function migrated() view returns (bool)",
  "function migrate()",
  "function creator() view returns (address)",
  "function creatorBuyCap() view returns (uint256)",
  "function creatorFeesAccrued() view returns (uint256)",
  "function claimCreatorFees(address to)",
  "function divBps() view returns (uint16)",
  "function dividendsPaid() view returns (uint256)",
]);

// Токен монеты за ERC20-валюту: холдерам капает валюта с каждой сделки.
export const dividendTokenAbi = parseAbi([
  "function divBps() view returns (uint16)",
  "function quote() view returns (address)",
  "function pool() view returns (address)",
  "function totalDistributed() view returns (uint256)",
  "function pot() view returns (uint256)",
  "function divSupply() view returns (uint256)",
  "function withdrawableDividendOf(address) view returns (uint256)",
  "function accumulativeDividendOf(address) view returns (uint256)",
  "function withdrawn(address) view returns (uint256)",
  "function claim() returns (uint256)",
  "function claimFor(address holder) returns (uint256)",
  "event DividendsDistributed(uint256 amount)",
  "event DividendClaimed(address indexed holder, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// CurveZap: ETH → валюта монеты → монета, в одной транзакции (и обратно).
export const zapAbi = parseAbi([
  "function buyWithEth(address token, uint256 minTokensOut, uint256 deadline) payable returns (uint256 tokensOut)",
  "function sellForEth(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline) returns (uint256 ethOut)",
  "function supported(address token) view returns (bool)",
  "function hasRoute(address quote) view returns (bool)",
  "function routeOf(address quote) view returns (address mid, uint24 fee1, uint24 fee2)",
]);

// FeeSplitterV4 — казна обеих фабрик: делёж и реестр «ИИ включён».
export const feeSplitterAbi = parseAbi([
  "function aiOf(address token) view returns (bool)",
  "function enableAi(address token)",
  "function poolOf(address token) view returns (address)",
  "function teamShareBps() view returns (uint256)",
  "function arenaShareBps() view returns (uint256)",
  "function claim(address pool)",
  "function pendingEth(address) view returns (uint256)",
  "function pendingErc20(address, address) view returns (uint256)",
  "function withdrawEth()",
  "function withdrawErc20(address asset)",
  "event AiEnabled(address indexed token, address indexed creator)",
]);

// ArenaTreasury — казна арены (contracts/ArenaTreasury.sol)
export const arenaTreasuryAbi = parseAbi([
  "function owner() view returns (address)",
  "function burnedOf(address token) view returns (uint256)",
  "function totalEthSpent() view returns (uint256)",
  "event Buyback(address indexed token, address indexed asset, uint256 amountIn, uint256 tokensOut, string note)",
  "event Burned(address indexed token, uint256 amount)",
]);

// ProfileRegistry — профили кошельков (contracts/ProfileRegistry.sol)
export const profileRegistryAbi = parseAbi([
  "struct Profile { string name; string avatar; string x; string telegram; string website; uint64 updatedAt; }",
  "function profileOf(address who) view returns (Profile)",
  "function profilesOf(address[] whos) view returns (Profile[])",
  "function setProfile(string name, string avatar, string x, string telegram, string website)",
  "function clearProfile()",
  "event ProfileSet(address indexed who, string name, bool hasAvatar)",
]);

// FeeClaimer — один вызов на все пулы (contracts/FeeClaimer.sol)
export const feeClaimerAbi = parseAbi([
  "function claimAll(address[] pools) returns (uint256 ok)",
  "function pending(address[] pools) view returns (address[] out)",
]);
