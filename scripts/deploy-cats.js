#!/usr/bin/env node
/**
 * Деплой игры «Коты-брокеры» в мейннет Robinhood Chain (chainId 4663).
 *
 * Что ставится и как связывается:
 *   BrokerCats    — NFT-коты (ERC721). Потолок 10 500 = 10 000 кейсов + 500
 *                   на бесплатную раздачу. Прямой mint() закрывается сам,
 *                   как только привязан бокс.
 *   CatStockVault — дивиденды в токенизированных акциях. Делит транш по весу
 *                   редкости; накопленное живёт на коте и уезжает с ним при
 *                   продаже. Кот регистрируется в казне при минте.
 *   CatBox        — кейсы: ровно 10 000 штук, commit-reveal рандом
 *                   (фиксируем блок при покупке, редкость из его хеша).
 *   CatMarket     — эскроу-биржа: 2% с продажи уходит в казну платформы.
 *   CatRenderer   — картинка и метаданные прямо в блокчейне. Маркетплейс
 *                   видит кота сразу после минта, IPFS и сервер не нужны.
 *
 * Порядок вызовов внутри: деплой → setVault → setBox → ростер акций →
 * addPayoutToken для каждой акции выплат → контрольная сверка на цепи.
 *
 * ⚠️  Перед боевым запуском:
 *   — сверь ROSTER: тикер должен совпадать с реальным токеном акции, feed —
 *     это Chainlink-агрегатор для UI и ботов, нулевой адрес допустим;
 *   — дивиденды холдерам NFT в ряде юрисдикций считаются доходом от ценной
 *     бумаги. Это вопрос к юристу, а не к скрипту.
 *
 * Запуск:
 *   PRIVATE_KEY=... node scripts/deploy-cats.js            # боевой прогон
 *   PRIVATE_KEY=... node scripts/deploy-cats.js --dry-run  # только проверки
 */
const fs = require("fs");
const path = require("path");

// ——— настройки запуска ———————————————————————————————————————————————
const BOX_PRICE_ETH  = "0.02";   // цена кейса
const MINT_PRICE_ETH = "0.02";   // цена прямого минта (закроется вместе с боксом)
// Запасной путь для метаданных. Основной — он-чейн рендерер (CatRenderer),
// он привязывается автоматически, поэтому IPFS можно не заполнять вовсе.
const BASE_URI = "";

// Ростер: из него коту достаётся тикер. Порядок важен — id тикера пишется
// в NFT навсегда, добавлять новые можно, менять существующие нельзя.
const ROSTER = [
  ["NVDA", "0x0000000000000000000000000000000000000000"],
  ["AAPL", "0x0000000000000000000000000000000000000000"],
  ["TSLA", "0x0000000000000000000000000000000000000000"],
  ["MSFT", "0x0000000000000000000000000000000000000000"],
  ["AMZN", "0x0000000000000000000000000000000000000000"],
  ["GOOGL", "0x0000000000000000000000000000000000000000"],
  ["META", "0x0000000000000000000000000000000000000000"],
  ["SPY",  "0x0000000000000000000000000000000000000000"],
  ["QQQ",  "0x0000000000000000000000000000000000000000"],
  ["COIN", "0x0000000000000000000000000000000000000000"],
  ["MSTR", "0x0000000000000000000000000000000000000000"],
  ["PLTR", "0x0000000000000000000000000000000000000000"],
];

// Акции, которыми казна платит дивиденды (адреса токенов Robinhood Stock).
// Можно оставить пустым и добавить позже через addPayoutToken.
const PAYOUT_TOKENS = [];

const ART = (n) => JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));

function loadCfg() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) {}
  const rpc = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  const team = process.env.TEAM_WALLET || cfg.teamWallet;
  let pk = process.env.PRIVATE_KEY || cfg.privateKey;
  if (!pk || !team) {
    console.error("Нужны PRIVATE_KEY и TEAM_WALLET (или scripts/deploy-config.json).");
    process.exit(1);
  }
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("Ключ не похож на приватный ключ"); process.exit(1); }
  return { rpc, pk, team };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const { createPublicClient, createWalletClient, http, defineChain, parseEther } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { rpc, pk, team } = loadCfg();

  // ——— проверки до единой транзакции ———
  if (ROSTER.length === 0) { console.error("❌ Пустой ростер — минт упадёт на 'roster empty'."); process.exit(1); }
  if (ROSTER.length > 64) { console.error("❌ В ростер влезает максимум 64 тикера."); process.exit(1); }

  const chain = defineChain({
    id: 4663, name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  const bal = await pub.getBalance({ address: account.address });
  console.log("Сеть:      Robinhood Chain (4663)");
  console.log("Кошелёк:   ", account.address);
  console.log("Баланс:    ", Number(bal) / 1e18, "ETH");
  console.log("Казна/выручка:", team);
  console.log("Тикеров в ростере:", ROSTER.length, "· акций выплат:", PAYOUT_TOKENS.length);
  if (dry) { console.log("\n--dry-run: проверки пройдены, ничего не деплою."); return; }
  if (bal === 0n) { console.error("❌ Нулевой баланс — газа не хватит."); process.exit(1); }

  const deploy = async (name, args) => {
    const art = ART(name);
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rec = await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${name}:`.padEnd(18), rec.contractAddress);
    return rec.contractAddress;
  };
  const send = async (address, name, fn, args = []) => {
    const hash = await wallet.writeContract({ address, abi: ART(name).abi, functionName: fn, args });
    await pub.waitForTransactionReceipt({ hash });
  };

  console.log("\n1/4 Деплой контрактов…");
  const cats     = await deploy("BrokerCats", [parseEther(MINT_PRICE_ETH), team, BASE_URI]);
  const vault    = await deploy("CatStockVault", [cats]);
  const box      = await deploy("CatBox", [cats, team, parseEther(BOX_PRICE_ETH)]);
  const market   = await deploy("CatMarket", [cats, team]);
  const renderer = await deploy("CatRenderer", []);

  console.log("\n2/4 Связка контрактов…");
  await send(cats, "BrokerCats", "setVault", [vault]);
  console.log("  vault привязан — коты регистрируются в дивидендах при минте");
  await send(cats, "BrokerCats", "setBox", [box]);
  console.log("  box привязан — прямой mint() закрыт, кейсы стали единственным платным каналом");
  await send(cats, "BrokerCats", "setRenderer", [renderer]);
  console.log("  renderer привязан — картинка и метаданные собираются он-чейн, IPFS не нужен");

  console.log("\n3/4 Ростер акций…");
  for (const [ticker, feed] of ROSTER) {
    await send(cats, "BrokerCats", "addRoster", [ticker, feed]);
    console.log("  +", ticker);
  }
  for (const token of PAYOUT_TOKENS) {
    await send(vault, "CatStockVault", "addPayoutToken", [token]);
    console.log("  выплаты в", token);
  }

  console.log("\n4/4 Сверка на цепи…");
  const rd = (addr, name, fn, args = []) =>
    pub.readContract({ address: addr, abi: ART(name).abi, functionName: fn, args });
  const [vOn, bOn, rc, supply, boxesLeft, price] = await Promise.all([
    rd(cats, "BrokerCats", "vault"), rd(cats, "BrokerCats", "box"),
    rd(cats, "BrokerCats", "rosterCount"), rd(cats, "BrokerCats", "MAX_SUPPLY"),
    rd(box, "CatBox", "boxesLeft"), rd(box, "CatBox", "boxPrice"),
  ]);
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const ok = same(vOn, vault) && same(bOn, box) && Number(rc) === ROSTER.length;
  if (!ok) { console.error("❌ Связка не сошлась:", { vOn, bOn, rc }); process.exit(1); }
  if (Number(supply) < Number(boxesLeft)) {
    console.error("❌ Потолок котов меньше числа кейсов — часть боксов не откроется.");
    process.exit(1);
  }
  console.log("  ✓ vault/box на месте, тикеров:", Number(rc));
  console.log("  ✓ потолок котов:", Number(supply), "· кейсов:", Number(boxesLeft),
              "· цена кейса:", Number(price) / 1e18, "ETH");

  const out = [
    `VITE_CATS_ADDRESS=${cats}`,
    `VITE_CAT_VAULT_ADDRESS=${vault}`,
    `VITE_CAT_BOX_ADDRESS=${box}`,
    `VITE_CAT_MARKET_ADDRESS=${market}`,
    `# CatRenderer (он-чейн метаданные): ${renderer}`,
  ].join("\n");
  console.log("\n=== ГОТОВО. Адреса для web/.env.production ===\n" + out);
  fs.writeFileSync(path.join(__dirname, "..", "cats-addresses.txt"),
    out + `\n# proceeds/treasury=${team}\n# deployed by ${account.address} at ${new Date().toISOString()}\n`);
  console.log("\nСохранено в cats-addresses.txt");
  console.log("\nДальше:");
  console.log("  1) вписать адреса во фронт — вкладка котов сама уйдёт с песочницы");
  console.log("  2) верификация в Blockscout (make-verify-input.js)");
  console.log("  3) казначей: addPayoutToken на нужные акции + регулярный fund()");
  console.log("  4) аирдроп первым пользователям: airdrop([...]) до 500 адресов");
}

main().catch((e) => { console.error(e); process.exit(1); });
