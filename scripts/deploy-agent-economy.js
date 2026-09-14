#!/usr/bin/env node
/**
 * Экономика ИИ-агента: AgentTreasury + FeeSplitterV3 в мейннет Robinhood Chain.
 *
 * Что делает и в каком порядке:
 *   1. AgentTreasury  — покошельковые бюджеты агентов, пополняет сплиттер
 *   2. FeeSplitterV3  — делит протокольную долю комиссии: команда / агент
 *   3. proposeConfig  — заявка фабрике переключить казну на новый сплиттер
 *
 * Шаг 3 НЕ вступает в силу сразу: у фабрики 48-часовой таймлок, заявка
 * висит публично, и только потом `applyConfig()`. Это сделано специально —
 * владелец не может втихую переставить адрес, куда текут комиссии.
 *
 * ⚠️  ЧТО ИЗМЕНИТСЯ У СУЩЕСТВУЮЩИХ МОНЕТ
 * `creatorFeeShareBps` зашит в пул при создании и неизменяем. Все 13 монет
 * созданы с 5000, поэтому создателю там навсегда 50%, а протоколу 50% —
 * сплиттер поделит эти 50% как 33% команде и 17% агенту. Значения 70/20/10
 * получат только монеты, созданные ПОСЛЕ применения конфига.
 *
 * КЛЮЧ. Берётся из scripts/deploy-config.json (поле privateKey) — того же
 * файла, которым пользуются остальные деплой-скрипты проекта. Файл лежит в
 * .gitignore и в репозиторий не попадает. Если файла нет, можно задать
 * переменной окружения PRIVATE_KEY.
 *
 * ЗАПУСК (боевой — только с машины владельца):
 *   node scripts/deploy-agent-economy.js            # сухой прогон
 *   node scripts/deploy-agent-economy.js --deploy   # деплой
 *   node scripts/deploy-agent-economy.js --apply    # через 48ч (если есть таймлок)
 *   node scripts/deploy-agent-economy.js --cancel   # отозвать заявку
 *
 * Без --deploy скрипт ничего не отправляет в сеть: печатает план, текущий
 * конфиг фабрики и во что он превратится.
 */
const fs = require("fs");
const path = require("path");

/** Настройки деплоя: тот же файл, что у остальных скриптов проекта. */
function deployConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); }
  catch (e) { return {}; }
}
const CFG = deployConfig();

const RPC = process.env.RPC_URL || CFG.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = process.env.FACTORY || "0x08a887196fc31b89305ae03aa991917f6b1d23ec";

// Из 30% протокольной доли: команде 20 п.п., агенту 10 п.п. => 6667 bps.
const TEAM_BPS = 6667;
// Создателю 70% — применится только к новым монетам.
const CREATOR_SHARE_BPS = 7000;

const factoryAbi = [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function migrator() view returns (address)",
  "function votePower() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorFeeShareBps() view returns (uint16)",
  "function pendingConfig() view returns (address treasury, address migrator, address votePower, uint16 feeBps, uint16 creatorFeeShareBps, uint256 readyAt)",
  "function proposeConfig(address treasury_, address migrator_, address votePower_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
  "function applyConfig()",
  "function cancelConfig()",
  "function setConfig(address treasury_, address migrator_, address votePower_, uint16 feeBps_, uint16 creatorFeeShareBps_)",
];

/** Селектор функции в развёрнутом байткоде — есть она там или нет. */
function has(code, selector) { return code.includes(selector.slice(2)); }

/** Артефакты лежат в artifacts/<Имя>.json — их кладёт scripts/compile.js. */
function artifact(name) {
  const p = path.join(__dirname, "..", "artifacts", name + ".json");
  if (!fs.existsSync(p)) {
    console.error(`Нет artifacts/${name}.json — сначала скомпилируй: node scripts/compile.js`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const { createPublicClient, createWalletClient, http, parseAbi, formatEther, toFunctionSelector } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  const args = process.argv.slice(2);
  const doDeploy = args.includes("--deploy");
  const doApply = args.includes("--apply");
  const doCancel = args.includes("--cancel");

  let pk = process.env.PRIVATE_KEY || CFG.privateKey;
  if (!pk) {
    console.error("Ключ не найден: нет ни scripts/deploy-config.json с полем privateKey,");
    console.error("ни переменной PRIVATE_KEY. Скрипт запускается только на машине владельца.");
    process.exit(1);
  }
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    // Сам ключ не печатаем никогда — ни целиком, ни куском.
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
  const abi = parseAbi(factoryAbi);

  const read = (fn, a = []) => pub.readContract({ address: FACTORY, abi, functionName: fn, args: a });

  const [owner, treasury, migrator, votePower, feeBps, creatorShare, code] = await Promise.all([
    read("owner"), read("treasury"), read("migrator"), read("votePower"),
    read("feeBps"), read("creatorFeeShareBps"), pub.getCode({ address: FACTORY }),
  ]);

  // На мейннете развёрнута сборка ФАБРИКИ СТАРШЕ репозитория: у неё простой
  // setConfig без таймлока (таймлок добавлен позже, коммит ba18f5c5, и на
  // мейннет не попал). Определяем по байткоду, а не по исходнику, потому что
  // исходник в репозитории и код в сети разошлись.
  const timelocked = has(code, toFunctionSelector("proposeConfig(address,address,address,uint16,uint16)"));
  const pending = timelocked ? await read("pendingConfig") : [null, null, null, 0, 0, 0n];

  console.log("\nФабрика      ", FACTORY);
  console.log("Владелец     ", owner);
  console.log("Ключ взят из ", process.env.PRIVATE_KEY ? "переменной окружения" : "scripts/deploy-config.json");
  console.log("Кошелёк      ", account.address, account.address.toLowerCase() === owner.toLowerCase() ? "— он и есть владелец" : "⚠ НЕ ВЛАДЕЛЕЦ");
  console.log("Баланс       ", formatEther(await pub.getBalance({ address: account.address })), "ETH");
  console.log("\nСейчас: казна", treasury, "| комиссия", feeBps, "bps | создателю", creatorShare, "bps");
  console.log("Смена конфига:", timelocked ? "через заявку + 48ч таймлок" : "setConfig — сразу, без таймлока и без окна для отзыва");
  if (pending[5] > 0n) {
    const ready = new Date(Number(pending[5]) * 1000);
    console.log("Висит заявка: казна", pending[0], "создателю", pending[4], "bps, готова", ready.toISOString());
  }

  // Пока таймлок не истёк, заявку можно отозвать. Страховка на случай
  // «задеплоил не то» — именно ради этого окна таймлок и существует.
  if (doCancel) {
    if (pending[5] === 0n) { console.error("\nНет висящей заявки — отзывать нечего."); process.exit(1); }
    const hash = await wallet.writeContract({ address: FACTORY, abi, functionName: "cancelConfig" });
    console.log("\ncancelConfig →", hash);
    await pub.waitForTransactionReceipt({ hash });
    console.log("Заявка отозвана. Конфиг фабрики не изменился.");
    return;
  }

  if (doApply) {
    if (pending[5] === 0n) { console.error("\nНет висящей заявки — применять нечего."); process.exit(1); }
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < pending[5]) {
      const hours = Number(pending[5] - now) / 3600;
      console.error(`\nРано: таймлок истечёт через ${hours.toFixed(1)} ч.`);
      process.exit(1);
    }
    const hash = await wallet.writeContract({ address: FACTORY, abi, functionName: "applyConfig" });
    console.log("\napplyConfig →", hash);
    await pub.waitForTransactionReceipt({ hash });
    console.log("Готово. Казна теперь:", await read("treasury"));
    return;
  }

  const TEAM = process.env.TEAM_WALLET || owner;
  const OPERATOR = process.env.AGENT_OPERATOR || owner;

  console.log("\nПлан:");
  console.log("  1. AgentTreasury(operator =", OPERATOR + ")");
  console.log("  2. FeeSplitterV3(team =", TEAM + ", teamBps =", TEAM_BPS + ")");
  console.log("  3." + (timelocked ? " proposeConfig (вступит в силу через 48ч)" : " setConfig — ВСТУПИТ В СИЛУ СРАЗУ") + ": казна → новый сплиттер, создателю", CREATOR_SHARE_BPS, "bps");
  console.log("     (мигратор и votePower остаются прежними)");
  console.log("\nСтарые 13 монет: создателю 50% навсегда, из протокольных 50% → команде 33%, агенту 17%.");
  console.log("Новые монеты: 70 / 20 / 10.");

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
  const splitter = await deploy("FeeSplitterV3", [TEAM, agentTreasury, TEAM_BPS]);

  console.log(timelocked ? "\nЗаявка на смену конфига:" : "\nСмена конфига (сразу):");
  const hash = await wallet.writeContract({
    address: FACTORY, abi, functionName: timelocked ? "proposeConfig" : "setConfig",
    args: [splitter, migrator, votePower, feeBps, CREATOR_SHARE_BPS],
  });
  console.log(`  ${timelocked ? "proposeConfig" : "setConfig"} →`, hash);
  await pub.waitForTransactionReceipt({ hash });

  if (timelocked) {
    const p = await read("pendingConfig");
    console.log("  готова к применению:", new Date(Number(p[5]) * 1000).toISOString());
  } else {
    console.log("  казна фабрики теперь:", await read("treasury"));
  }

  console.log("\n— ЗАПИСАТЬ В КОНФИГ САЙТА (web/.env) —");
  console.log("VITE_AGENT_TREASURY=" + agentTreasury);
  console.log("VITE_FEE_SPLITTER=" + splitter);
  console.log(timelocked
    ? "\nЧерез 48 часов: PRIVATE_KEY=... node scripts/deploy-agent-economy.js --apply\n"
    : "\nКонфиг уже applied — таймлока на этой сборке фабрики нет.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
