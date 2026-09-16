/**
 * Мигратор против НАСТОЯЩЕГО Uniswap V3 (артефакты @uniswap/v3-core и
 * v3-periphery), а не мока. Мок в MockUniswapV3.sol не зовёт колбэк свапа на
 * пустом пуле, поэтому не ловил главный сценарий (аудит 15.09.2026): чужой
 * заранее инициализирует пустой пул по кривой цене → настоящий пул зовёт
 * колбэк с нулями → старый колбэк отказывал → цена оставалась чужой →
 * migrate() падал навсегда, 6.5 ETH и монеты держателей — в ловушке.
 *
 * Сценарии: честная миграция; пустой пул выше/ниже цены; крошечная чужая
 * ликвидность НИЖЕ цены (старый мигратор не умел покупать токены за ETH и
 * не мог поднять цену); чужой капитал больше бюджета (миграция откладывается,
 * деньги целы, владелец поднимает бюджет — проходит); то же для монеты за
 * валюту (акцию).
 *
 * Запуск: node scripts/run-tests.mjs test/migrator-real.test.mjs
 * (нужны devDependencies @uniswap/v3-core, @uniswap/v3-periphery).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, decodeEventLog, decodeErrorResult, encodeFunctionData } from "viem";
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
const [deployer, creator, trader, attacker] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

async function deployRaw(account, abi, bytecode, args = []) {
  const hash = await w(account).deployContract({ abi, bytecode, args, gas: 30_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, "success", "deploy failed");
  return { address: rc.contractAddress, abi };
}
const deploy = (account, name, args = []) => { const a = ART(name); return deployRaw(account, a.abi, a.bytecode, args); };
const deployUni = (account, rel, args = []) => { const a = UNI(rel); return deployRaw(account, a.abi, a.bytecode, args); };
const read = (c, fn, args = []) => pub.readContract({ address: c.address, abi: c.abi, functionName: fn, args });
async function write(account, c, fn, args = [], value = 0n) {
  const hash = await w(account).writeContract({ address: c.address, abi: c.abi, functionName: fn, args, value, gas: 15_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, "success", `${fn} reverted`);
  return rc;
}
async function revertsWith(account, c, fn, args = [], value = 0n) {
  const data = encodeFunctionData({ abi: c.abi, functionName: fn, args });
  try {
    await pub.request({ method: "eth_call", params: [{ from: account.address, to: c.address, data, value: "0x" + value.toString(16) }, "latest"] });
  } catch (e) {
    const raw = e?.cause?.data ?? e?.data;
    for (const abi of [c.abi, ART("UniswapV3Migrator").abi, ART("UniswapV3MigratorQuote").abi]) {
      try { const d = decodeErrorResult({ abi, data: raw }); return d.errorName; } catch { /* next */ }
    }
    return String(e.shortMessage || e.message).slice(0, 80);
  }
  return null;
}
function findEvent(rc, abi, name) {
  for (const l of rc.logs) { try { const e = decodeEventLog({ abi, data: l.data, topics: l.topics }); if (e.eventName === name) return e; } catch { /* skip */ } }
  return null;
}
function isqrt(n) { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; }
const sqrtPrice = (a0, a1) => isqrt((a1 << 192n) / a0);
const FULL = { tickLower: -887220, tickUpper: 887220, fee: 3000 };

let weth, uniFactory, pm, v3PoolAbi;
before(async () => {
  weth = await deploy(deployer, "WETH9Test");
  uniFactory = await deployUni(deployer, "v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
  pm = await deployUni(deployer, "v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json",
    [uniFactory.address, weth.address, "0x0000000000000000000000000000000000000001"]);
  v3PoolAbi = UNI("v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json").abi;
});

// ---------------------------------------------------------------- ETH-монета
async function ethSetup() {
  const migrator = await deploy(deployer, "UniswapV3Migrator", [pm.address, weth.address]);
  await write(deployer, migrator, "setDustSink", [deployer.address]);
  const factory = await deploy(deployer, "LaunchpadFactoryV2", [deployer.address, migrator.address]);
  await write(deployer, factory, "initConfig", [deployer.address, migrator.address, "0x0000000000000000000000000000000000000000", 100, 6000]);
  const rc = await write(creator, factory, "createToken", ["Coin", "COIN", "", "0x0000000000000000000000000000000000000000"]);
  const ev = findEvent(rc, factory.abi, "TokenCreated");
  const token = { address: ev.args.token, abi: ART("LaunchToken").abi };
  const pool = { address: ev.args.pool, abi: ART("BondingCurvePoolV2").abi };
  return { migrator, factory, token, pool };
}
async function graduate(s) {
  await write(trader, s.pool, "buy", [0n, trader.address], parseEther("10"));
  assert.equal(await read(s.pool, "graduated"), true);
  const ethAmount = await read(s.pool, "ethReserve");
  const tokenAmount = (await read(s.pool, "totalSupply")) - (await read(s.pool, "saleCap"));
  const tokenIsZero = BigInt(s.token.address) < BigInt(weth.address);
  const [t0, t1] = tokenIsZero ? [s.token.address, weth.address] : [weth.address, s.token.address];
  const [a0, a1] = tokenIsZero ? [tokenAmount, ethAmount] : [ethAmount, tokenAmount];
  return { ...s, ethAmount, tokenAmount, tokenIsZero, t0, t1, target: sqrtPrice(a0, a1) };
}
async function v3Of(t0, t1) {
  const addr = await read(uniFactory, "getPool", [t0, t1, 3000]);
  return { address: addr, abi: v3PoolAbi };
}
async function assertMigrated(s, rc) {
  const locked = findEvent(rc, s.migrator.abi, "LiquidityLocked");
  assert.ok(locked, "LiquidityLocked");
  const v3 = await v3Of(s.t0, s.t1);
  const cur = (await read(v3, "slot0"))[0];
  const diff = cur > s.target ? cur - s.target : s.target - cur;
  assert.ok(diff * 10_000n <= s.target * 100n, "цена пула в допуске после миграции");
  assert.equal((await read(pm, "ownerOf", [locked.args.positionId])).toLowerCase(), s.migrator.address.toLowerCase(), "NFT заперт в миграторе");
  assert.equal(await read(s.pool, "ethReserve"), 0n, "резерв ушёл с кривой");
  assert.equal(await read(weth, "balanceOf", [s.migrator.address]), 0n, "WETH в миграторе не осталось");
  assert.equal(await read(s.token, "balanceOf", [s.migrator.address]), 0n, "токенов в миграторе не осталось");
  return locked;
}
// «Монеты держателей и ETH на месте»: после неудачной миграции ничего не изменилось.
async function assertUntouched(s) {
  assert.equal(await read(s.pool, "ethReserve"), s.ethAmount, "ETH остался на кривой");
  assert.equal(await read(s.pool, "migrated"), false);
  assert.equal(await read(s.token, "balanceOf", [s.pool.address]) >= s.tokenAmount, true, "токены на кривой");
}
async function seedAttackerLiquidity(s, bad, wethIn, tokenShare) {
  // атакующий заранее купил токены на кривой (tokenShare) и льёт позицию по чужой цене
  await write(attacker, pm, "createAndInitializePoolIfNecessary", [s.t0, s.t1, 3000, bad]);
  await write(attacker, weth, "deposit", [], wethIn);
  const tok = await read(s.token, "balanceOf", [attacker.address]);
  await write(attacker, s.token, "approve", [pm.address, tok]);
  await write(attacker, weth, "approve", [pm.address, wethIn]);
  const [a0d, a1d] = s.tokenIsZero ? [tok, wethIn] : [wethIn, tok];
  await write(attacker, pm, "mint", [{ token0: s.t0, token1: s.t1, ...FULL, amount0Desired: a0d, amount1Desired: a1d, amount0Min: 0n, amount1Min: 0n, recipient: attacker.address, deadline: 10n ** 12n }]);
  const v3 = await v3Of(s.t0, s.t1);
  assert.ok((await read(v3, "liquidity")) > 0n, "чужая ликвидность есть");
}

test("ETH: честная миграция на настоящем Uniswap V3", async () => {
  const s = await graduate(await ethSetup());
  await assertMigrated(s, await write(trader, s.pool, "migrate"));
});

for (const [label, mul] of [["ЗАВЫШЕННАЯ", 3n], ["ЗАНИЖЕННАЯ", -3n]]) {
  test(`ETH: пустой пул создан заранее по ${label} цене — цена возвращается даром, миграция проходит`, async () => {
    const s = await graduate(await ethSetup());
    const up = (mul > 0n) === s.tokenIsZero;
    const bad = up ? s.target * 3n : s.target / 3n;
    await write(attacker, pm, "createAndInitializePoolIfNecessary", [s.t0, s.t1, 3000, bad]);
    const rc = await write(trader, s.pool, "migrate");
    await assertMigrated(s, rc);
    const aligned = findEvent(rc, s.migrator.abi, "PriceAligned");
    assert.ok(aligned, "цену выравнивали");
  });
}

test("ETH: крошечная чужая ликвидность НИЖЕ цены (токен дёшев) — покупаем токены в пределах бюджета, миграция проходит", async () => {
  const s0 = await ethSetup();
  await write(attacker, s0.pool, "buy", [0n, attacker.address], parseEther("0.05"));
  const s = await graduate(s0);
  const bad = s.tokenIsZero ? s.target / 4n : s.target * 4n; // токен в 16 раз дешевле
  await seedAttackerLiquidity(s, bad, parseEther("0.02"));
  const ethBefore = await read(s.pool, "ethReserve");
  const rc = await write(trader, s.pool, "migrate");
  const locked = await assertMigrated(s, rc);
  // На выравнивание ушло не больше 1% ETH; остальное — в позицию
  assert.ok(locked.args.ethAmount === ethBefore, "в событии — переданная сумма");
});

test("ETH: крошечная чужая ликвидность ВЫШЕ цены — продаём токены дороже справедливого, миграция проходит", async () => {
  const s0 = await ethSetup();
  await write(attacker, s0.pool, "buy", [0n, attacker.address], parseEther("0.05"));
  const s = await graduate(s0);
  const bad = s.tokenIsZero ? s.target * 4n : s.target / 4n; // токен в 16 раз дороже
  await seedAttackerLiquidity(s, bad, parseEther("0.02"));
  await assertMigrated(s, await write(trader, s.pool, "migrate"));
});

test("ETH: чужой капитал больше бюджета — миграция откладывается, деньги целы; любой арбитражник забирает дешёвые токены — проходит", async () => {
  const s0 = await ethSetup();
  await write(attacker, s0.pool, "buy", [0n, attacker.address], parseEther("0.5"));
  const s = await graduate(s0);
  const bad = s.tokenIsZero ? s.target / 4n : s.target * 4n; // токен в 16 раз дешевле
  await seedAttackerLiquidity(s, bad, parseEther("1")); // ~1.5 ETH чужого капитала против бюджета 0.065
  assert.equal(await revertsWith(trader, s.pool, "migrate"), "PoolPriceManipulated");
  await assertUntouched(s);
  // бюджет: чужой не может, владелец — в пределах потолка
  assert.ok(await revertsWith(attacker, s.migrator, "setAlignBudget", [500n]));
  assert.ok(await revertsWith(deployer, s.migrator, "setAlignBudget", [501n]), "потолок 5%");
  await write(deployer, s.migrator, "setAlignBudget", [500n]);
  // Пока чужая ликвидность держит цену, токены в пуле в 16 раз дешевле
  // справедливого — любой (в т.ч. владелец) скупает их до целевой цены с
  // выгодой; атакующий платит за блокировку своими деньгами.
  const router = await deployUni(deployer, "v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json", [uniFactory.address, weth.address]);
  await write(trader, weth, "deposit", [], parseEther("5"));
  await write(trader, weth, "approve", [router.address, parseEther("5")]);
  const wethBefore = await read(weth, "balanceOf", [trader.address]);
  await write(trader, router, "exactInputSingle", [{ tokenIn: weth.address, tokenOut: s.token.address, fee: 3000, recipient: trader.address, deadline: 10n ** 12n, amountIn: parseEther("5"), amountOutMinimum: 0n, sqrtPriceLimitX96: s.target }]);
  const spent = wethBefore - (await read(weth, "balanceOf", [trader.address]));
  assert.ok(spent > 0n && spent < parseEther("2"), "арбитраж стоит меньше, чем вложил атакующий");
  await assertMigrated(s, await write(trader, s.pool, "migrate"));
});

test("ETH: сдвиг цены после градации и до миграции (сделка через чужую ликвидность) — миграция всё равно проходит", async () => {
  const s0 = await ethSetup();
  await write(attacker, s0.pool, "buy", [0n, attacker.address], parseEther("0.05"));
  const s = await graduate(s0);
  await seedAttackerLiquidity(s, s.target, parseEther("0.02")); // по правильной цене
  // атакующий двигает цену свапом через своё позицию (продаёт токены)
  const router = await deployUni(deployer, "v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json", [uniFactory.address, weth.address]);
  const tok = await read(s.token, "balanceOf", [attacker.address]);
  if (tok > 0n) {
    await write(attacker, s.token, "approve", [router.address, tok]);
    await write(attacker, router, "exactInputSingle", [{ tokenIn: s.token.address, tokenOut: weth.address, fee: 3000, recipient: attacker.address, deadline: 10n ** 12n, amountIn: tok / 2n, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }]);
  }
  await assertMigrated(s, await write(trader, s.pool, "migrate"));
});

test("ETH: колбэк свапа снаружи не работает (нельзя вытащить токены)", async () => {
  const s = await graduate(await ethSetup());
  await write(trader, s.pool, "migrate");
  assert.ok(await revertsWith(attacker, s.migrator, "uniswapV3SwapCallback", [1n, 0n, "0x"]));
});

// ---------------------------------------------------------------- монета за валюту
async function quoteSetup() {
  const stock = await deploy(deployer, "MockStock", ["Google", "GOOGL"]);
  const migrator = await deploy(deployer, "UniswapV3MigratorQuote", [pm.address]);
  await write(deployer, migrator, "setDustSink", [deployer.address]);
  const factory = await deploy(deployer, "LaunchpadFactoryQuote", [deployer.address, migrator.address]);
  await write(deployer, factory, "initConfig", [deployer.address, migrator.address, 100, 6000]);
  const VIRTUAL = parseUnits("10", 18); // градация при 4×virtual = 40 GOOGL
  await write(deployer, factory, "setQuote", [stock.address, true, VIRTUAL, parseUnits("1000", 18)]);
  const rc = await write(creator, factory, "createToken", ["Coin", "COIN", "", stock.address, "0x0000000000000000000000000000000000000000", 200]);
  const ev = findEvent(rc, factory.abi, "TokenCreated");
  const token = { address: ev.args.token, abi: ART("DividendToken").abi };
  const pool = { address: ev.args.pool, abi: ART("BondingCurvePoolQuote").abi };
  for (const a of [trader, attacker]) {
    await write(deployer, stock, "mint", [a.address, parseUnits("1000", 18)]);
    await write(a, stock, "approve", [pool.address, parseUnits("1000", 18)]);
  }
  return { stock, migrator, factory, token, pool };
}
async function graduateQ(s) {
  await write(trader, s.pool, "buy", [parseUnits("100", 18), 0n, trader.address]);
  assert.equal(await read(s.pool, "graduated"), true);
  const quoteAmount = await read(s.pool, "quoteReserve");
  const tokenAmount = (await read(s.pool, "totalSupply")) - (await read(s.pool, "saleCap"));
  const tokenIsZero = BigInt(s.token.address) < BigInt(s.stock.address);
  const [t0, t1] = tokenIsZero ? [s.token.address, s.stock.address] : [s.stock.address, s.token.address];
  const [a0, a1] = tokenIsZero ? [tokenAmount, quoteAmount] : [quoteAmount, tokenAmount];
  return { ...s, quoteAmount, tokenAmount, tokenIsZero, t0, t1, target: sqrtPrice(a0, a1) };
}
async function assertMigratedQ(s, rc) {
  const locked = findEvent(rc, s.migrator.abi, "LiquidityLocked");
  assert.ok(locked, "LiquidityLocked");
  const v3 = await v3Of(s.t0, s.t1);
  const cur = (await read(v3, "slot0"))[0];
  const diff = cur > s.target ? cur - s.target : s.target - cur;
  assert.ok(diff * 10_000n <= s.target * 100n, "цена пула в допуске после миграции");
  assert.equal((await read(pm, "ownerOf", [locked.args.positionId])).toLowerCase(), s.migrator.address.toLowerCase());
  assert.equal(await read(s.pool, "quoteReserve"), 0n);
  assert.equal(await read(s.stock, "balanceOf", [s.migrator.address]), 0n, "quote в миграторе не осталось");
  assert.equal(await read(s.token, "balanceOf", [s.migrator.address]), 0n);
  assert.equal(await read(s.token, "excluded", [v3.address]), true, "DEX-пул исключён из дивидендов");
}

test("Валюта: честная миграция на настоящем Uniswap V3", async () => {
  const s = await graduateQ(await quoteSetup());
  await assertMigratedQ(s, await write(trader, s.pool, "migrate"));
});

for (const [label, up] of [["ЗАВЫШЕННОЙ", true], ["ЗАНИЖЕННОЙ", false]]) {
  test(`Валюта: пустой пул заранее по ${label} цене — миграция проходит`, async () => {
    const s = await graduateQ(await quoteSetup());
    const bad = (up === s.tokenIsZero) ? s.target * 3n : s.target / 3n;
    await write(attacker, pm, "createAndInitializePoolIfNecessary", [s.t0, s.t1, 3000, bad]);
    await assertMigratedQ(s, await write(trader, s.pool, "migrate"));
  });
}

test("Валюта: крошечная чужая ликвидность ниже цены — покупаем токены за валюту в пределах бюджета, миграция проходит", async () => {
  const s0 = await quoteSetup();
  await write(attacker, s0.pool, "buy", [parseUnits("0.5", 18), 0n, attacker.address]);
  const s = await graduateQ(s0);
  const bad = s.tokenIsZero ? s.target / 4n : s.target * 4n;
  await write(attacker, pm, "createAndInitializePoolIfNecessary", [s.t0, s.t1, 3000, bad]);
  const tok = await read(s.token, "balanceOf", [attacker.address]);
  const q = parseUnits("0.1", 18);
  await write(attacker, s.token, "approve", [pm.address, tok]);
  await write(attacker, s.stock, "approve", [pm.address, q]);
  const [a0d, a1d] = s.tokenIsZero ? [tok, q] : [q, tok];
  await write(attacker, pm, "mint", [{ token0: s.t0, token1: s.t1, ...FULL, amount0Desired: a0d, amount1Desired: a1d, amount0Min: 0n, amount1Min: 0n, recipient: attacker.address, deadline: 10n ** 12n }]);
  await assertMigratedQ(s, await write(trader, s.pool, "migrate"));
});
