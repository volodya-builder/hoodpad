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
