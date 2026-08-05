#!/usr/bin/env node
/**
 * Передеплой UniswapV3Migrator с защитой от подставного пула.
 *
 * ЗАЧЕМ. В мейннете сейчас работает старая версия мигратора. Она зовёт
 * createAndInitializePoolIfNecessary, который инициализирует пул ТОЛЬКО если
 * его ещё нет. Атакующий заранее создаёт пул токен/WETH с выгодной ему ценой,
 * ждёт градации — и забирает часть 6.5 ETH и 200M токенов, которые уходят в
 * ликвидность. Новая версия сверяет цену пула с расчётной (_requireFairPrice,
 * допуск 1% по sqrt) и ставит amount0Min/amount1Min = 90% вместо нулей.
 * Тесты: test/migrator.test.mjs — атака воспроизведена и блокируется.
 *
 * ВАЖНО. Смена мигратора в фабрике идёт через таймлок 48 часов:
 *   1) propose — деплой нового мигратора + заявка на смену конфига
 *   2) через 48 часов apply — применение заявки
 * Между шагами фабрика продолжает работать со старым мигратором, поэтому
 * градация в этом окне всё ещё опасна. Если на кривой есть токен близко к
 * порогу — сначала посмотри status.
 *
 * Запуск:
 *   PRIVATE_KEY=... node scripts/redeploy-migrator.js status
 *   PRIVATE_KEY=... node scripts/redeploy-migrator.js propose
 *   PRIVATE_KEY=... node scripts/redeploy-migrator.js apply
 * Ключ можно положить в scripts/deploy-config.json (privateKey, rpcUrl).
 */
const fs = require("fs");
const path = require("path");

const MAINNET = {
  factory:         "0x08a887196fc31b89305ae03aa991917f6b1d23ec",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  weth:            "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
};

const ART = (n) => JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "artifacts", `${n}.json`), "utf8"));

function loadKey() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-config.json"), "utf8")); } catch (e) {}
  const rpc = process.env.RPC_URL || cfg.rpcUrl || "https://rpc.mainnet.chain.robinhood.com";
  let pk = process.env.PRIVATE_KEY || cfg.privateKey;
  if (!pk) { console.error("Нет ключа: PRIVATE_KEY или scripts/deploy-config.json"); process.exit(1); }
  pk = String(pk).replace(/["'\s]/g, "");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("Ключ не похож на приватный ключ"); process.exit(1); }
  return { rpc, pk };
}

const fmtTs = (s) => new Date(Number(s) * 1000).toLocaleString("ru-RU");

async function main() {
  const mode = (process.argv[2] || "status").toLowerCase();
  const { createPublicClient, createWalletClient, http, defineChain } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { rpc, pk } = loadKey();

  const chain = defineChain({
    id: 4663, name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  const fAbi = ART("LaunchpadFactoryV2").abi;
  const rd = (fn, args = []) => pub.readContract({ address: MAINNET.factory, abi: fAbi, functionName: fn, args });

  const [owner, migratorNow, treasuryNow, votePowerNow, feeBps, creatorShare, pending] = await Promise.all([
    rd("owner"), rd("migrator"), rd("treasury"), rd("votePower"),
    rd("feeBps"), rd("creatorFeeShareBps"), rd("pendingConfig"),
  ]);

  console.log("Фабрика:      ", MAINNET.factory);
  console.log("Владелец:     ", owner);
  console.log("Кошелёк:      ", account.address);
  console.log("Мигратор сейчас:", migratorNow);
  const readyAt = Number(pending[5] ?? pending.readyAt ?? 0);
  if (readyAt > 0) {
    const left = readyAt - Math.floor(Date.now() / 1000);
    console.log("Заявка на смену: мигратор →", pending[1],
      left > 0 ? `· применить можно с ${fmtTs(readyAt)} (осталось ${Math.ceil(left / 3600)} ч)`
               : `· ТАЙМЛОК ИСТЁК, можно применять`);
  } else {
    console.log("Заявок на смену конфигурации нет");
  }

  if (mode === "status") {
    console.log("\nДальше: propose — задеплоить новый мигратор и подать заявку.");
    return;
  }
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error("\n❌ Этот кошелёк не владелец фабрики — транзакция откатится.");
    process.exit(1);
  }

  if (mode === "propose") {
    console.log("\nДеплою UniswapV3Migrator (с _requireFairPrice)…");
    const art = ART("UniswapV3Migrator");
    const hash = await wallet.deployContract({
      abi: art.abi, bytecode: art.bytecode,
      args: [MAINNET.positionManager, MAINNET.weth],
    });
    const rec = await pub.waitForTransactionReceipt({ hash });
    const migrator = rec.contractAddress;
    console.log("Новый мигратор:", migrator);

    // сверяем, что задеплоена именно защищённая версия
    const dev = await pub.readContract({ address: migrator, abi: art.abi, functionName: "MAX_SQRT_DEVIATION_BPS" })
      .catch(() => null);
    if (dev === null) {
      console.error("❌ В задеплоенном контракте нет MAX_SQRT_DEVIATION_BPS — это старая версия. Останавливаюсь.");
      process.exit(1);
    }
    console.log("✓ Защита от подставного пула на месте, допуск:", Number(dev) / 100, "%");

    console.log("\nПодаю заявку на смену конфигурации (таймлок 48 часов)…");
    const h2 = await wallet.writeContract({
      address: MAINNET.factory, abi: fAbi, functionName: "proposeConfig",
      args: [treasuryNow, migrator, votePowerNow, Number(feeBps), Number(creatorShare)],
    });
    await pub.waitForTransactionReceipt({ hash: h2 });

    const p = await rd("pendingConfig");
    console.log("✓ Заявка подана. Применить можно после", fmtTs(Number(p[5])));
    fs.writeFileSync(path.join(__dirname, "..", "migrator-redeploy.txt"),
      `migrator=${migrator}\nproposedAt=${new Date().toISOString()}\napplyAfter=${fmtTs(Number(p[5]))}\n`);
    console.log("Записал в migrator-redeploy.txt");
    console.log("\nЧерез 48 часов: node scripts/redeploy-migrator.js apply");
    return;
  }

  if (mode === "apply") {
    if (readyAt === 0) { console.error("\n❌ Заявки нет — сначала propose."); process.exit(1); }
    if (readyAt > Math.floor(Date.now() / 1000)) {
      console.error("\n❌ Таймлок ещё не истёк, применить можно с", fmtTs(readyAt));
      process.exit(1);
    }
    console.log("\nПрименяю заявку…");
    const h = await wallet.writeContract({ address: MAINNET.factory, abi: fAbi, functionName: "applyConfig" });
    await pub.waitForTransactionReceipt({ hash: h });
    const after = await rd("migrator");
    if (after.toLowerCase() !== String(pending[1]).toLowerCase()) {
      console.error("❌ Мигратор на цепи не совпал с заявленным:", after);
      process.exit(1);
    }
    console.log("✓ Готово. Мигратор в фабрике:", after);
    console.log("Проверь верификацию нового контракта в Blockscout (make-verify-input.js).");
    return;
  }

  console.error("Неизвестный режим. Доступно: status | propose | apply");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
