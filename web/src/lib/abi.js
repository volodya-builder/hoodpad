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
