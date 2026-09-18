#!/usr/bin/env node
/**
 * ПЕРЕЗАПУСК hood V3 в мейннете Robinhood Chain (chainId 4663) — 18.09.2026.
 *
 * Зачем третий перезапуск (решение владельца 17.09.2026):
 *   - стартовый налог против снайперов, как у Pons: первые 5 секунд после
 *     запуска покупка облагается налогом 99% → 0 (создатель и до 32 адресов
 *     освобождены; налог идёт в общий котёл комиссий). Живёт в пуле, пулы
 *     создаёт фабрика → нужны новые фабрики;
 *   - казна умеет покупать ГРАДУИРОВАВШУЮ монету на Uniswap V3 (V2 умела
 *     только с кривой — после градации выкупы останавливались);
 *   - новые кошельки владельца/команды/ботов.
 *
 * Все контракты — с нуля, таймлок не нужен (initConfig у свежих фабрик):
 *   владелец = деплойер (hood · Владелец)   — владеет всеми контрактами;
 *   команда (hood · Команда 10%)            — получает командную долю комиссий;
 *   бот арены (hood · Бот арены)            — ОПЕРАТОР обеих казн (ключ в GitHub);
 *   бот дивидендов (hood · Бот дивидендов)  — просто платит газ (ключ в GitHub).
 *
 * Комплект контрактов:
 *   1. UniswapV3Migrator        — градация ETH-монет
 *   2. LaunchpadFactoryV3       — фабрика ETH-монет (пулы с антиснайп-налогом)
 *   3. UniswapV3MigratorQuote   — градация монет за валюту
 *   4. LaunchpadFactoryQuoteV3  — фабрика монет за акции/крипту (то же)
 *   5. CurveZap                 — покупка/продажа монет за валюту одним ETH
 *   6. ArenaTreasuryV3 (арена)  — 10% комиссий → ежедневный выкуп-сжигание подиума (кривая или DEX)
 *   7. ArenaTreasuryV3 (hood)   — 10% комиссий → ежечасный выкуп монеты hood (кривая или DEX)
 *   8. FeeSplitterV6            — делёж 30% протокольной доли на три адреса
 *   9. initConfig обеих фабрик  — 1% комиссии, 70% создателю, казна = сплиттер
 *  10. setDustSink миграторов   — излишки градации → казна арены
 *  11. setQuote WETH/USDG/USDe  — базовые валюты (порог ≈4 ETH; USDG/USDe затем выравнивает allow-stocks) + маршруты запа
 *
 * ProfileRegistry и FeeClaimer от фабрик не зависят — остаются старые.
 * Акции и остальную крипту заводит отдельный скрипт по живым ценам:
 *   QUOTE_FACTORY=<новая> ZAP=<новый> node scripts/allow-stocks.js --send
 *
 * Запуск:
 *   node scripts/relaunch-v4.js            # сухой прогон: проверки, план, газ (ничего не шлёт)
 *   node scripts/relaunch-v4.js --deploy   # боевой деплой (с контрольными точками)
 *   node scripts/relaunch-v4.js --check    # сверить уже задеплоенный комплект с цепью
 *
 * Контрольные точки: каждый шаг пишется в scripts/relaunch-v4-progress.json.
 * Если деплой оборвался (RPC, газ), повторный --deploy продолжит с места
 * обрыва и НЕ задеплоит контракты второй раз.
 *
 * Ключ и RPC — из scripts/deploy-config.json (privateKey, rpcUrl) или
 * PRIVATE_KEY / RPC_URL. Ключ нигде не печатается. Кошельки команды и бота —
 * константы WALLETS ниже (переопределить: TEAM_WALLET / ARENA_BOT). Скрипт
 * отказывается работать, если ключ не от кошелька-владельца из WALLETS.
 * Результат — scripts/relaunch-v4-output.json.
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
const FEE_TIERS = [100, 500, 3000, 10000];

// Кошельки перезапуска (созданы владельцем 17.09.2026, MetaMask «hood · …»).
const WALLETS = {
  owner:    "0x262a7F257A20aBf338dB44ffEb37eC3922Bc4168", // hood · Владелец — деплойер и owner всего
  team:     "0x492eC12B89AAbB2fCF41c297Bd909B8e3498Db0c", // hood · Команда 10%
  arenaBot: "0xB2DDdF862C52aEe0c9d27c9D4AD7a2099fE7D164", // hood · Бот арены — оператор казн (ARENA_PRIVATE_KEY)
  divBot:   "0x6974E398dbbe87c4752E27DEa8394488e76e2E56", // hood · Бот дивидендов — газ выплат и миграций (TREASURER_PRIVATE_KEY)
};

// Экономика (решение владельца 16.09.2026):
//   комиссия 1% · создателю 70% · арена 10% · выкуп hood 10% · команда 10%
const FEE_BPS = 100;
const CREATOR_SHARE_BPS = 7000;
const ARENA_NUM = 1n, BUYBACK_NUM = 1n, DEN = 3n; // из 30% — по 10%

const OUT_FILE = path.join(__dirname, "relaunch-v4-output.json");
const PROGRESS_FILE = path.join(__dirname, "relaunch-v4-progress.json");
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

async function main() {
  const send = process.argv.includes("--deploy");
  const checkOnly = process.argv.includes("--check");
  const { createPublicClient, createWalletClient, http, parseUnits, parseEther, formatEther, encodeAbiParameters, parseAbi } = require("viem");
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

  const TEAM = process.env.TEAM_WALLET || WALLETS.team;
  const OPERATOR = process.env.ARENA_BOT || WALLETS.arenaBot;
  const OWNER = account.address; // владелец = деплойер (hood · Владелец)
  if (!same(OWNER, WALLETS.owner) && !process.argv.includes("--any-owner")) {
    console.error(`✗ Ключ в deploy-config.json — от кошелька ${OWNER}, а владельцем V3 должен быть ${WALLETS.owner} (hood · Владелец). Положи в файл ключ этого кошелька.`);
    process.exit(1);
  }

  const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));
  const rd = (address, name, fn, args = []) => pub.readContract({ address, abi: ART(name).abi, functionName: fn, args });

  // ---------------------------------------------------------------- --check
  if (checkOnly) {
    let out; try { out = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")); } catch (e) { console.error(`Нет ${OUT_FILE} — сверять нечего.`); process.exit(1); }
    const problems = await verifyOnChain(out, { rd, pub, parseAbi, OWNER: out.owner, OPERATOR: out.operator, TEAM: out.team });
    report(problems); process.exit(problems.length ? 1 : 0);
  }

  // ---------------------------------------------------------------- проверки до старта
  const fail = (m) => { console.error("✗ " + m); process.exit(1); };
  if (!isAddr(TEAM) || same(TEAM, ZERO)) fail("Кошелёк команды не задан (WALLETS.team / TEAM_WALLET).");
  if (!isAddr(OPERATOR) || same(OPERATOR, ZERO)) fail("Кошелёк бота арены не задан (WALLETS.arenaBot / ARENA_BOT). Это оператор казн.");
  const warns = [];
  if (same(TEAM, account.address)) warns.push("команда = деплойер (комиссии пойдут на кошелёк владельца)");
  if (same(OPERATOR, account.address)) warns.push("бот арены = деплойер: ключ владельца окажется в GitHub — так не надо");
  // Артефакты должны быть свежими
  const need = [["LaunchpadFactoryV3", "configured"], ["LaunchpadFactoryQuoteV3", "configured"], ["BondingCurvePoolV3", "openingTaxBps"], ["BondingCurvePoolQuoteV3", "openingTaxBps"], ["FeeSplitterV6", "buybackShareBps"], ["UniswapV3Migrator", "setAlignBudget"], ["ArenaTreasuryV3", "buybackDex"], ["CurveZap", "hasRoute"]];
  for (const [n, fn] of need) {
    let abi; try { abi = ART(n).abi; } catch { fail(`Нет артефакта ${n}. Сначала: node scripts/compile.js`); }
    if (!abi.some((f) => f.name === fn)) fail(`Артефакт ${n} СТАРЫЙ (нет ${fn}). Сначала: node scripts/compile.js`);
  }
  // Кошелёк: баланс и отсутствие зависших транзакций
  const [bal, nonceLatest, noncePending] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.getTransactionCount({ address: account.address, blockTag: "latest" }),
    pub.getTransactionCount({ address: account.address, blockTag: "pending" }),
  ]);
  if (noncePending !== nonceLatest) fail(`У деплойера зависла транзакция (nonce ${nonceLatest} → pending ${noncePending}). Дождись или отмени её в кошельке.`);
  // Пулы V3 для маршрутов запа — берём самый ликвидный тир комиссии
  const v3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
  const poolAbi = parseAbi(["function liquidity() view returns (uint128)"]);
  async function bestFee(a, b, label) {
    let best = null;
    for (const fee of FEE_TIERS) {
      const p = await pub.readContract({ address: MAINNET.v3Factory, abi: v3Abi, functionName: "getPool", args: [a, b, fee] }).catch(() => ZERO);
      if (same(p, ZERO)) continue;
      const liq = await pub.readContract({ address: p, abi: poolAbi, functionName: "liquidity" }).catch(() => 0n);
      if (!best || liq > best.liq) best = { fee, liq, pool: p };
    }
    if (!best || best.liq === 0n) fail(`Нет пула Uniswap V3 с ликвидностью для ${label} — маршрут запа задать нельзя.`);
    console.log(`  маршрут ${label}: пул ${best.pool} (комиссия ${best.fee / 10000}%)`);
    return best.fee;
  }
  console.log(`${send ? "БОЕВОЙ ПЕРЕЗАПУСК V3" : "Сухой прогон V3"} · деплойер/владелец ${account.address} · баланс ${formatEther(bal)} ETH`);
  console.log(`команда (10%):   ${TEAM}`);
  console.log(`бот арены (оператор казн): ${OPERATOR}`);
  console.log(`бот дивидендов (газ, не в контрактах): ${WALLETS.divBot}`);
  console.log("антиснайп: стартовый налог 99% → 0 за 5 секунд у каждой новой монеты; казны покупают и на кривой, и на Uniswap после градации");
  console.log(`экономика: комиссия ${FEE_BPS / 100}% · создателю ${CREATOR_SHARE_BPS / 100}% · арена/выкуп hood/команда по ${(100 - CREATOR_SHARE_BPS / 100) / 3}%`);
  for (const w of warns) console.log("⚠ " + w);
  console.log("\nМаршруты запа (валюта ⇄ WETH):");
  const feeUsdgWeth = await bestFee(MAINNET.usdg, MAINNET.weth, "USDG ⇄ WETH");
  const feeUsdeUsdg = await bestFee(MAINNET.usde, MAINNET.usdg, "USDe ⇄ USDG");
  console.log("");

  // ---------------------------------------------------------------- контрольные точки
  let progress = { addr: {}, done: {} };
  if (send) {
    try { progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch (e) { /* первый запуск */ }
    if (progress.deployer && !same(progress.deployer, account.address)) fail(`В ${PROGRESS_FILE} прошлый деплой от другого кошелька (${progress.deployer}). Удали файл, если это точно новый запуск.`);
    if (Object.keys(progress.addr).length) console.log(`Продолжаю прерванный деплой: уже есть ${Object.keys(progress.addr).join(", ")}\n`);
    progress.deployer = account.address;
  }
  const save = () => { if (send) fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2)); };

  let gasTotal = 0n;
  function encodeArgs(art, args) {
    const ctor = art.abi.find((f) => f.type === "constructor");
    if (!ctor || !ctor.inputs.length) return "";
    return encodeAbiParameters(ctor.inputs, args).slice(2);
  }
  async function deploy(key, name, args = []) {
    const art = ART(name);
    if (!send) {
      const g = await pub.estimateGas({ account: account.address, data: art.bytecode + encodeArgs(art, args) }).catch(() => 0n);
      gasTotal += g;
      console.log(`  ${name.padEnd(24)} газ ≈ ${String(g)}`);
      return `0x${(key.length + 1).toString(16).padStart(2, "0")}${"0".repeat(38)}`; // заглушка для плана
    }
    if (progress.addr[key]) { console.log(`  ${name.padEnd(24)} ${progress.addr[key]} (уже задеплоен)`); return progress.addr[key]; }
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${name}: деплой упал (${hash})`);
    console.log(`  ${name.padEnd(24)} ${rc.contractAddress}`);
    progress.addr[key] = rc.contractAddress; progress.tx = progress.tx || {}; progress.tx[key] = hash;
    if (!progress.block) progress.block = Number(rc.blockNumber); // блок первого деплоя — старт индексации сабграфа
    save();
    return rc.contractAddress;
  }
  async function call(key, address, name, fn, args) {
    if (!send) { console.log(`  ${name}.${fn}(${args.map(String).join(", ")})`); return; }
    if (progress.done[key]) { console.log(`  ✓ ${name}.${fn} (уже сделано)`); return; }
    // сначала симуляция — понятная причина вместо «REVERTED»
    await pub.simulateContract({ account: account.address, address, abi: ART(name).abi, functionName: fn, args });
    const hash = await wallet.writeContract({ address, abi: ART(name).abi, functionName: fn, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${name}.${fn} REVERTED: ${hash}`);
    console.log(`  ✓ ${name}.${fn}`);
    progress.done[key] = hash; save();
  }

  console.log("1/11 Мигратор ETH-монет…");
  const migrator = await deploy("migrator", "UniswapV3Migrator", [MAINNET.positionManager, MAINNET.weth]);
  console.log("2/11 Фабрика ETH-монет…");
  const factory = await deploy("factory", "LaunchpadFactoryV3", [OWNER, migrator]);
  console.log("3/11 Мигратор монет за валюту…");
  const migratorQ = await deploy("migratorQ", "UniswapV3MigratorQuote", [MAINNET.positionManager]);
  console.log("4/11 Фабрика монет за валюту…");
  const quoteFactory = await deploy("quoteFactory", "LaunchpadFactoryQuoteV3", [OWNER, migratorQ]);
  console.log("5/11 Зап (ETH ⇄ валюта ⇄ монета)…");
  const zap = await deploy("zap", "CurveZap", [MAINNET.weth, MAINNET.v3Factory, quoteFactory]);
  console.log("6/11 Казна арены (V3: копит в ETH, покупает на кривой и на DEX, оператор — бот)…");
  const arena = await deploy("arena", "ArenaTreasuryV3", [OWNER, OPERATOR, factory, quoteFactory, zap, MAINNET.weth, MAINNET.v3Factory]);
  console.log("7/11 Казна выкупа монеты hood (V3, выкуп раз в час)…");
  const hoodTreasury = await deploy("hoodTreasury", "ArenaTreasuryV3", [OWNER, OPERATOR, factory, quoteFactory, zap, MAINNET.weth, MAINNET.v3Factory]);
  console.log("8/11 Сплиттер комиссий V6…");
  const splitter = await deploy("splitter", "FeeSplitterV6", [TEAM, arena, hoodTreasury, factory, quoteFactory, ARENA_NUM, BUYBACK_NUM, DEN]);

  console.log("9/11 Настройка фабрик (казна = сплиттер, 1%, 70% создателю)…");
  await call("initEth", factory, "LaunchpadFactoryV3", "initConfig", [splitter, migrator, ZERO, FEE_BPS, CREATOR_SHARE_BPS]);
  await call("initQuote", quoteFactory, "LaunchpadFactoryQuoteV3", "initConfig", [splitter, migratorQ, FEE_BPS, CREATOR_SHARE_BPS]);

  console.log("10/11 Излишки градации → казна арены…");
  await call("dustEth", migrator, "UniswapV3Migrator", "setDustSink", [arena]);
  await call("dustQuote", migratorQ, "UniswapV3MigratorQuote", "setDustSink", [arena]);

  console.log("11/11 Базовые валюты: WETH, USDG, USDe + маршруты запа (порог долларовых выровняет allow-stocks под 4 ETH)…");
  // virtualQuote = порог/4, кап создателя = порог/10 (как у акций в allow-stocks)
  await call("qWeth", quoteFactory, "LaunchpadFactoryQuoteV3", "setQuote", [MAINNET.weth, true, parseEther("1"), parseEther("0.4")]);
  await call("qUsdg", quoteFactory, "LaunchpadFactoryQuoteV3", "setQuote", [MAINNET.usdg, true, parseUnits("4000", 6), parseUnits("1600", 6)]);
  await call("qUsde", quoteFactory, "LaunchpadFactoryQuoteV3", "setQuote", [MAINNET.usde, true, parseEther("4000"), parseEther("1600")]);
  await call("rUsdg", zap, "CurveZap", "setRoute", [MAINNET.usdg, ZERO, feeUsdgWeth, 0, true]);
  await call("rUsde", zap, "CurveZap", "setRoute", [MAINNET.usde, MAINNET.usdg, feeUsdgWeth, feeUsdeUsdg, true]);

  if (!send) {
    const gp = await pub.getGasPrice();
    const est = gasTotal * gp;
    const needEth = est * 3n / 2n + parseEther("0.002"); // + настроечные транзакции, запас ×1.5
    console.log(`\nГаз на деплой контрактов ≈ ${String(gasTotal)} ≈ ${formatEther(est)} ETH; с настройкой и запасом нужно ≈ ${formatEther(needEth)} ETH.`);
    if (bal < needEth) console.log(`✗ На кошельке ${formatEther(bal)} ETH — мало. Пополни и повтори.`);
    else console.log("Всё готово к боевому запуску: node scripts/relaunch-v4.js --deploy");
    return;
  }

  const out = { chainId, at: new Date().toISOString(), deployer: account.address, owner: OWNER, operator: OPERATOR, team: TEAM,
    migrator, factory, migratorQ, quoteFactory, zap, arena, hoodTreasury, splitter,
    routes: { usdg: { mid: ZERO, fee1: feeUsdgWeth }, usde: { mid: MAINNET.usdg, fee1: feeUsdgWeth, fee2: feeUsdeUsdg } },
    startBlock: Math.max(0, Number(progress.block || 0) - 1), tx: progress.tx || {} };

  console.log("\nСверка с цепью…");
  const problems = await verifyOnChain(out, { rd, pub, parseAbi, OWNER, OPERATOR, TEAM });
  report(problems);
  if (problems.length) { console.error("\nНЕ переключай сайт: комплект настроен не так, как ожидалось. Прогресс сохранён в " + PROGRESS_FILE); process.exit(1); }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  try { fs.unlinkSync(PROGRESS_FILE); } catch (e) { /* ignore */ }
  console.log(`\nАдреса сохранены: ${OUT_FILE}\n`);
  for (const [k, v] of Object.entries({ factory, quoteFactory, zap, splitter, arena, hoodTreasury, migrator, migratorQ })) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`\nДальше по порядку:
  1. Акции и крипта:  QUOTE_FACTORY=${quoteFactory} ZAP=${zap} node scripts/allow-stocks.js --send
  2. Пришли адреса в чат — сайт, боты и сабграф переключаются на них одним коммитом.
  3. Верификация исходников в обозревателе:  node scripts/verify-v4.js --dump  (файлы для Blockscout)
  4. GitHub → Settings → Secrets and variables → Actions:
       Secrets:   ARENA_PRIVATE_KEY = ключ ${OPERATOR} (бот арены), TREASURER_PRIVATE_KEY = ключ ${WALLETS.divBot} (бот дивидендов)
       Variables: ARENA_TREASURY = ${arena}, BUYBACK_TREASURY = ${hoodTreasury},
                  HOOD_TOKEN = <адрес монеты hood, когда создашь её на сайте с кошелька команды>
  5. Газ ботам: ${OPERATOR} ≈ 0.02 ETH, ${WALLETS.divBot} ≈ 0.05 ETH.`);
}

/** Контрольная сверка комплекта с цепью. Возвращает список расхождений. */
async function verifyOnChain(o, { rd, pub, parseAbi, OWNER, OPERATOR, TEAM }) {
  const p = [];
  const eq = (what, got, want) => { if (!same(got, want)) p.push(`${what}: ${got}, ожидалось ${want}`); };
  const num = (what, got, want) => { if (Number(got) !== Number(want)) p.push(`${what}: ${got}, ожидалось ${want}`); };
  const t = (fn) => fn().catch((e) => { p.push(`чтение не удалось: ${e.shortMessage || e.message}`); });
  // фабрика ETH
  await t(async () => {
    const [tr, cfgd, fee, cs, mg, ow] = await Promise.all(["treasury", "configured", "feeBps", "creatorFeeShareBps", "migrator", "owner"].map((f) => rd(o.factory, "LaunchpadFactoryV3", f)));
    eq("фабрика ETH: казна", tr, o.splitter); if (!cfgd) p.push("фабрика ETH не настроена (configured=false)");
    num("фабрика ETH: комиссия", fee, FEE_BPS); num("фабрика ETH: доля создателя", cs, CREATOR_SHARE_BPS); eq("фабрика ETH: мигратор", mg, o.migrator); eq("фабрика ETH: владелец", ow, OWNER);
  });
  // фабрика за валюту
  await t(async () => {
    const [tr, cfgd, fee, cs, mg, ow] = await Promise.all(["treasury", "configured", "feeBps", "creatorFeeShareBps", "migrator", "owner"].map((f) => rd(o.quoteFactory, "LaunchpadFactoryQuoteV3", f)));
    eq("фабрика за валюту: казна", tr, o.splitter); if (!cfgd) p.push("фабрика за валюту не настроена (configured=false)");
    num("фабрика за валюту: комиссия", fee, FEE_BPS); num("фабрика за валюту: доля создателя", cs, CREATOR_SHARE_BPS); eq("фабрика за валюту: мигратор", mg, o.migratorQ); eq("фабрика за валюту: владелец", ow, OWNER);
    for (const [n, a] of [["WETH", MAINNET.weth], ["USDG", MAINNET.usdg], ["USDe", MAINNET.usde]]) {
      const qc = await rd(o.quoteFactory, "LaunchpadFactoryQuoteV3", "quoteConfig", [a]);
      const allowed = Array.isArray(qc) ? qc[0] : (qc.allowed ?? qc.enabled);
      if (!allowed) p.push(`валюта ${n} не разрешена в фабрике`);
    }
  });
  // зап
  await t(async () => {
    const [hood, weth, ow, rUsdg, rUsde] = await Promise.all([rd(o.zap, "CurveZap", "hood"), rd(o.zap, "CurveZap", "weth"), rd(o.zap, "CurveZap", "owner"), rd(o.zap, "CurveZap", "hasRoute", [MAINNET.usdg]), rd(o.zap, "CurveZap", "hasRoute", [MAINNET.usde])]);
    eq("зап: фабрика", hood, o.quoteFactory); eq("зап: WETH", weth, MAINNET.weth); eq("зап: владелец", ow, OWNER);
    if (!rUsdg) p.push("зап: нет маршрута USDG"); if (!rUsde) p.push("зап: нет маршрута USDe");
  });
  // миграторы
  await t(async () => {
    const [d1, o1, d2, o2] = await Promise.all([rd(o.migrator, "UniswapV3Migrator", "dustSink"), rd(o.migrator, "UniswapV3Migrator", "owner"), rd(o.migratorQ, "UniswapV3MigratorQuote", "dustSink"), rd(o.migratorQ, "UniswapV3MigratorQuote", "owner")]);
    eq("мигратор ETH: dustSink", d1, o.arena); eq("мигратор ETH: владелец", o1, OWNER); eq("мигратор за валюту: dustSink", d2, o.arena); eq("мигратор за валюту: владелец", o2, OWNER);
  });
  // казны
  for (const [label, addr] of [["казна арены", o.arena], ["казна hood", o.hoodTreasury]]) {
    await t(async () => {
      const [ow, op, ef, qf, z, w, v3] = await Promise.all(["owner", "operator", "ethFactory", "quoteFactory", "zap", "weth", "v3Factory"].map((f) => rd(addr, "ArenaTreasuryV3", f)));
      eq(`${label}: владелец`, ow, OWNER); eq(`${label}: оператор`, op, OPERATOR); eq(`${label}: фабрика ETH`, ef, o.factory); eq(`${label}: фабрика за валюту`, qf, o.quoteFactory);
      eq(`${label}: зап`, z, o.zap); eq(`${label}: WETH`, w, MAINNET.weth); eq(`${label}: V3`, v3, MAINNET.v3Factory);
      // оператор реально может звать toEth (упадёт на «bad args», а не на NotOperator)
      const abi = parseAbi(["function toEth(address,uint256,uint256) returns (uint256)", "error NotOperator()"]);
      try { await pub.simulateContract({ account: OPERATOR, address: addr, abi, functionName: "toEth", args: [MAINNET.weth, 0n, 0n] }); }
      catch (e) { const m = String(e.message || e.shortMessage); /* полный текст: в нём имя ошибки */ if (!/bad args/.test(m)) p.push(`${label}: оператор не может звать toEth (${m.split("\n")[0]})`); }
      const stranger = "0x000000000000000000000000000000000000dEaD";
      try { await pub.simulateContract({ account: stranger, address: addr, abi, functionName: "toEth", args: [MAINNET.weth, 0n, 0n] }); p.push(`${label}: toEth доступен ПОСТОРОННЕМУ`); }
      catch (e) { const m = String(e.message || e.shortMessage); /* полный текст: в нём имя ошибки */ if (!/NotOperator/.test(m)) p.push(`${label}: посторонний отбит не той ошибкой (${m.split("\n")[0]})`); }
    });
  }
  // сплиттер
  await t(async () => {
    const [tm, ar, bb, ef, qf, a, b, c] = await Promise.all(["team", "arena", "buyback", "ethFactory", "quoteFactory", "arenaShareBps", "buybackShareBps", "teamShareBps"].map((f) => rd(o.splitter, "FeeSplitterV6", f)));
    eq("сплиттер: команда", tm, TEAM); eq("сплиттер: арена", ar, o.arena); eq("сплиттер: выкуп hood", bb, o.hoodTreasury); eq("сплиттер: фабрика ETH", ef, o.factory); eq("сплиттер: фабрика за валюту", qf, o.quoteFactory);
    if (Number(a) !== Number(b) || Number(b) !== Number(c)) p.push(`сплиттер: доли ${a}/${b}/${c} не равны`);
  });
  return p;
}

function report(problems) {
  if (!problems.length) { console.log("✓ Сверка: всё настроено как задумано (фабрики, зап, миграторы, обе казны, сплиттер, права оператора)."); return; }
  console.error(`✗ Расхождений: ${problems.length}`);
  for (const x of problems) console.error("  - " + x);
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
