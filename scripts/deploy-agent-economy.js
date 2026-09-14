#!/usr/bin/env node
/**
 * Экономика ИИ-агента: AgentTreasury + FeeSplitterV4 в мейннет Robinhood Chain.
 *
 * Что делает и в каком порядке:
 *   1. AgentTreasury  — бюджеты агентов по монетам (ETH и валюта), пополняет сплиттер
 *   2. FeeSplitterV4  — делит протокольную долю комиссии; знает, есть ли у монеты ИИ
 *   3. ETH-фабрика:   setConfig — казна → сплиттер, создателю 7000 bps (СРАЗУ, без таймлока)
 *   4. фабрика за валюту: proposeConfig — то же, вступает через 48ч (`--apply`)
 *
 * Экономика (решение владельца 14.09.2026), от комиссии 1%:
 *   монета с ИИ:  создатель 70% · команда 20% · агент монеты 10%
 *   монета без:   создатель 80% · команда 20%
 * Пул отдаёт создателю 70%; остальные 30% приходят в сплиттер, и он делит
 * 2/3 команде, 1/3 — агенту (если создатель включил ИИ: enableAi) или
 * обратно создателю. Казны выкупа в новой схеме нет.
 *
 * ⚠️  ЧТО ИЗМЕНИТСЯ У СУЩЕСТВУЮЩИХ МОНЕТ
 * `creatorFeeShareBps` зашит в пул при создании и неизменяем. Монеты,
 * созданные с 5000, оставляют создателю 50%, а протоколу 50% — сплиттер
 * поделит их в той же пропорции: 33% команде, 17% агенту/создателю.
 * Значения 70/20/10 получат только монеты, созданные ПОСЛЕ смены конфига.
 *
 * КЛЮЧ. Берётся из scripts/deploy-config.json (поле privateKey) — того же
 * файла, которым пользуются остальные деплой-скрипты проекта. Файл лежит в
 * .gitignore и в репозиторий не попадает. Если файла нет, можно задать
 * переменной окружения PRIVATE_KEY. Сам ключ никогда не печатается.
 *
 * ЗАПУСК (боевой — только с машины владельца):
 *   node scripts/deploy-agent-economy.js            # сухой прогон
 *   node scripts/deploy-agent-economy.js --deploy   # деплой + конфиг обеих фабрик
 *   node scripts/deploy-agent-economy.js --apply    # через 48ч: применить заявку фабрики за валюту
 *   node scripts/deploy-agent-economy.js --cancel   # отозвать заявку фабрики за валюту
 *
 * Переменные (необязательно): TEAM_WALLET, AGENT_OPERATOR, FACTORY,
 * QUOTE_FACTORY, RPC_URL. По умолчанию команда и оператор — владелец фабрики.
 *
 * Без --deploy скрипт ничего не отправляет в сеть: печатает план, текущий
 * конфиг фабрик и во что он превратится.
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

// Доля команды от входящего в сплиттер: 2/3 (при 30% протокольной доли = 20%).
const TEAM_NUM = 2n, TEAM_DEN = 3n;
// Создателю 70% — применится только к новым монетам.
const CREATOR_SHARE_BPS = 7000;

const ethFactoryAbi = [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function migrator() view returns (address)",
  "function votePower() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function tokenCount() view returns (uint256)",
  "function setConfig(address treasury_, address migrator_, address votePower_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
  "function pendingConfig() view returns (address treasury, address migrator, address votePower, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt)",
  "function proposeConfig(address treasury_, address migrator_, address votePower_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
  "function applyConfig()",
  "function cancelConfig()",
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

/** Артефакты должны быть от текущих исходников: у V4 есть enableAi/claim, у казны — fundErc20. */
function assertFreshArtifacts() {
  const s = artifact("FeeSplitterV4").abi, t = artifact("AgentTreasury").abi;
  const ok = s.some((f) => f.name === "enableAi") && s.some((f) => f.name === "claim")
    && t.some((f) => f.name === "fundErc20");
  if (!ok) {
    console.error("Артефакты СТАРЫЕ (нет enableAi/claim/fundErc20). Сначала: node scripts/compile.js");
    process.exit(1);
  }
}

async function main() {
  const { createPublicClient, createWalletClient, http, parseAbi, formatEther, toFunctionSelector } = require("viem");
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
  // Сухой прогон только читает сеть — ключ не нужен, подставляем пустышку.
  if (!pk) pk = "0x" + "1".padStart(64, "0");
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

  // --- ETH-фабрика: на мейннете сборка без таймлока (setConfig сразу). Определяем по байткоду.
  const eCode = await pub.getCode({ address: FACTORY });
  const eTimelocked = has(eCode, toFunctionSelector("proposeConfig(address,address,address,uint16,uint16)"));
  const [eOwner, eTreasury, eMigrator, eVote, eFee, eShare, eCount] = await Promise.all([
    readE("owner"), readE("treasury"), readE("migrator"), readE("votePower"), readE("feeBps"), readE("creatorFeeShareBps"), readE("tokenCount"),
  ]);
  // --- фабрика за валюту: всегда через заявку + 48ч
  const [qOwner, qTreasury, qMigrator, qFee, qShare, qCount, qPending] = await Promise.all([
    readQ("owner"), readQ("treasury"), readQ("migrator"), readQ("feeBps"), readQ("creatorFeeShareBps"), readQ("tokenCount"), readQ("pendingConfig"),
  ]);

  const keyFrom = process.env.PRIVATE_KEY ? "переменной окружения" : CFG.privateKey ? "scripts/deploy-config.json" : "— (сухой прогон без ключа)";
  console.log("\nКошелёк      ", (process.env.PRIVATE_KEY || CFG.privateKey) ? account.address : "нет ключа", "· ключ из", keyFrom);
  console.log("Баланс       ", formatEther(await pub.getBalance({ address: account.address })), "ETH");
  console.log("\nETH-фабрика  ", FACTORY, account.address.toLowerCase() === eOwner.toLowerCase() ? "— вы владелец" : "⚠ ВЫ НЕ ВЛАДЕЛЕЦ");
  console.log("  монет", String(eCount), "| казна", eTreasury, "| комиссия", eFee, "bps | создателю", eShare, "bps |", eTimelocked ? "через заявку + 48ч" : "setConfig — сразу");
  console.log("Фабрика за валюту", QUOTE_FACTORY, account.address.toLowerCase() === qOwner.toLowerCase() ? "— вы владелец" : "⚠ ВЫ НЕ ВЛАДЕЛЕЦ");
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
  const OPERATOR = process.env.AGENT_OPERATOR || eOwner;

  console.log("\nПлан:");
  console.log("  1. AgentTreasury(operator =", OPERATOR + ")");
  console.log(`  2. FeeSplitterV4(team = ${TEAM}, казна агента, обе фабрики, доля команды ${TEAM_NUM}/${TEAM_DEN})`);
  console.log(`  3. ETH-фабрика: ${eTimelocked ? "proposeConfig (48ч)" : "setConfig — СРАЗУ"}: казна → сплиттер, создателю ${CREATOR_SHARE_BPS} bps (мигратор и votePower прежние)`);
  console.log(`  4. Фабрика за валюту: proposeConfig (вступит через 48ч, потом --apply): казна → сплиттер, создателю ${CREATOR_SHARE_BPS} bps`);
  console.log("\nСтарые монеты: создателю 50% навсегда, из протокольных 50% → команде 33%, агенту/создателю 17%.");
  console.log("Новые монеты: с ИИ 70 / 20 / 10, без ИИ 80 / 20.");

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
  const agentTreasury = await deploy("AgentTreasury", [OPERATOR]);
  const splitter = await deploy("FeeSplitterV4", [TEAM, agentTreasury, FACTORY, QUOTE_FACTORY, TEAM_NUM, TEAM_DEN]);

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

  console.log("\n— ЗАПИСАТЬ В КОНФИГ САЙТА (web/.env и переменные сборки на GitHub) —");
  console.log("VITE_AGENT_TREASURY=" + agentTreasury);
  console.log("VITE_FEE_SPLITTER=" + splitter);
  console.log("\nЧерез 48 часов: node scripts/deploy-agent-economy.js --apply\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
