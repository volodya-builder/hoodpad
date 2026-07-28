/**
 * Финальная партия защит перед боевым запуском (аудит 27.07.2026):
 *  1. кап на первую покупку создателя
 *  2. лимиты имени / тикера / метаданных
 *  3. таймлок на смену конфигурации
 *  4. делистнутый токен не выкупается
 *  5. клейм комиссий на нулевой адрес запрещён
 *  6. дефолтная экономика в коде = 50/20/30
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
const [deployer, user] = KEYS.map((k) => privateKeyToAccount(k));
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

let factory, treasury, migrator;

before(async () => {
  migrator = await deploy(deployer, "MockMigrator");
  factory = await deploy(deployer, "LaunchpadFactoryV2", [deployer.address, migrator.address]);
  treasury = await deploy(deployer, "BuybackTreasuryV2", [factory.address]);
  await write(deployer, factory, "initConfig",
    [treasury.address, migrator.address, "0x0000000000000000000000000000000000000000", 100, 5000]);
});

test("экономика по умолчанию — 50% создателю (было 20% в коде)", async () => {
  assert.equal(await read(factory, "creatorFeeShareBps"), 5000);
  assert.equal(await read(factory, "feeBps"), 100);
});

test("кап на первую покупку создателя соблюдается", async () => {
  const cap = await read(factory, "CREATOR_MAX_FIRST_BUY");
  assert.ok(cap > 0n && cap < parseEther("1"), "кап должен быть заметно меньше кривой");

  // в пределах капа — можно
  const ok = await write(deployer, factory, "createToken",
    ["Fair", "FAIR", "", deployer.address], cap);
  assert.equal(ok.status, "success");

  // выше капа — нельзя (иначе создатель скупает низ кривой и доит выкупы)
  const err = await write(deployer, factory, "createToken",
    ["Greedy", "GREED", "", deployer.address], cap + 1n).then(() => null).catch((e) => e);
  assert.ok(err, "покупка выше капа должна отклоняться");
});

test("кап создателя нельзя обойти прямой покупкой у пула", async () => {
  // создаём токен без ETH, затем создатель пробует скупить низ кривой напрямую
  await write(user, factory, "createToken", ["Direct", "DIR", "", user.address]);
  const n = await read(factory, "tokenCount");
  const tok = await read(factory, "allTokens", [n - 1n]);
  const poolAddr = await read(factory, "poolOf", [tok]);
  const pool = { address: poolAddr, abi: ART("BondingCurvePoolV2").abi };
  const cap = await read(pool, "CREATOR_BUY_CAP");

  // в пределах капа — проходит
  const ok = await write(user, pool, "buy", [0n, user.address], cap);
  assert.equal(ok.status, "success");

  // сверх капа — отклоняется (раньше это был обход лимита фабрики)
  const err = await write(user, pool, "buy", [0n, user.address], 1n)
    .then(() => null).catch((e) => e);
  assert.ok(err, "суммарные покупки создателя должны быть ограничены");

  // посторонний покупает свободно
  const other = await write(deployer, pool, "buy", [0n, deployer.address], parseEther("0.5"));
  assert.equal(other.status, "success", "обычных трейдеров кап не касается");
});

test("лимиты метаданных: гигантские строки не пройдут", async () => {
  const long = "A".repeat(200);
  const e1 = await write(deployer, factory, "createToken", [long, "SYM", "", deployer.address])
    .then(() => null).catch((e) => e);
  assert.ok(e1, "слишком длинное имя должно отклоняться");

  const e2 = await write(deployer, factory, "createToken", ["Ok", "TOOLONGSYMBOL!", "", deployer.address])
    .then(() => null).catch((e) => e);
  assert.ok(e2, "слишком длинный тикер должен отклоняться");

  const e3 = await write(deployer, factory, "createToken", ["", "SYM", "", deployer.address])
    .then(() => null).catch((e) => e);
  assert.ok(e3, "пустое имя должно отклоняться");
});

test("таймлок: конфигурацию нельзя сменить мгновенно", async () => {
  const zero = "0x0000000000000000000000000000000000000000";
  // после запуска токенов initConfig больше недоступен
  const e0 = await write(deployer, factory, "initConfig",
    [treasury.address, user.address, zero, 100, 5000]).then(() => null).catch((e) => e);
  assert.ok(e0, "initConfig после первого токена должен быть закрыт");

  // заявка проходит, но применить сразу нельзя
  const rc = await write(deployer, factory, "proposeConfig",
    [treasury.address, user.address, zero, 100, 5000]);
  assert.equal(rc.status, "success");

  const e1 = await write(deployer, factory, "applyConfig").then(() => null).catch((e) => e);
  assert.ok(e1, "применение до истечения таймлока должно отклоняться");

  // мигратор всё ещё старый — ликвидность нельзя увести внезапно
  assert.equal((await read(factory, "migrator")).toLowerCase(), migrator.address.toLowerCase());

  const delay = await read(factory, "CONFIG_DELAY");
  assert.ok(delay >= 24n * 3600n, "задержка должна быть не меньше суток");
});

test("заявку можно отозвать", async () => {
  await write(deployer, factory, "cancelConfig");
  const p = await read(factory, "pendingConfig");
  assert.equal(p[5], 0n, "readyAt обнуляется");
});

test("делистнутый токен казна не выкупает", async () => {
  const tok = await read(factory, "allTokens", [0n]);
  await write(deployer, treasury, "delist", [tok, "test"]);
  // казна пуста, но проверка делиста должна сработать раньше проверки баланса
  const err = await write(deployer, treasury, "buyback", [tok, 1n, 0n]).then(() => null).catch((e) => e);
  assert.ok(err, "выкуп делистнутого токена должен отклоняться");
  await write(deployer, treasury, "relist", [tok]);
});

test("клейм комиссий на нулевой адрес запрещён", async () => {
  const tok = await read(factory, "allTokens", [0n]);
  const poolAddr = await read(factory, "poolOf", [tok]);
  const pool = { address: poolAddr, abi: ART("BondingCurvePoolV2").abi };
  const err = await write(deployer, pool, "claimCreatorFees",
    ["0x0000000000000000000000000000000000000000"]).then(() => null).catch((e) => e);
  assert.ok(err, "нулевой получатель должен отклоняться");
});
