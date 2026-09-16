#!/usr/bin/env node
/**
 * ПЕРЕЗАПУСК hood в мейннете Robinhood Chain (chainId 4663) — 09.2026.
 *
 * Новый комплект контрактов с нуля (старые монеты остаются в старых
 * фабриках и с сайта пропадают, когда сайт переключат на новые адреса):
 *
 *   1. UniswapV3Migrator        — градация ETH-монет (исправлен H-1 аудита)
 *   2. LaunchpadFactoryV2       — фабрика ETH-монет (закрыта до initConfig)
 *   3. UniswapV3MigratorQuote   — градация монет за валюту
 *   4. LaunchpadFactoryQuote    — фабрика монет за акции/крипту
 *   5. CurveZap                 — покупка/продажа монет за валюту одним ETH
 *   6. ArenaTreasury (арена)    — 10% комиссий: ежедневный выкуп-сжигание подиума
 *   7. ArenaTreasury (hood)     — 10% комиссий: выкуп монеты hood
 *   8. FeeSplitterV6            — делёж 30% протокольной доли на три казны
 *   9. initConfig обеих фабрик  — 1% комиссии, 70% создателю, казна = сплиттер
 *  10. setDustSink миграторов   — излишки градации → казна арены
 *  11. setQuote WETH/USDG/USDe  — базовые валюты (порог $16k) + маршруты запа
 *
 * Акции и остальную крипту заводит отдельный скрипт по живым ценам:
 *   QUOTE_FACTORY=<новая> ZAP=<новый> node scripts/allow-stocks.js --send
 *
 * Запуск:
 *   node scripts/relaunch.js            # сухой прогон: проверки, план, газ
 *   node scripts/relaunch.js --deploy   # боевой деплой
 *
 * Ключ и RPC — из scripts/deploy-config.json (privateKey, rpcUrl, teamWallet)
 * или PRIVATE_KEY / RPC_URL / TEAM_WALLET. Ключ нигде не печатается.
 * Результат — scripts/relaunch-output.json + список переменных для GitHub.
 */
const fs = require("fs");
const path = require("path");

const MAINNET = {
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  v3Factory:       "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  weth:            "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg:            "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  usde:            "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
};
const ZERO = "0x0000000000000000000000000000000000000000";

// Экономика (решение владельца 16.09.2026):
//   комиссия 1% · создателю 70% · арена 10% · выкуп hood 10% · команда 10%
const FEE_BPS = 100;
const CREATOR_SHARE_BPS = 7000;
const ARENA_NUM = 1n, BUYBACK_NUM = 1n, DEN = 3n; // из 30% — по 10%

async function main() {
  const send = process.argv.includes("--deploy");
  const { createPublicClient, createWalletClient, http, parseUnits, parseEther, formatEther } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) { /* нет файла */ }
  const RPC_URL = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  let PRIVATE_KEY = process.env.PRIVATE_KEY || cfg.privateKey;
  if (!PRIVATE_KEY) { console.error("Нужен ключ: scripts/deploy-config.json → privateKey."); process.exit(1); }
  PRIVATE_KEY = String(PRIVATE_KEY).replace(/["'\s]/g, "");
  if (!PRIVATE_KEY.startsWith("0x")) PRIVATE_KEY = "0x" + PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) { console.error("Ключ не похож на приватный."); process.exit(1); }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(RPC_URL, { retryCount: 3, timeout: 30000 });
  const chainId = await createPublicClient({ transport }).getChainId();
  if (chainId !== 4663) { console.error(`Не та сеть: chainId ${chainId}, нужен 4663 (Robinhood Chain).`); process.exit(1); }
  const chain = { id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } };
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });
  const TEAM = process.env.TEAM_WALLET || cfg.teamWallet || account.address;

  const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));
  // Артефакты должны быть свежими: у фабрик — `configured`, у сплиттера — buybackShareBps.
  const need = [["LaunchpadFactoryV2", "configured"], ["LaunchpadFactoryQuote", "configured"], ["FeeSplitterV6", "buybackShareBps"], ["UniswapV3Migrator", "setAlignBudget"]];
  for (const [n, fn] of need) {
    let abi; try { abi = ART(n).abi; } catch { console.error(`Нет артефакта ${n}. Сначала: node scripts/compile.js`); process.exit(1); }
    if (!abi.some((f) => f.name === fn)) { console.error(`Артефакт ${n} СТАРЫЙ (нет ${fn}). Сначала: node scripts/compile.js`); process.exit(1); }
  }

  const bal = await pub.getBalance({ address: account.address });
  console.log(`${send ? "БОЕВОЙ ПЕРЕЗАПУСК" : "Сухой прогон"} · деплойер ${account.address} · баланс ${formatEther(bal)} ETH`);
  console.log(`команда (10%): ${TEAM}`);
  console.log(`экономика: комиссия ${FEE_BPS / 100}% · создателю ${CREATOR_SHARE_BPS / 100}% · арена/выкуп hood/команда по ${(100 - CREATOR_SHARE_BPS / 100) / 3}%\n`);

  const out = { chainId, deployer: account.address, team: TEAM, at: new Date().toISOString() };
  let gasTotal = 0n;
  async function deploy(name, args = []) {
    const art = ART(name);
    if (!send) {
      const g = await pub.estimateGas({ account: account.address, data: art.bytecode + encodeArgs(art, args) }).catch(() => 0n);
      gasTotal += g;
      console.log(`  ${name.padEnd(24)} газ ≈ ${String(g)}`);
      return `0x${name.length.toString(16).padStart(2, "0")}${"0".repeat(38)}`; // заглушка для плана
    }
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${name}: деплой упал (${hash})`);
    console.log(`  ${name.padEnd(24)} ${rc.contractAddress}`);
    return rc.contractAddress;
  }
  function encodeArgs(art, args) {
    const { encodeAbiParameters } = require("viem");
    const ctor = art.abi.find((f) => f.type === "constructor");
    if (!ctor || !ctor.inputs.length) return "";
    return encodeAbiParameters(ctor.inputs, args).slice(2);
  }
  async function call(address, name, fn, args) {
    if (!send) { console.log(`  ${name}.${fn}(${args.map(String).join(", ")})`); return; }
    const hash = await wallet.writeContract({ address, abi: ART(name).abi, functionName: fn, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${name}.${fn} REVERTED: ${hash}`);
    console.log(`  ✓ ${name}.${fn}`);
  }

  console.log("1/11 Мигратор ETH-монет…");
  const migrator = await deploy("UniswapV3Migrator", [MAINNET.positionManager, MAINNET.weth]);
  console.log("2/11 Фабрика ETH-монет…");
  const factory = await deploy("LaunchpadFactoryV2", [account.address, migrator]);
  console.log("3/11 Мигратор монет за валюту…");
  const migratorQ = await deploy("UniswapV3MigratorQuote", [MAINNET.positionManager]);
  console.log("4/11 Фабрика монет за валюту…");
  const quoteFactory = await deploy("LaunchpadFactoryQuote", [account.address, migratorQ]);
  console.log("5/11 Зап (ETH ⇄ валюта ⇄ монета)…");
  const zap = await deploy("CurveZap", [MAINNET.weth, MAINNET.v3Factory, quoteFactory]);
  console.log("6/11 Казна арены…");
  const arena = await deploy("ArenaTreasury", [account.address, factory, quoteFactory, zap]);
  console.log("7/11 Казна выкупа монеты hood…");
  const hoodTreasury = await deploy("ArenaTreasury", [account.address, factory, quoteFactory, zap]);
  console.log("8/11 Сплиттер комиссий V6…");
  const splitter = await deploy("FeeSplitterV6", [TEAM, arena, hoodTreasury, factory, quoteFactory, ARENA_NUM, BUYBACK_NUM, DEN]);

  console.log("9/11 Настройка фабрик (казна = сплиттер, 1%, 70% создателю)…");
  await call(factory, "LaunchpadFactoryV2", "initConfig", [splitter, migrator, ZERO, FEE_BPS, CREATOR_SHARE_BPS]);
  await call(quoteFactory, "LaunchpadFactoryQuote", "initConfig", [splitter, migratorQ, FEE_BPS, CREATOR_SHARE_BPS]);

  console.log("10/11 Излишки градации → казна арены…");
  await call(migrator, "UniswapV3Migrator", "setDustSink", [arena]);
  await call(migratorQ, "UniswapV3MigratorQuote", "setDustSink", [arena]);

  console.log("11/11 Базовые валюты: WETH, USDG, USDe (порог $16k) + маршруты запа…");
  // virtualQuote = порог/4, кап создателя = порог/10 (как у акций в allow-stocks)
  await call(quoteFactory, "LaunchpadFactoryQuote", "setQuote", [MAINNET.weth, true, parseEther("1.625"), parseEther("0.65")]);
  await call(quoteFactory, "LaunchpadFactoryQuote", "setQuote", [MAINNET.usdg, true, parseUnits("4000", 6), parseUnits("1600", 6)]);
  await call(quoteFactory, "LaunchpadFactoryQuote", "setQuote", [MAINNET.usde, true, parseEther("4000"), parseEther("1600")]);
  await call(zap, "CurveZap", "setRoute", [MAINNET.usdg, ZERO, 500, 0, true]);
  await call(zap, "CurveZap", "setRoute", [MAINNET.usde, MAINNET.usdg, 500, 500, true]);

  if (!send) {
    const gp = await pub.getGasPrice();
    console.log(`\nГаз на деплой контрактов ≈ ${String(gasTotal)} ≈ ${formatEther(gasTotal * gp)} ETH (+ ~10 настроечных транзакций).`);
    console.log("Всё готово к боевому запуску: node scripts/relaunch.js --deploy");
    return;
  }

  // Контрольная сверка с цепи
  const rd = (address, name, fn, args = []) => pub.readContract({ address, abi: ART(name).abi, functionName: fn, args });
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const [fT, fC, fS, qT, qC, qS] = await Promise.all([
    rd(factory, "LaunchpadFactoryV2", "treasury"), rd(factory, "LaunchpadFactoryV2", "configured"), rd(factory, "LaunchpadFactoryV2", "creatorFeeShareBps"),
    rd(quoteFactory, "LaunchpadFactoryQuote", "treasury"), rd(quoteFactory, "LaunchpadFactoryQuote", "configured"), rd(quoteFactory, "LaunchpadFactoryQuote", "creatorFeeShareBps"),
  ]);
  if (!same(fT, splitter) || !fC || Number(fS) !== CREATOR_SHARE_BPS || !same(qT, splitter) || !qC || Number(qS) !== CREATOR_SHARE_BPS) {
    throw new Error("Сверка не сошлась: фабрики настроены не так, как ожидалось. НЕ переключай сайт.");
  }
  const [aBps, bBps, tBps] = await Promise.all([rd(splitter, "FeeSplitterV6", "arenaShareBps"), rd(splitter, "FeeSplitterV6", "buybackShareBps"), rd(splitter, "FeeSplitterV6", "teamShareBps")]);
  console.log(`\nСверка: фабрики настроены, сплиттер делит остаток ${Number(aBps) / 100}% / ${Number(bBps) / 100}% / ${Number(tBps) / 100}% (арена / выкуп hood / команда).`);

  Object.assign(out, { migrator, factory, migratorQ, quoteFactory, zap, arena, hoodTreasury, splitter });
  fs.writeFileSync(path.join(__dirname, "relaunch-output.json"), JSON.stringify(out, null, 2));
  console.log(`\nАдреса сохранены: scripts/relaunch-output.json\n`);
  console.log("Пришли эти адреса в чат — сайт (web/src/lib/config.js) и боты переключу на них:");
  for (const [k, v] of Object.entries({ factory, quoteFactory, zap, splitter, arena, hoodTreasury, migrator, migratorQ })) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log("GitHub → Settings → Secrets and variables → Actions → Variables: ARENA_TREASURY = " + arena);
  console.log(`\nДальше: QUOTE_FACTORY=${quoteFactory} ZAP=${zap} node scripts/allow-stocks.js --send`);
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
