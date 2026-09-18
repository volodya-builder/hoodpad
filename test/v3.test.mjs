/**
 * hood V3: стартовый налог против снайперов (OpeningTax) в пулах ETH и за
 * валюту, фабрики V3, казна V3 с выкупом градуировавшей монеты на НАСТОЯЩЕМ
 * Uniswap V3.
 *
 * Время блоков задаём вручную (miner_stop + evm_mine с timestamp): так налог
 * проверяется по секундам детерминированно — 99% в секунду запуска, 25% в
 * первую, 3% во вторую, ноль с пятой.
 *
 * Запуск: GANACHE_FROM=/tmp/node_modules/ node scripts/run-tests.mjs test/v3.test.mjs
 * (для части с казной нужны @uniswap/v3-core и @uniswap/v3-periphery).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, http, parseEther, decodeEventLog, decodeErrorResult, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const require = createRequire(import.meta.url);
const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const UNI = (rel) => require(`@uniswap/${rel}`);
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];
const [deployer, creator, t1, t2] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const E = parseEther;

const rpc = (method, params = []) => pub.request({ method, params });
async function deployRaw(account, abi, bytecode, args = []) {
  const hash = await w(account).deployContract({ abi, bytecode, args, gas: 30_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, "success", "deploy failed");
  return { address: rc.contractAddress, abi };
}
const deploy = (account, name, args = []) => { const a = ART(name); return deployRaw(account, a.abi, a.bytecode, args); };
const deployUni = (account, rel, args = []) => { const a = UNI(rel); return deployRaw(account, a.abi, a.bytecode, args); };
const read = (c, fn, args = []) => pub.readContract({ address: c.address, abi: c.abi, functionName: fn, args });
/** Обычная транзакция (майнер работает). */
async function write(account, c, fn, args = [], value = 0n) {
  const hash = await w(account).writeContract({ address: c.address, abi: c.abi, functionName: fn, args, value, gas: 15_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, "success", `${fn} reverted`);
  return rc;
}
/** Транзакция в блок с заданным временем (майнер остановлен). */
async function writeAt(ts, account, c, fn, args = [], value = 0n) {
  const hash = await w(account).writeContract({ address: c.address, abi: c.abi, functionName: fn, args, value, gas: 15_000_000n });
  await rpc("evm_mine", [{ timestamp: ts }]);
  const rc = await pub.getTransactionReceipt({ hash });
  if (rc.status !== "success") {
    const why = await revertsWith(account, c, fn, args, value);
    assert.fail(`${fn} reverted at t=${ts}: ${why}`);
  }
  return rc;
}
/** Причина отказа: имя custom-ошибки (в т.ч. из вложенного вызова — пула, фабрики), строка require или Panic(код). */
async function revertsWith(account, c, fn, args = [], value = 0n) {
  const data = encodeFunctionData({ abi: c.abi, functionName: fn, args });
  try {
    await rpc("eth_call", [{ from: account.address, to: c.address, data, value: "0x" + value.toString(16), gas: "0x1000000" }, "latest"]);
    return null;
  } catch (e) {
    const raw = e?.cause?.data ?? e?.data;
    if (typeof raw === "string" && raw.startsWith("0x")) {
      const abis = [c.abi, ART("BondingCurvePoolV3").abi, ART("BondingCurvePoolQuoteV3").abi, ART("LaunchpadFactoryV3").abi, ART("UniswapV3Migrator").abi, ART("CurveZap").abi, ART("ArenaTreasuryV3").abi];
      for (const abi of abis) { try { const d = decodeErrorResult({ abi, data: raw }); return d.errorName === "Panic" ? `Panic(0x${Number(d.args[0]).toString(16)})` : d.errorName === "Error" ? String(d.args[0]) : d.errorName; } catch { /* дальше */ } }
      return `raw:${raw.slice(0, 20)}`;
    }
    return String(e?.cause?.message || e.shortMessage || e.message).slice(0, 100);
  }
}
function events(rc, abi, name) {
  const out = [];
  for (const l of rc.logs) { try { const e = decodeEventLog({ abi, data: l.data, topics: l.topics }); if (e.eventName === name) out.push(e); } catch { /* чужое */ } }
  return out;
}
const one = (rc, abi, name) => events(rc, abi, name)[0] || null;

// ---------------------------------------------------------------- общее
let T0; // секунда запуска первой монеты
let ethFactory, ethMigrator, poolAbi, tokenAbi;
before(async () => {
  ethMigrator = await deploy(deployer, "MockMigrator");
  ethFactory = await deploy(deployer, "LaunchpadFactoryV3", [deployer.address, ethMigrator.address]);
  await write(deployer, ethFactory, "initConfig", [deployer.address, ethMigrator.address, ZERO, 100, 7000]);
  poolAbi = ART("BondingCurvePoolV3").abi;
  tokenAbi = ART("LaunchToken").abi;
  const latest = await pub.getBlock();
  T0 = Number(latest.timestamp) + 100;
  await rpc("miner_stop");
});
after(async () => {
  // вернуть майнер и сдвинуть часы вперёд, чтобы следующие файлы не упёрлись в прошлое
  const last = await pub.getBlock();
  await rpc("evm_setTime", [(Number(last.timestamp) + 1000) * 1000]);
  await rpc("miner_start");
});

async function launchEth(ts, exempt = [], value = 0n, from = creator) {
  const rc = await writeAt(ts, from, ethFactory, "createToken", ["Coin", "COIN", "", from.address, exempt], value);
  const ev = one(rc, ethFactory.abi, "TokenCreated");
  return { rc, token: { address: ev.args.token, abi: tokenAbi }, pool: { address: ev.args.pool, abi: poolAbi } };
}
/** Инвариант ETH-пула: баланс = резерв + накопленные комиссии. */
async function assertSolvent(pool) {
  const bal = await pub.getBalance({ address: pool.address });
  const sum = (await read(pool, "ethReserve")) + (await read(pool, "protocolFeesAccrued")) + (await read(pool, "creatorFeesAccrued"));
  assert.equal(bal, sum, "баланс пула = резерв + комиссии");
}

// ---------------------------------------------------------------- шкала
test("шкала налога по секундам: 99 / 25 / 3 / 0.4 / 0.05 / 0", async () => {
  const { pool } = await launchEth(T0);
  assert.equal(await read(pool, "launchedAt"), BigInt(T0));
  const want = [9900, 2500, 300, 40, 5, 0, 0];
  for (let s = 0; s < want.length; s++) {
    assert.equal(await read(pool, "openingTaxBpsAt", [BigInt(T0 + s)]), want[s], `секунда ${s}`);
  }
  assert.equal(await read(pool, "openingTaxBpsAt", [BigInt(T0 - 5)]), 9900, "до запуска — максимум");
});

// ---------------------------------------------------------------- ETH-пул
let coin; // монета с покупкой создателя и освобождённым t2
test("запуск: покупка создателя в той же транзакции без налога, список освобождённых", async () => {
  coin = await launchEth(T0, [t2.address], E("0.05"));
  const { pool, token, rc } = coin;
  assert.equal(await read(pool, "taxExempt", [creator.address]), true, "создатель освобождён");
  assert.equal(await read(pool, "taxExempt", [t2.address]), true, "t2 освобождён");
  assert.equal(await read(pool, "taxExempt", [t1.address]), false);
  const list = await read(pool, "exemptList");
  assert.deepEqual(list.map((a) => a.toLowerCase()), [creator.address, t2.address].map((a) => a.toLowerCase()));
  assert.equal(events(rc, poolAbi, "OpeningTaxPaid").length, 0, "создатель налог не платил");
  assert.equal(await read(pool, "openingTaxPaid"), 0n);
  // комиссия 1% как обычно, налога нет
  const fees = (await read(pool, "protocolFeesAccrued")) + (await read(pool, "creatorFeesAccrued"));
  assert.equal(fees, E("0.0005"));
  assert.ok((await read(token, "balanceOf", [creator.address])) > 0n);
  await assertSolvent(pool);
});

test("снайпер в секунду запуска отдаёт 99%", async () => {
  const { pool, token } = coin;
  const reserveBefore = await read(pool, "ethReserve");
  const feesBefore = (await read(pool, "protocolFeesAccrued")) + (await read(pool, "creatorFeesAccrued"));
  const rc = await writeAt(T0, t1, pool, "buy", [0n, t1.address], E("1"));
  const tax = one(rc, poolAbi, "OpeningTaxPaid");
  assert.ok(tax, "событие налога");
  assert.equal(tax.args.bps, 9900);
  assert.equal(tax.args.amount, E("0.99"));
  assert.equal(tax.args.buyer.toLowerCase(), t1.address.toLowerCase());
  const buy = one(rc, poolAbi, "Buy");
  // в кривую: (1 - 0.99) - 1% = 0.0099; площадке: 0.99 + 0.0001
  assert.equal(buy.args.ethIn, E("0.0099"));
  assert.equal(buy.args.fee, E("0.9901"));
  assert.equal((await read(pool, "ethReserve")) - reserveBefore, E("0.0099"));
  const feesAfter = (await read(pool, "protocolFeesAccrued")) + (await read(pool, "creatorFeesAccrued"));
  assert.equal(feesAfter - feesBefore, E("0.9901"));
  assert.equal(await read(pool, "openingTaxPaid"), E("0.99"));
  // 70/30 по всей сумме, включая налог
  assert.equal(await read(pool, "creatorFeesAccrued"), (feesAfter * 7000n) / 10000n);
  assert.ok((await read(token, "balanceOf", [t1.address])) > 0n, "что-то купил");
  await assertSolvent(pool);
});

test("освобождённый адрес не платит; при покупке через посредника важен получатель", async () => {
  const { pool } = coin;
  const a = await writeAt(T0, t2, pool, "buy", [0n, t2.address], E("1"));
  assert.equal(events(a, poolAbi, "OpeningTaxPaid").length, 0, "t2 без налога");
  assert.equal(one(a, poolAbi, "Buy").args.fee, E("0.01"));
  // t1 (не освобождён) покупает для t2 — как зап или фабрика: налога нет
  const b = await writeAt(T0, t1, pool, "buy", [0n, t2.address], E("1"));
  assert.equal(events(b, poolAbi, "OpeningTaxPaid").length, 0, "получатель освобождён");
  // t2 покупает для t1 — платит освобождённый: налога тоже нет
  const c = await writeAt(T0, t2, pool, "buy", [0n, t1.address], E("1"));
  assert.equal(events(c, poolAbi, "OpeningTaxPaid").length, 0, "плательщик освобождён");
  await assertSolvent(pool);
});

test("шкала на покупках: 25% в первую секунду, 3% во вторую, 0 с пятой", async () => {
  const { pool } = coin;
  const at = async (ts, bps) => {
    const rc = await writeAt(ts, t1, pool, "buy", [0n, t1.address], E("0.1"));
    const ev = one(rc, poolAbi, "OpeningTaxPaid");
    if (bps === 0) assert.equal(ev, null, `t=${ts - T0}: налога нет`);
    else { assert.ok(ev, `t=${ts - T0}: налог есть`); assert.equal(ev.args.bps, bps); assert.equal(ev.args.amount, (E("0.1") * BigInt(bps)) / 10000n); }
  };
  await at(T0 + 1, 2500);
  await at(T0 + 2, 300);
  await at(T0 + 3, 40);
  await at(T0 + 4, 5);
  await at(T0 + 5, 0);
  await at(T0 + 60, 0);
  assert.equal(await read(pool, "openingTaxBps"), 0, "окно закрыто");
  await assertSolvent(pool);
});

test("оценка quoteBuyFor учитывает налог получателя, quoteBuy — нет", async () => {
  const { pool } = await launchEth(T0 + 100, [t2.address]);
  // блок с t=T0+100 — секунда запуска: latest = T0+100, eth_call считает по ней
  const plain = await read(pool, "quoteBuy", [E("1")]);
  const forT1 = await read(pool, "quoteBuyFor", [t1.address, E("1")]);
  const forT2 = await read(pool, "quoteBuyFor", [t2.address, E("1")]);
  assert.equal(forT2, plain, "освобождённый — как без налога");
  assert.ok(forT1 < plain / 50n, "снайперу — в разы меньше");
});

test("продажа налогом не облагается даже в секунду запуска", async () => {
  const { pool, token } = await launchEth(T0 + 200, [], E("0.05"));
  const bal = await read(token, "balanceOf", [creator.address]);
  await writeAt(T0 + 200, creator, token, "approve", [pool.address, bal]);
  const rc = await writeAt(T0 + 200, creator, pool, "sell", [bal, 0n]);
  assert.equal(events(rc, poolAbi, "OpeningTaxPaid").length, 0);
  const sell = one(rc, poolAbi, "Sell");
  assert.ok(sell.args.fee > 0n);
  // комиссия ровно 1% от валового выхода: ethOut = gross - fee, fee = gross/100
  const gross = sell.args.fee + sell.args.ethOut;
  assert.equal(sell.args.fee, gross / 100n, "1% комиссии, без налога");
  await assertSolvent(pool);
});

test("заполнение кривой внутри окна налога: сдача и суммы сходятся до вея", async () => {
  const { pool, token } = await launchEth(T0 + 300);
  const before = await pub.getBalance({ address: t1.address });
  const rc = await writeAt(T0 + 301, t1, pool, "buy", [0n, t1.address], E("20")); // 25% налога
  const buy = one(rc, poolAbi, "Buy");
  const tax = one(rc, poolAbi, "OpeningTaxPaid");
  assert.equal(await read(pool, "graduated"), true);
  assert.equal(await read(pool, "tokensSold"), await read(pool, "saleCap"));
  // как у Pons: ликвидность уехала на DEX в той же покупке
  assert.equal(await read(pool, "migrated"), true, "мигрировала в той же транзакции");
  assert.ok(one(rc, poolAbi, "Migrated"), "событие Migrated в покупке");
  assert.equal(events(rc, poolAbi, "MigrationDeferred").length, 0);
  const reserve = one(rc, poolAbi, "Graduated").args.ethReserve;
  assert.ok(reserve >= E("4") && reserve <= E("4") + 100n, `резерв 4 ETH (${reserve})`);
  assert.equal(await read(ethMigrator, "lastEthAmount"), reserve, "весь резерв ушёл мигратору");
  assert.equal(await read(pool, "ethReserve"), 0n);
  // взяли ровно столько, сколько нужно: gross = ethIn / (0.75 * 0.99), остальное вернули
  const gasCost = rc.gasUsed * rc.effectiveGasPrice;
  const spent = before - (await pub.getBalance({ address: t1.address })) - gasCost;
  assert.equal(spent, buy.args.ethIn + buy.args.fee, "списано = в кривую + площадке");
  assert.ok(spent < E("9"), `сдача вернулась (${spent})`);
  assert.equal(tax.args.amount, (spent * 2500n) / 10000n, "налог 25% от фактически взятого");
  assert.ok((await read(token, "balanceOf", [t1.address])) > 0n);
  await assertSolvent(pool);
});

test("больше 32 освобождённых — отказ", async () => {
  const many = Array.from({ length: 33 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));
  const err = await revertsWith(creator, ethFactory, "createToken", ["X", "X", "", creator.address, many]);
  assert.equal(err, "TooManyExempt");
  const ok = many.slice(0, 32);
  const { pool } = await launchEth(T0 + 400, ok);
  assert.equal((await read(pool, "exemptList")).length, 33, "создатель + 32");
});

// ---------------------------------------------------------------- пул за валюту
test("монета за валюту: налог с полной суммы, дивиденды и комиссия — с остатка", async () => {
  const pm = await (async () => { const hash = await w(deployer).deployContract({ abi: ART("MockPositionManager").abi, bytecode: ART("MockPositionManager").bytecode, gas: 30_000_000n }); await rpc("evm_mine", [{ timestamp: T0 + 500 }]); return (await pub.getTransactionReceipt({ hash })).contractAddress; })();
  const migQ = await (async () => { const a = ART("UniswapV3MigratorQuote"); const hash = await w(deployer).deployContract({ abi: a.abi, bytecode: a.bytecode, args: [pm], gas: 30_000_000n }); await rpc("evm_mine", [{ timestamp: T0 + 500 }]); return (await pub.getTransactionReceipt({ hash })).contractAddress; })();
  const qa = ART("LaunchpadFactoryQuoteV3");
  const qf = await (async () => { const hash = await w(deployer).deployContract({ abi: qa.abi, bytecode: qa.bytecode, args: [deployer.address, migQ], gas: 30_000_000n }); await rpc("evm_mine", [{ timestamp: T0 + 500 }]); return { address: (await pub.getTransactionReceipt({ hash })).contractAddress, abi: qa.abi }; })();
  await writeAt(T0 + 500, deployer, qf, "initConfig", [deployer.address, migQ, 100, 7000]);
  const sa = ART("MockStock");
  const stock = await (async () => { const hash = await w(deployer).deployContract({ abi: sa.abi, bytecode: sa.bytecode, args: ["Apple RH", "AAPL"], gas: 30_000_000n }); await rpc("evm_mine", [{ timestamp: T0 + 500 }]); return { address: (await pub.getTransactionReceipt({ hash })).contractAddress, abi: sa.abi }; })();
  for (const a of [creator, t1, t2]) await writeAt(T0 + 500, deployer, stock, "mint", [a.address, E("1000")]);
  await writeAt(T0 + 500, deployer, qf, "setQuote", [stock.address, true, E("1.625"), E("0.13")]);

  const rc = await writeAt(T0 + 600, creator, qf, "createToken", ["Stock Coin", "SC", "", stock.address, creator.address, 100, [t2.address]]);
  const ev = one(rc, qf.abi, "TokenCreated");
  const qpAbi = ART("BondingCurvePoolQuoteV3").abi;
  const pool = { address: ev.args.pool, abi: qpAbi };
  const token = { address: ev.args.token, abi: ART("DividendToken").abi };
  assert.equal(await read(pool, "launchedAt"), BigInt(T0 + 600));
  assert.equal(await read(pool, "taxExempt", [t2.address]), true);

  // снайпер t1 в секунду запуска: 100 AAPL → налог 99, комиссия 1% и дивиденды 1% с оставшегося 1
  await writeAt(T0 + 600, t1, stock, "approve", [pool.address, E("100")]);
  const b = await writeAt(T0 + 600, t1, pool, "buy", [E("100"), 0n, t1.address]);
  const tax = one(b, qpAbi, "OpeningTaxPaid");
  assert.equal(tax.args.amount, E("99"));
  const buy = one(b, qpAbi, "Buy");
  assert.equal(buy.args.quoteIn, E("0.98"), "в кривую: 1 - 1% - 1%");
  assert.equal(buy.args.fee, E("99.01"), "площадке: налог + 1%");
  assert.equal(one(b, qpAbi, "Dividend").args.amount, E("0.01"), "дивиденды 1% с остатка после налога");
  // инвариант: баланс валюты пула = резерв + комиссии (дивиденды уже ушли в токен)
  const bal = await read(stock, "balanceOf", [pool.address]);
  const sum = (await read(pool, "quoteReserve")) + (await read(pool, "protocolFeesAccrued")) + (await read(pool, "creatorFeesAccrued"));
  assert.equal(bal, sum);
  assert.equal(await read(pool, "openingTaxPaid"), E("99"));

  // освобождённый t2 — без налога
  await writeAt(T0 + 600, t2, stock, "approve", [pool.address, E("1")]);
  const c = await writeAt(T0 + 600, t2, pool, "buy", [E("1"), 0n, t2.address]);
  assert.equal(events(c, qpAbi, "OpeningTaxPaid").length, 0);
  assert.equal(one(c, qpAbi, "Buy").args.fee, E("0.01"));

  // через 10 секунд налога нет ни у кого
  await writeAt(T0 + 610, t1, stock, "approve", [pool.address, E("1")]);
  const d = await writeAt(T0 + 610, t1, pool, "buy", [E("1"), 0n, t1.address]);
  assert.equal(events(d, qpAbi, "OpeningTaxPaid").length, 0);

  // заполнение кривой в окне налога другой монетой: сдача, суммы сходятся
  const rc2 = await writeAt(T0 + 700, creator, qf, "createToken", ["Stock Coin 2", "SC2", "", stock.address, creator.address, 300, []]);
  const p2 = { address: one(rc2, qf.abi, "TokenCreated").args.pool, abi: qpAbi };
  await writeAt(T0 + 701, t1, stock, "approve", [pool.address, 0n]);
  await writeAt(T0 + 701, t1, stock, "approve", [p2.address, E("500")]);
  const sb = await read(stock, "balanceOf", [t1.address]);
  const g = await writeAt(T0 + 701, t1, p2, "buy", [E("500"), 0n, t1.address]); // 25% налога
  assert.equal(await read(p2, "graduated"), true);
  assert.equal(await read(p2, "migrated"), true, "на Uniswap в той же покупке");
  assert.ok(one(g, ART("UniswapV3MigratorQuote").abi, "LiquidityLocked"), "ликвидность заперта в покупке");
  const spent = sb - (await read(stock, "balanceOf", [t1.address]));
  const gb = one(g, qpAbi, "Buy"), gd = one(g, qpAbi, "Dividend");
  assert.equal(spent, gb.args.quoteIn + gb.args.fee + gd.args.amount, "списано = кривая + площадка + дивиденды");
  assert.ok(spent < E("500"), "сдача вернулась");
  const bal2 = await read(stock, "balanceOf", [p2.address]);
  const sum2 = (await read(p2, "quoteReserve")) + (await read(p2, "protocolFeesAccrued")) + (await read(p2, "creatorFeesAccrued"));
  assert.equal(bal2, sum2);
  assert.ok((await read(token, "balanceOf", [t1.address])) > 0n);
});

// ---------------------------------------------------------------- казна V3 на настоящем Uniswap
test("казна V3: выкуп градуировавшей ETH-монеты на настоящем Uniswap V3 и сжигание", async () => {
  // майнер обратно: здесь время не важно, но окно налога надо пропустить
  await rpc("evm_setTime", [(T0 + 2000) * 1000]);
  await rpc("miner_start");

  const weth = await deploy(deployer, "WETH9Test");
  const uniFactory = await deployUni(deployer, "v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
  const pm = await deployUni(deployer, "v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json",
    [uniFactory.address, weth.address, "0x0000000000000000000000000000000000000001"]);
  const migrator = await deploy(deployer, "UniswapV3Migrator", [pm.address, weth.address]);
  const factory = await deploy(deployer, "LaunchpadFactoryV3", [deployer.address, migrator.address]);
  await write(deployer, factory, "initConfig", [deployer.address, migrator.address, ZERO, 100, 7000]);
  // фабрика за валюту нужна казне и запу как адрес с poolOf/quoteOf
  const migQ = await deploy(deployer, "UniswapV3MigratorQuote", [pm.address]);
  const qf = await deploy(deployer, "LaunchpadFactoryQuoteV3", [deployer.address, migQ.address]);
  const zap = await deploy(deployer, "CurveZap", [weth.address, uniFactory.address, qf.address]);
  const operator = t2;
  const treasury = await deploy(deployer, "ArenaTreasuryV3", [deployer.address, operator.address, factory.address, qf.address, zap.address, weth.address, uniFactory.address]);
  await write(deployer, migrator, "setDustSink", [treasury.address]);

  const rc = await write(creator, factory, "createToken", ["Coin", "COIN", "", creator.address, []]);
  const ev = one(rc, factory.abi, "TokenCreated");
  const token = { address: ev.args.token, abi: tokenAbi };
  const pool = { address: ev.args.pool, abi: poolAbi };
  await rpc("evm_increaseTime", [10]); await rpc("evm_mine", []);
  assert.equal(await read(pool, "openingTaxBps"), 0, "окно налога закрыто");

  // до градации: выкуп с кривой работает как раньше
  await w(deployer).sendTransaction({ to: treasury.address, value: E("1") });
  const b1 = await write(operator, treasury, "buybackEth", [token.address, E("0.1"), 0n, "arena test 1"]);
  assert.ok(one(b1, treasury.abi, "Buyback"), "выкуп с кривой");
  assert.equal(await read(token, "balanceOf", [treasury.address]), 0n, "всё сожжено");
  const burned1 = await read(token, "balanceOf", [DEAD]);
  assert.ok(burned1 > 0n);

  // на DEX до градации нельзя: ликвидность ещё на кривой (даже если кто-то создал чужой пул Uniswap)
  assert.equal(await revertsWith(operator, treasury, "buybackDex", [token.address, E("0.1"), 0n, "x"]), "NotMigrated");

  // градация и миграция на настоящий Uniswap
  const mrc = await write(t1, pool, "buy", [0n, t1.address], E("10"));
  assert.equal(await read(pool, "graduated"), true);
  assert.equal(await read(pool, "migrated"), true, "миграция в покупке");
  assert.ok(one(mrc, migrator.abi, "LiquidityLocked"), "ликвидность заперта");
  assert.equal(await revertsWith(t1, pool, "migrate", []), "AlreadyMigrated");
  assert.equal(await revertsWith(operator, treasury, "buybackEth", [token.address, E("0.1"), 0n, "x"]), "TradingClosed", "кривая закрыта");

  // после градации: покупка на DEX + сжигание
  const deadBefore = await read(token, "balanceOf", [DEAD]);
  const spentBefore = await read(treasury, "totalEthSpent");
  const sim = await pub.simulateContract({ account: operator, address: treasury.address, abi: treasury.abi, functionName: "buybackDex", args: [token.address, E("0.5"), 0n, "hood 2026-09-18 01"] });
  assert.ok(sim.result > 0n, "симуляция даёт монеты");
  const b2 = await write(operator, treasury, "buybackDex", [token.address, E("0.5"), (sim.result * 97n) / 100n, "hood 2026-09-18 01"]);
  const bb = one(b2, treasury.abi, "Buyback");
  assert.equal(bb.args.amountIn, E("0.5"));
  assert.equal(bb.args.asset, ZERO);
  assert.ok(bb.args.tokensOut > 0n);
  assert.equal(await read(token, "balanceOf", [treasury.address]), 0n, "всё сожжено");
  // сожжено купленное плюс пыль, которую мигратор скинул в казну (dustSink) при миграции
  const burned = (await read(token, "balanceOf", [DEAD])) - deadBefore;
  assert.ok(burned >= bb.args.tokensOut && burned - bb.args.tokensOut < E("0.001"), "сожжено купленное (+пыль миграции)");
  assert.equal((await read(treasury, "totalEthSpent")) - spentBefore, E("0.5"));
  assert.equal(await read(weth, "balanceOf", [treasury.address]), 0n, "WETH в казне не осталось");
  const left = await pub.getBalance({ address: treasury.address });
  assert.ok(left >= E("0.4") && left < E("0.401"), `в казне осталось 1 - 0.1 - 0.5 (+пыль миграции): ${left}`);

  // защита: проскальзывание, не монета площадки, не оператор
  assert.equal(await revertsWith(operator, treasury, "buybackDex", [token.address, E("0.1"), sim.result * 10n, "x"]), "Slippage");
  assert.equal(await revertsWith(operator, treasury, "buybackDex", [weth.address, E("0.1"), 0n, "x"]), "NotPlatformToken");
  assert.equal(await revertsWith(t1, treasury, "buybackDex", [token.address, E("0.1"), 0n, "x"]), "NotOperator");
  assert.equal(await revertsWith(operator, treasury, "buybackDex", [token.address, E("5"), 0n, "x"]), "bad amount");
});

test("миграция сорвалась в покупке — покупка проходит, деньги на кривой, migrate() доделывает", async () => {
  // мигратор без функции migrate (любой контракт) — перенос откатится, покупка нет
  const bad = await deploy(deployer, "MockStock", ["Bad", "BAD"]);
  const f = await deploy(deployer, "LaunchpadFactoryV3", [deployer.address, bad.address]);
  await write(deployer, f, "initConfig", [deployer.address, bad.address, ZERO, 100, 7000]);
  const rc0 = await write(creator, f, "createToken", ["Coin", "COIN", "", creator.address, []]);
  const ev = one(rc0, f.abi, "TokenCreated");
  const pool = { address: ev.args.pool, abi: poolAbi };
  const token = { address: ev.args.token, abi: tokenAbi };
  await rpc("evm_increaseTime", [10]); await rpc("evm_mine", []);

  const rc = await write(t1, pool, "buy", [0n, t1.address], E("10"));
  assert.equal(rc.status, "success", "покупка прошла, хотя перенос сорвался");
  assert.equal(await read(pool, "graduated"), true);
  assert.equal(await read(pool, "migrated"), false, "не мигрировала");
  assert.equal(events(rc, poolAbi, "MigrationDeferred").length, 1, "событие MigrationDeferred");
  assert.equal(events(rc, poolAbi, "Migrated").length, 0);
  assert.ok((await read(token, "balanceOf", [t1.address])) > 0n, "монеты у покупателя");
  const reserve = await read(pool, "ethReserve");
  assert.ok(reserve >= E("4"), "резерв остался на кривой");
  await assertSolvent(pool);
  assert.equal(await revertsWith(t1, pool, "buy", [0n, t1.address], E("1")), "TradingClosed");
  // migrateSelf снаружи не вызвать
  assert.equal(await revertsWith(t1, pool, "migrateSelf", []), "NotAuthorized");

  // владелец чинит мигратор (таймлок 48 ч), бот зовёт migrate()
  await write(deployer, f, "proposeConfig", [deployer.address, ethMigrator.address, ZERO, 100, 7000]);
  await rpc("evm_increaseTime", [48 * 3600 + 1]); await rpc("evm_mine", []);
  await write(deployer, f, "applyConfig", []);
  const m = await write(t2, pool, "migrate", []);
  assert.ok(one(m, poolAbi, "Migrated"), "доделали migrate()");
  assert.equal(await read(pool, "migrated"), true);
  assert.equal(await read(pool, "ethReserve"), 0n);
  assert.equal(await read(ethMigrator, "lastEthAmount"), reserve);
});
