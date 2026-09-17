#!/usr/bin/env node
/**
 * Казны, которые копят в ETH (решение владельца 17.09.2026).
 *
 * Что делает:
 *   1. ArenaTreasuryV2 (арена)  — казна арены с умением менять валюту → ETH
 *   2. ArenaTreasuryV2 (hood)   — казна выкупа монеты hood, то же умение
 *   3. FeeSplitterV6 (новый)    — те же доли 10/10/10, но адреса новых казн
 *                                 (у V6 адреса неизменяемы — нужен новый экземпляр)
 *   4. обе фабрики: proposeConfig(treasury = новый сплиттер) — вступает через 48ч
 *   5. через 48ч: --apply — applyConfig на обеих фабриках
 *
 * Владелец обеих казн — ARENA_OWNER (кошелёк бота арены: тот, чей ключ лежит
 * в GitHub Secret ARENA_PRIVATE_KEY). По умолчанию — деплоящий кошелёк.
 *
 * Остальные параметры (комиссия 1%, создателю 70%, мигратор) не меняются —
 * читаются с фабрик и переписываются как есть.
 *
 * КЛЮЧ: scripts/deploy-config.json → privateKey (в .gitignore) или PRIVATE_KEY.
 * Ключ никогда не печатается.
 *
 * ЗАПУСК (только с машины владельца):
 *   node scripts/deploy-treasury-v2.js             # сухой прогон: план и газ
 *   node scripts/deploy-treasury-v2.js --deploy    # деплой + заявки на обеих фабриках
 *   node scripts/deploy-treasury-v2.js --apply     # через 48ч: применить заявки
 *   node scripts/deploy-treasury-v2.js --status    # что сейчас в заявках
 *
 * Артефакты: artifacts/ArenaTreasuryV2.json (собран solc 0.8.28, paris, optimizer 200)
 * и artifacts/FeeSplitterV6.json — из scripts/compile.js.
 */
const fs = require("fs");
const path = require("path");

const MAINNET = {
  factory:      "0xbe3e7ca55b6c4fc9e759bc8b43734b57a582da01",
  quoteFactory: "0x4b55954a2910cfbb04f49e90e727fb1540b3a940",
  zap:          "0x939f933ab01277e7fde73c0d4d7dec885242d44c",
  weth:         "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  v3Factory:    "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  team:         "0x79182232155dd09fBC53dd2Bb0380479F96EB11c",
};
const ARENA_NUM = 1n, BUYBACK_NUM = 1n, DEN = 3n; // из 30% — по 10%
const ZERO = "0x0000000000000000000000000000000000000000";
const OUT_FILE = path.join(__dirname, "treasury-v2-output.json");

async function main() {
  const mode = process.argv.includes("--deploy") ? "deploy" : process.argv.includes("--apply") ? "apply" : process.argv.includes("--status") ? "status" : "dry";
  const { createPublicClient, createWalletClient, http, formatEther, encodeAbiParameters } = require("viem");
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
  if (chainId !== 4663) { console.error(`Не та сеть: chainId ${chainId}, нужен 4663.`); process.exit(1); }
  const chain = { id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } };
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });
  const ART = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));
  const rd = (address, name, fn, args = []) => pub.readContract({ address, abi: ART(name).abi, functionName: fn, args });
  const ARENA_OWNER = process.env.ARENA_OWNER || cfg.arenaOwner || account.address;
  const TEAM = process.env.TEAM_WALLET || MAINNET.team; // команда — как в текущем сплиттере (0x7918…B11c)

  const send = mode === "deploy";
  const bal = await pub.getBalance({ address: account.address });
  console.log(`${mode === "dry" ? "Сухой прогон" : mode.toUpperCase()} · кошелёк ${account.address} · баланс ${formatEther(bal)} ETH`);

  // текущая конфигурация фабрик — переписываем всё, кроме казны
  const fCfg = {
    treasury: await rd(MAINNET.factory, "LaunchpadFactoryV2", "treasury"),
    migrator: await rd(MAINNET.factory, "LaunchpadFactoryV2", "migrator"),
    votePower: await rd(MAINNET.factory, "LaunchpadFactoryV2", "votePower").catch(() => ZERO),
    feeBps: await rd(MAINNET.factory, "LaunchpadFactoryV2", "feeBps"),
    creator: await rd(MAINNET.factory, "LaunchpadFactoryV2", "creatorFeeShareBps"),
  };
  const qCfg = {
    treasury: await rd(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "treasury"),
    migrator: await rd(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "migrator"),
    feeBps: await rd(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "feeBps"),
    creator: await rd(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "creatorFeeShareBps"),
  };
  console.log(`ETH-фабрика:    казна ${fCfg.treasury} · комиссия ${Number(fCfg.feeBps) / 100}% · создателю ${Number(fCfg.creator) / 100}%`);
  console.log(`фабрика валют:  казна ${qCfg.treasury} · комиссия ${Number(qCfg.feeBps) / 100}% · создателю ${Number(qCfg.creator) / 100}%`);

  if (mode === "status" || mode === "apply") {
    const pf = await rd(MAINNET.factory, "LaunchpadFactoryV2", "pendingConfig");
    const pq = await rd(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "pendingConfig");
    const show = (name, p) => {
      const readyAt = Number(p[p.length - 1]);
      if (!readyAt) { console.log(`${name}: заявки нет`); return null; }
      const left = readyAt * 1000 - Date.now();
      console.log(`${name}: заявка → казна ${p[0]} · готова ${new Date(readyAt * 1000).toISOString()}${left > 0 ? ` (через ${Math.ceil(left / 60000)} мин)` : " (можно применять)"}`);
      return left;
    };
    const lf = show("ETH-фабрика", pf), lq = show("фабрика валют", pq);
    if (mode === "status") return;
    for (const [name, left, addr, art] of [["ETH-фабрика", lf, MAINNET.factory, "LaunchpadFactoryV2"], ["фабрика валют", lq, MAINNET.quoteFactory, "LaunchpadFactoryQuote"]]) {
      if (left === null) continue;
      if (left > 0) { console.log(`${name}: таймлок ещё не вышел — пропуск.`); continue; }
      const hash = await wallet.writeContract({ address: addr, abi: ART(art).abi, functionName: "applyConfig" });
      const rc = await pub.waitForTransactionReceipt({ hash });
      console.log(`  ${rc.status === "success" ? "✓" : "✗"} ${name}: applyConfig ${hash}`);
    }
    const nowT = await rd(MAINNET.factory, "LaunchpadFactoryV2", "treasury");
    const nowQ = await rd(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "treasury");
    console.log(`Казна сейчас: ETH-фабрика ${nowT} · фабрика валют ${nowQ}`);
    return;
  }

  // проверка артефактов
  for (const [n, fn] of [["ArenaTreasuryV2", "toEth"], ["FeeSplitterV6", "buybackShareBps"]]) {
    let abi; try { abi = ART(n).abi; } catch { console.error(`Нет артефакта ${n}.`); process.exit(1); }
    if (!abi.some((f) => f.name === fn)) { console.error(`Артефакт ${n} старый (нет ${fn}).`); process.exit(1); }
  }
  const out = { chainId, deployer: account.address, arenaOwner: ARENA_OWNER, team: TEAM, at: new Date().toISOString() };
  let gasTotal = 0n;
  async function deploy(name, args) {
    const art = ART(name);
    const ctor = art.abi.find((f) => f.type === "constructor");
    const data = art.bytecode + (ctor && ctor.inputs.length ? encodeAbiParameters(ctor.inputs, args).slice(2) : "");
    if (!send) {
      const g = await pub.estimateGas({ account: account.address, data }).catch((e) => { console.log(`    (оценка газа ${name}: ${e.shortMessage || e.message})`); return 0n; });
      gasTotal += g;
      console.log(`  ${name.padEnd(18)} газ ≈ ${String(g)}`);
      return `0x${name.length.toString(16).padStart(2, "0")}${"0".repeat(38)}`;
    }
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${name}: деплой упал (${hash})`);
    console.log(`  ${name.padEnd(18)} ${rc.contractAddress}`);
    return rc.contractAddress;
  }
  async function call(address, name, fn, args) {
    if (!send) { console.log(`  ${name}.${fn}(${args.map(String).join(", ")})`); return; }
    const hash = await wallet.writeContract({ address, abi: ART(name).abi, functionName: fn, args });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${name}.${fn} REVERTED: ${hash}`);
    console.log(`  ✓ ${name}.${fn}`);
  }

  console.log(`\nВладелец казн (бот): ${ARENA_OWNER} · команда: ${TEAM}`);
  console.log("1/4 Казна арены V2…");
  const arena = await deploy("ArenaTreasuryV2", [ARENA_OWNER, MAINNET.factory, MAINNET.quoteFactory, MAINNET.zap, MAINNET.weth, MAINNET.v3Factory]);
  console.log("2/4 Казна выкупа hood V2…");
  const hood = await deploy("ArenaTreasuryV2", [ARENA_OWNER, MAINNET.factory, MAINNET.quoteFactory, MAINNET.zap, MAINNET.weth, MAINNET.v3Factory]);
  console.log("3/4 Сплиттер V6 (новый экземпляр, доли 10/10/10)…");
  const splitter = await deploy("FeeSplitterV6", [TEAM, arena, hood, MAINNET.factory, MAINNET.quoteFactory, ARENA_NUM, BUYBACK_NUM, DEN]);
  console.log("4/4 Заявки на смену казны (вступают через 48ч)…");
  await call(MAINNET.factory, "LaunchpadFactoryV2", "proposeConfig", [splitter, fCfg.migrator, fCfg.votePower, fCfg.feeBps, fCfg.creator]);
  await call(MAINNET.quoteFactory, "LaunchpadFactoryQuote", "proposeConfig", [splitter, qCfg.migrator, qCfg.feeBps, qCfg.creator]);

  if (!send) {
    const gp = await pub.getGasPrice();
    console.log(`\nГаз на 3 деплоя ≈ ${String(gasTotal)} ≈ ${formatEther(gasTotal * gp)} ETH (+ 2 заявки).`);
    console.log("Боевой запуск: node scripts/deploy-treasury-v2.js --deploy");
    return;
  }
  Object.assign(out, { arenaTreasuryV2: arena, hoodTreasuryV2: hood, splitter });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nГотово. Адреса — в ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log("Через 48 часов: node scripts/deploy-treasury-v2.js --apply");
  console.log("До этого: обновить адреса в web/src/lib/config.js, переменные GitHub ARENA_TREASURY и BUYBACK_TREASURY.");
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
