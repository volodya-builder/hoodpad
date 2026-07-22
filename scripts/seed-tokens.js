#!/usr/bin/env node
/**
 * Посев токенов: создаёт N токенов на фабрике hood одним запуском.
 * Каждый токен получает уникальный он-чейн SVG-логотип (без хостинга картинок).
 *
 * Запуск (ключ НЕ хранится в файле):
 *   PRIVATE_KEY=0x... node scripts/seed-tokens.js                 # 20 токенов, без покупок
 *   PRIVATE_KEY=0x... BUY_ETH=0.0005 node scripts/seed-tokens.js  # + случайная стартовая покупка
 *   PRIVATE_KEY=0x... COUNT=5 node scripts/seed-tokens.js         # только 5
 *
 * По умолчанию — МЕЙННЕТ (chainId 4663) и фабрика из web/src/lib/config.js.
 * Переопределить: RPC_URL=... FACTORY=0x...
 */
const { createPublicClient, createWalletClient, http, parseAbi, parseEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const NAMES = [
  ["Sherwood",      "SHER",  "🏹", "#1f8a4c"], ["Arrow",       "ARRW", "➵", "#c9a227"],
  ["Marian",        "MARI",  "🌹", "#c0392b"], ["Friar Tuck",  "TUCK", "🍺", "#8e5a2a"],
  ["Little John",   "LJON",  "🪵", "#5d6d3b"], ["Nottingham",  "NOTT", "🏰", "#5b5b6e"],
  ["Golden Goose",  "GOOS",  "🪿", "#d4af37"], ["Green Cloak", "CLOK", "🧥", "#2e7d4f"],
  ["Royal Deer",    "DEER",  "🦌", "#a9743c"], ["Oak Tree",    "OAKK", "🌳", "#3f6b35"],
  ["Silver Coin",   "SILV",  "🪙", "#9fa8b3"], ["King Richard","RICH", "👑", "#b58a2e"],
  ["Forest Fox",    "FOXX",  "🦊", "#d3672b"], ["Night Owl",   "OWLL", "🦉", "#4a4661"],
  ["Bullseye",      "BULL",  "🎯", "#b03a3a"], ["Quiver",      "QUIV", "🏹", "#6d4f2a"],
  ["Merry Men",     "MERR",  "🎭", "#3b7a68"], ["Bandit Cat",  "BCAT", "🐱", "#7a5230"],
  ["Loot Bag",      "LOOT",  "💰", "#977a1f"], ["Hood Pup",    "HPUP", "🐶", "#6e4b8a"],
];

const svgLogo = (emoji, bg) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
    `<defs><radialGradient id="g" cx="35%" cy="30%"><stop offset="0%" stop-color="#ffffff33"/>` +
    `<stop offset="100%" stop-color="#00000000"/></radialGradient></defs>` +
    `<rect width="256" height="256" rx="56" fill="${bg}"/>` +
    `<rect width="256" height="256" rx="56" fill="url(#g)"/>` +
    `<text x="128" y="150" font-size="120" text-anchor="middle">${emoji}</text></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
};

const metadataURI = (name, emoji, bg) => {
  const meta = {
    image: svgLogo(emoji, bg),
    description: `${name} — a citizen of the hood. The greedy hoard, hood gives back.`,
  };
  return "data:application/json;base64," + Buffer.from(JSON.stringify(meta), "utf8").toString("base64");
};

async function main() {
  let PRIVATE_KEY = process.env.PRIVATE_KEY || "";
  PRIVATE_KEY = PRIVATE_KEY.replace(/["'\s]/g, "");
  if (PRIVATE_KEY && !PRIVATE_KEY.startsWith("0x")) PRIVATE_KEY = "0x" + PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
    console.error("Задай PRIVATE_KEY (64 hex). Ключ живёт только в переменной окружения.");
    process.exit(1);
  }
  const RPC_URL = process.env.RPC_URL || "https://robinhood-mainnet.g.alchemy.com/v2/Vs1nO3DOTOw64ThcZAuNf";
  const FACTORY = (process.env.FACTORY || "0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9");
  const COUNT = Math.min(Number(process.env.COUNT || 20), NAMES.length);
  const BUY_ETH = Number(process.env.BUY_ETH || 0);

  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(RPC_URL);
  const pub = createPublicClient({ transport });
  const chainId = await pub.getChainId();
  const chain = { id: chainId, name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } } };
  const wallet = createWalletClient({ account, chain, transport });
  const abi = parseAbi([
    "function createToken(string name, string symbol, string metadataURI, address creatorWallet) payable returns (address, address)",
  ]);

  const bal = await pub.getBalance({ address: account.address });
  console.log(`Сеть ${chainId} · кошелёк ${account.address} · баланс ${Number(bal) / 1e18} ETH`);
  console.log(`Создаю ${COUNT} токенов${BUY_ETH ? ` со стартовой покупкой ~${BUY_ETH} ETH` : ""}…\n`);

  for (let i = 0; i < COUNT; i++) {
    const [name, sym, emoji, bg] = NAMES[i];
    // покупка со случайным разбросом ±50%, чтобы арена не была плоской
    const buy = BUY_ETH > 0 ? BUY_ETH * (0.5 + Math.random()) : 0;
    try {
      const hash = await wallet.writeContract({
        address: FACTORY, abi, functionName: "createToken",
        args: [name, sym, metadataURI(name, emoji, bg), account.address],
        value: buy > 0 ? parseEther(buy.toFixed(6)) : 0n,
      });
      const rc = await pub.waitForTransactionReceipt({ hash });
      console.log(`${String(i + 1).padStart(2)}/${COUNT}  $${sym.padEnd(5)} ${name.padEnd(14)} ${rc.status === "success" ? "✓" : "✗"} ${hash.slice(0, 14)}…${buy ? ` buy ${buy.toFixed(5)} ETH` : ""}`);
      await new Promise((r) => setTimeout(r, 1500)); // не душим RPC
    } catch (e) {
      console.error(`${i + 1}/${COUNT}  $${sym} ОШИБКА: ${e.shortMessage || e.message}`);
    }
  }
  const bal2 = await pub.getBalance({ address: account.address });
  console.log(`\nГотово. Потрачено ${(Number(bal - bal2) / 1e18).toFixed(6)} ETH.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
