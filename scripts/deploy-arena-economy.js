#!/usr/bin/env node
/**
 * Экономика 70 / 20 / 10 (решение владельца 15.09.2026):
 *   ArenaTreasury + FeeSplitterV5 в мейннет Robinhood Chain.
 *
 * Что делает и в каком порядке:
 *   1. ArenaTreasury  — казна арены: деньги уходят только на выкуп и сжигание
 *                       монет подиума (владелец — кошелёк бота арены)
 *   2. FeeSplitterV5  — делит протокольную долю: половина арене, четверть
 *                       команде, четверть агенту монеты (если ИИ включён) или
 *                       создателю; включённый на V4 ИИ действует и здесь
 *   3. ETH-фабрика:   setConfig — казна → V5, создателю 6000 bps (сразу)
 *   4. фабрика за валюту: proposeConfig — то же, вступает через 48ч (`--apply`).
 *      Висящая заявка на V4 (7000 bps) этой заявкой ЗАМЕНЯЕТСЯ.
 *
 * От комиссии 1%:
 *   монета без ИИ: создатель 70% · арена 20% · команда 10%
 *   монета с ИИ:   создатель 60% · арена 20% · команда 10% · агент монеты 10%
 * Пул отдаёт создателю 60%; остальные 40% приходят в сплиттер.
 *
 * ⚠️  ЧТО ИЗМЕНИТСЯ У СУЩЕСТВУЮЩИХ МОНЕТ
 * `creatorFeeShareBps` зашит в пул при создании и неизменяем. Монеты с 7000
 * присылают в сплиттер 30%: арене 15%, команде 7.5%, создателю/агенту 7.5%
 * (создателю без ИИ итого 77.5%). Монеты с 5000 присылают 50%: арене 25%,
 * команде 12.5%, создателю/агенту 12.5%. Ровно 70/20/10 — только у монет,
 * созданных ПОСЛЕ смены конфига.
 *
 * КЛЮЧ. Берётся из scripts/deploy-config.json (поле privateKey) — того же
 * файла, которым пользуются остальные деплой-скрипты проекта. Файл лежит в
 * .gitignore. Иначе — переменная окружения PRIVATE_KEY. Ключ никогда не печатается.
 *
 * ЗАПУСК (боевой — только с машины владельца):
 *   node scripts/deploy-arena-economy.js            # сухой прогон
 *   node scripts/deploy-arena-economy.js --deploy   # деплой + конфиг обеих фабрик
 *   node scripts/deploy-arena-economy.js --apply    # через 48ч: применить заявку фабрики за валюту
 *   node scripts/deploy-arena-economy.js --cancel   # отозвать заявку фабрики за валюту
 *
 * Переменные (необязательно):
 *   ARENA_OWNER   — кошелёк бота арены, владелец казны (по умолчанию — деплоящий кошелёк;
 *                   лучше отдельный кошелёк, чей ключ лежит в GitHub Secret ARENA_PRIVATE_KEY)
 *   TEAM_WALLET   — кошелёк команды (по умолчанию — владелец фабрики)
 *   AGENT_TREASURY, PREV_SPLITTER, ZAP, FACTORY, QUOTE_FACTORY, RPC_URL — адреса контрактов
 */
const fs = require("fs");
const path = require("path");

function deployConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); }
  catch (e) { return {}; }
}
const CFG = deployConfig();

const RPC = process.env.RPC_URL || CFG.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY || "0x08a887196fc31b89305ae03aa991917f6b1d23ec";
const QUOTE_FACTORY = process.env.QUOTE_FACTORY || "0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f";
const AGENT_TREASURY = process.env.AGENT_TREASURY || "0xe39e61c2e2897a59dde71d75b7b84f42ed09fd0c";
// Прежний сплиттер V4 (0x4b4ca78517a48876a4341cbbfbd96e15c9d99491): включённый там ИИ
// действовал бы и в V5. ИИ монет выключен на сайте 15.09.2026 — по умолчанию не переносим
// (иначе четверть входящего у таких монет уходила бы в неиспользуемый бюджет агента).
const PREV_SPLITTER = process.env.PREV_SPLITTER || "0x0000000000000000000000000000000000000000";
const ZAP = process.env.ZAP || "0xab963a68f495097aa434fff8e183de5ab86d5099";

// Доли от входящего в сплиттер: арене 2/4, команде 1/4, остаток агенту/создателю.
const ARENA_NUM = 2n, TEAM_NUM = 1n, DEN = 4n;
// Создателю 60% в пуле — применится только к новым монетам.
const CREATOR_SHARE_BPS = 6000;

const ethFactoryAbi = [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function migrator() view returns (address)",
  "function votePower() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function tokenCount() view returns (uint256)",
  "function setConfig(address treasury_, address migrator_, address votePower_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
  "function proposeConfig(address treasury_, address migrator_, address votePower_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
  "function applyConfig()",
];
const quoteFactoryAbi = [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function migrator() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function tokenCount() view returns (uint256)",
  "function pendingConfig() view returns (address treasury, address migrator, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt)",
  "function proposeConfig(address treasury_, address migrator_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
  "function applyConfig()",
  "function cancelConfig()",
];

function has(code, selector) { return code.includes(selector.slice(2)); }

function artifact(name) {
  const p = path.join(__dirname, "..", "artifacts", name + ".json");
  if (!fs.existsSync(p)) {
    console.error(`Нет artifacts/${name}.json — сначала скомпилируй: node scripts/compile.js`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Артефакты должны быть от текущих исходников. */
function assertFreshArtifacts() {
  const s = artifact("FeeSplitterV5").abi, t = artifact("ArenaTreasury").abi;
  const ok = s.some((f) => f.name === "arenaShareBps") && s.some((f) => f.name === "prev")
    && t.some((f) => f.name === "buybackViaZap");
  if (!ok) {
    console.error("Артефакты СТАРЫЕ (нет arenaShareBps/prev/buybackViaZap). Сначала: node scripts/compile.js");
    process.exit(1);
  }
}

async function main() {
  const { createPublicClient, createWalletClient, http, parseAbi, formatEther, toFunctionSelector, isAddress } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  const args = process.argv.slice(2);
  const doDeploy = args.includes("--deploy");
  const doApply = args.includes("--apply");
  const doCancel = args.includes("--cancel");
  assertFreshArtifacts();

  let pk = process.env.PRIVATE_KEY || CFG.privateKey;
  const needKey = doDeploy || doApply || doCancel;
  if (!pk && needKey) {
    console.error("Ключ не найден: нет ни scripts/deploy-config.json с полем privateKey,");
    console.error("ни переменной PRIVATE_KEY. Скрипт запускается только на машине владельца.");
    process.exit(1);
  }
  if (!pk) pk = "0x" + "1".padStart(64, "0"); // сухой прогон только читает сеть
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error("Ключ не похож на приватный: нужны 64 шестнадцатеричных символа.");
    process.exit(1);
  }

  const chain = {
    id: 4663, name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  };
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const eAbi = parseAbi(ethFactoryAbi), qAbi = parseAbi(quoteFactoryAbi);
  const readE = (fn, a = []) => pub.readContract({ address: FACTORY, abi: eAbi, functionName: fn, args: a });
  const readQ = (fn, a = []) => pub.readContract({ address: QUOTE_FACTORY, abi: qAbi, functionName: fn, args: a });

  const eCode = await pub.getCode({ address: FACTORY });
  const eTimelocked = has(eCode, toFunctionSelector("proposeConfig(address,address,address,uint16,uint16)"));
  const [eOwner, eTreasury, eMigrator, eVote, eFee, eShare, eCount] = await Promise.all([
    readE("owner"), readE("treasury"), readE("migrator"), readE("votePower"), readE("feeBps"), readE("creatorFeeShareBps"), readE("tokenCount"),
  ]);
  const [qOwner, qTreasury, qMigrator, qFee, qShare, qCount, qPending] = await Promise.all([
    readQ("owner"), readQ("treasury"), readQ("migrator"), readQ("feeBps"), readQ("creatorFeeShareBps"), readQ("tokenCount"), readQ("pendingConfig"),
  ]);

  const hasKey = Boolean(process.env.PRIVATE_KEY || CFG.privateKey);
  console.log("\nКошелёк      ", hasKey ? account.address : "нет ключа (сухой прогон)");
  if (hasKey) console.log("Баланс       ", formatEther(await pub.getBalance({ address: account.address })), "ETH");
  console.log("\nETH-фабрика  ", FACTORY, hasKey && account.address.toLowerCase() === eOwner.toLowerCase() ? "— вы владелец" : `(владелец ${eOwner})`);
  console.log("  монет", String(eCount), "| казна", eTreasury, "| комиссия", eFee, "bps | создателю", eShare, "bps |", eTimelocked ? "с таймлоком" : "без таймлока");
  console.log("Фабрика за валюту", QUOTE_FACTORY, hasKey && account.address.toLowerCase() === qOwner.toLowerCase() ? "— вы владелец" : `(владелец ${qOwner})`);
  console.log("  монет", String(qCount), "| казна", qTreasury, "| комиссия", qFee, "bps | создателю", qShare, "bps | через заявку + 48ч");
  if (qPending[4] > 0n) {
    console.log("  висит заявка: казна", qPending[0], "создателю", qPending[3], "bps, готова", new Date(Number(qPending[4]) * 1000).toISOString());
  }

  if (doCancel) {
    if (qPending[4] === 0n) { console.error("\nНет висящей заявки у фабрики за валюту — отзывать нечего."); process.exit(1); }
    const hash = await wallet.writeContract({ address: QUOTE_FACTORY, abi: qAbi, functionName: "cancelConfig" });
    console.log("\ncancelConfig →", hash);
    await pub.waitForTransactionReceipt({ hash });
    console.log("Заявка отозвана. Конфиг фабрики за валюту не изменился.");
    return;
  }

  if (doApply) {
    if (qPending[4] === 0n) { console.error("\nНет висящей заявки — применять нечего."); process.exit(1); }
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < qPending[4]) {
      console.error(`\nРано: таймлок истечёт через ${(Number(qPending[4] - now) / 3600).toFixed(1)} ч.`);
      process.exit(1);
    }
    const hash = await wallet.writeContract({ address: QUOTE_FACTORY, abi: qAbi, functionName: "applyConfig" });
    console.log("\napplyConfig →", hash);
    await pub.waitForTransactionReceipt({ hash });
    console.log("Готово. Казна фабрики за валюту теперь:", await readQ("treasury"), "| создателю", await readQ("creatorFeeShareBps"), "bps");
    return;
  }

  const TEAM = process.env.TEAM_WALLET || eOwner;
  const ARENA_OWNER = process.env.ARENA_OWNER || (hasKey ? account.address : eOwner);
  for (const [k, v] of Object.entries({ TEAM, ARENA_OWNER, AGENT_TREASURY, PREV_SPLITTER, ZAP })) {
    if (!isAddress(v)) { console.error(`Плохой адрес ${k}: ${v}`); process.exit(1); }
  }

  console.log("\nПлан:");
  console.log(`  1. ArenaTreasury(owner = ${ARENA_OWNER}, обе фабрики, зап ${ZAP})`);
  console.log(`  2. FeeSplitterV5(team = ${TEAM}, казна арены, казна агента ${AGENT_TREASURY}, обе фабрики,`);
  console.log(`     прежний сплиттер ${PREV_SPLITTER}, доли: арене ${ARENA_NUM}/${DEN}, команде ${TEAM_NUM}/${DEN})`);
  console.log(`  3. ETH-фабрика: ${eTimelocked ? "proposeConfig (48ч)" : "setConfig — СРАЗУ"}: казна → V5, создателю ${CREATOR_SHARE_BPS} bps`);
  console.log(`  4. Фабрика за валюту: proposeConfig (вступит через 48ч, потом --apply): казна → V5, создателю ${CREATOR_SHARE_BPS} bps`);
  if (qPending[4] > 0n) console.log("     ⚠ висящая заявка (V4, 7000 bps) будет заменена этой");
  console.log("\nНовые монеты: без ИИ 70 / 20 / 10, с ИИ 60 / 20 / 10 / 10 (создатель / арена / команда / агент).");
  console.log("Монеты с 7000: арене 15%, команде 7.5%, создателю/агенту 7.5%. С 5000: 25% / 12.5% / 12.5%.");
  if (ARENA_OWNER.toLowerCase() === eOwner.toLowerCase()) {
    console.log("\n⚠ Владелец казны арены = ваш основной кошелёк. Бот арены подписывает выкупы этим");
    console.log("  ключом — лучше отдельный кошелёк: ARENA_OWNER=0x… (его ключ → GitHub Secret ARENA_PRIVATE_KEY).");
  }

  if (!doDeploy) {
    console.log("\nСухой прогон — в сеть ничего не отправлено. Для деплоя добавь --deploy.\n");
    return;
  }

  const deploy = async (name, args2) => {
    const a = artifact(name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args: args2 });
    console.log(`  ${name} → ${hash}`);
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${name} =`, r.contractAddress);
    return r.contractAddress;
  };

  console.log("\nДеплой:");
  const arena = await deploy("ArenaTreasury", [ARENA_OWNER, FACTORY, QUOTE_FACTORY, ZAP]);
  const splitter = await deploy("FeeSplitterV5", [TEAM, arena, AGENT_TREASURY, FACTORY, QUOTE_FACTORY, PREV_SPLITTER, ARENA_NUM, TEAM_NUM, DEN]);

  console.log("\nETH-фабрика:", eTimelocked ? "заявка на смену конфига" : "смена конфига (сразу)");
  {
    const hash = await wallet.writeContract({
      address: FACTORY, abi: eAbi, functionName: eTimelocked ? "proposeConfig" : "setConfig",
      args: [splitter, eMigrator, eVote, eFee, CREATOR_SHARE_BPS],
    });
    console.log(`  ${eTimelocked ? "proposeConfig" : "setConfig"} →`, hash);
    await pub.waitForTransactionReceipt({ hash });
    console.log("  казна ETH-фабрики теперь:", await readE("treasury"), "| создателю", await readE("creatorFeeShareBps"), "bps");
  }

  console.log("\nФабрика за валюту: заявка на смену конфига");
  {
    const hash = await wallet.writeContract({
      address: QUOTE_FACTORY, abi: qAbi, functionName: "proposeConfig",
      args: [splitter, qMigrator, qFee, CREATOR_SHARE_BPS],
    });
    console.log("  proposeConfig →", hash);
    await pub.waitForTransactionReceipt({ hash });
    const p = await readQ("pendingConfig");
    console.log("  готова к применению:", new Date(Number(p[4]) * 1000).toISOString());
  }

  console.log("\n— ЗАПИСАТЬ В КОНФИГ САЙТА (web/src/lib/config.js, значения по умолчанию) —");
  console.log("FEE_SPLITTER_ADDRESS =", splitter);
  console.log("ARENA_TREASURY_ADDRESS =", arena);
  console.log("\n— GitHub → Settings → Secrets and variables → Actions —");
  console.log("Variable ARENA_TREASURY =", arena);
  console.log("Secret   ARENA_PRIVATE_KEY = ключ кошелька", ARENA_OWNER, "(на нём должно быть немного ETH на газ)");
  console.log("\nЧерез 48 часов: node scripts/deploy-arena-economy.js --apply\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
