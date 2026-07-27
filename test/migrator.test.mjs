/**
 * Защита мигратора от подмены цены пула Uniswap V3.
 *
 * Атака (аудит 27.07.2026): createAndInitializePoolIfNecessary инициализирует
 * пул ТОЛЬКО если он ещё не создан. Атакующий создаёт пул заранее по кривой
 * цене — и при градации вся ликвидность (6.5 ETH + 200M токенов) ложится по
 * его цене, после чего выкупается арбитражем.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
];
const [deployer, attacker] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

async function deploy(account, name, args = []) {
  const art = ART(name);
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return { address: rc.contractAddress, abi: art.abi };
}
const read = (c, fn, args = []) => pub.readContract({ address: c.address, abi: c.abi, functionName: fn, args });
async function write(account, c, fn, args = [], value) {
  const hash = await w(account).writeContract({ address: c.address, abi: c.abi, functionName: fn, args, value });
  return pub.waitForTransactionReceipt({ hash });
}

const TOKENS = parseEther("200000000"); // 200M на DEX
const ETH = parseEther("6.5");          // собранное на кривой

let pm, weth, token;

// Цена, которую посчитает мигратор: sqrt(amount1/amount0) * 2^96
function expectedSqrt(token0IsToken) {
  const a0 = token0IsToken ? TOKENS : ETH;
  const a1 = token0IsToken ? ETH : TOKENS;
  // целочисленный sqrt(a1 * 2^192 / a0) — как в контракте
  const v = (a1 << 192n) / a0;
  let x = v, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + v / x) / 2n; }
  return x;
}

before(async () => {
  pm = await deploy(deployer, "MockPositionManager");
  weth = await deploy(deployer, "MockWETH");
});

async function freshSetup() {
  // Токен, который «градуирует». Весь сапплай минтится на pool_ —
  // передаём deployer, чтобы свободно распоряжаться в тесте.
  token = await deploy(deployer, "LaunchToken", ["Test", "TST", "", deployer.address, TOKENS]);
  const migrator = await deploy(deployer, "UniswapV3Migrator", [pm.address, weth.address]);
  const gradPool = await deploy(deployer, "MockGraduatedPool", [deployer.address]);
  // Как в BondingCurvePoolV2: токены уходят мигратору ДО вызова migrate()
  await write(deployer, token, "transfer", [migrator.address, TOKENS]);
  return { migrator, gradPool };
}

test("честная цена: миграция проходит, ликвидность заперта", async () => {
  const { migrator, gradPool } = await freshSetup();
  const rc = await write(deployer, gradPool, "callMigrate",
    [migrator.address, token.address, TOKENS], ETH);
  assert.equal(rc.status, "success", "миграция при честной цене должна проходить");
  // токены ушли в позицию (у мигратора не осталось)
  const left = await read(token, "balanceOf", [migrator.address]);
  assert.equal(left, 0n, "токены должны уйти в позицию");
});

test("АТАКА: пул создан заранее по искажённой цене — миграция отменяется", async () => {
  const { migrator, gradPool } = await freshSetup();
  const tokenIs0 = BigInt(token.address) < BigInt(weth.address);
  const [t0, t1] = tokenIs0 ? [token.address, weth.address] : [weth.address, token.address];
  // атакующий заранее создаёт пул с ценой в 1000 раз выше расчётной
  const skewed = expectedSqrt(tokenIs0) * 1000n;
  await write(attacker, pm, "preCreate", [t0, t1, 3000, skewed]);

  const err = await write(deployer, gradPool, "callMigrate",
    [migrator.address, token.address, TOKENS], ETH).then(() => null).catch((e) => e);
  assert.ok(err, "миграция по чужой цене должна отменяться");
  // средства не потеряны: токены остались у мигратора, ETH — у вызывающего пула
  const left = await read(token, "balanceOf", [migrator.address]);
  assert.equal(left, TOKENS, "токены не должны уйти по цене атакующего");
});

test("АТАКА снизу: заниженная цена пула тоже отклоняется", async () => {
  const { migrator, gradPool } = await freshSetup();
  const tokenIs0 = BigInt(token.address) < BigInt(weth.address);
  const [t0, t1] = tokenIs0 ? [token.address, weth.address] : [weth.address, token.address];
  const skewed = expectedSqrt(tokenIs0) / 50n; // цена занижена в 2500 раз
  await write(attacker, pm, "preCreate", [t0, t1, 3000, skewed]);

  const err = await write(deployer, gradPool, "callMigrate",
    [migrator.address, token.address, TOKENS], ETH).then(() => null).catch((e) => e);
  assert.ok(err, "заниженная цена должна отклоняться");
});

test("пул, созданный заранее по ПРАВИЛЬНОЙ цене, не мешает миграции", async () => {
  const { migrator, gradPool } = await freshSetup();
  const tokenIs0 = BigInt(token.address) < BigInt(weth.address);
  const [t0, t1] = tokenIs0 ? [token.address, weth.address] : [weth.address, token.address];
  await write(attacker, pm, "preCreate", [t0, t1, 3000, expectedSqrt(tokenIs0)]);

  const rc = await write(deployer, gradPool, "callMigrate",
    [migrator.address, token.address, TOKENS], ETH);
  assert.equal(rc.status, "success", "корректная предсозданная цена не должна блокировать");
});

test("константы защиты заданы разумно", async () => {
  const { migrator } = await freshSetup();
  assert.equal(await read(migrator, "MAX_SQRT_DEVIATION_BPS"), 100n); // 1% по sqrt
  assert.equal(await read(migrator, "MIN_DEPOSIT_BPS"), 9000n);       // 90% депозита
});
