/**
 * Кривая с ERC20-валютой (токенизированные акции) — фабрика + пул.
 *  1. фабрика: quote должен быть в whitelist, иначе createToken реверт
 *  2. запуск: 1B токенов у пула, реестр заполнен, quoteOf верный
 *  3. покупка за quote (approve → buy): токены получены, комиссия делится 50/50
 *  4. продажа: quote возвращается за вычетом комиссии
 *  5. клеймы комиссий создателя и протокола — в quote
 *  6. кап создателя в quote соблюдается
 *  7. слиппедж: minTokensOut больше расчёта → реверт
 *  8. градация: докупаем до SALE_CAP → graduated, migrate зовёт мигратора
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner/team
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // creator
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // alice
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // treasury
];
const [owner, creator, alice, treasury] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });
const E = (n) => parseEther(String(n));

async function deploy(account, name, args = []) {
  const art = ART(name);
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return rc.contractAddress;
}
const call = async (acc, addr, abiName, fn, args = [], value = 0n) => {
  const hash = await w(acc).writeContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args, value });
  return pub.waitForTransactionReceipt({ hash });
};
const read = (addr, abiName, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });

let factory, stock, migrator;
const VIRTUAL = E(1.625);              // порог градации = 6.5 акций
const CREATOR_CAP = E(0.13);

before(async () => {
  // мок-мигратор (принимает migrateQuote — нам достаточно ETH-мока? нет, нужен quote)
  // используем реальный quote-мигратор с мок position manager
  const pm = await deploy(owner, "MockPositionManager");
  migrator = await deploy(owner, "UniswapV3MigratorQuote", [pm]);

  factory = await deploy(owner, "LaunchpadFactoryQuote", [treasury.address, migrator]);
  await call(owner, factory, "LaunchpadFactoryQuote", "initConfig", [treasury.address, migrator, 100, 5000]);

  stock = await deploy(owner, "MockStock", ["Apple RH", "AAPL"]);
  // раздаём акции покупателям
  for (const s of [creator, alice]) {
    await call(owner, stock, "MockStock", "mint", [s.address, E(1000)]);
  }
});

test("quote вне whitelist — createToken реверт", async () => {
  await assert.rejects(
    call(creator, factory, "LaunchpadFactoryQuote", "createToken", ["Tok", "TOK", "ipfs://x", stock, creator.address])
  );
});

let token, pool;
test("whitelist quote и запуск токена", async () => {
  await call(owner, factory, "LaunchpadFactoryQuote", "setQuote", [stock, true, VIRTUAL, CREATOR_CAP]);
  const rc = await call(creator, factory, "LaunchpadFactoryQuote", "createToken",
    ["MyStock Token", "MST", "ipfs://meta", stock, creator.address]);
  token = await read(factory, "LaunchpadFactoryQuote", "poolOf", [await read(factory, "LaunchpadFactoryQuote", "allTokens", [0])]);
  const tokenAddr = await read(factory, "LaunchpadFactoryQuote", "allTokens", [0]);
  pool = await read(factory, "LaunchpadFactoryQuote", "poolOf", [tokenAddr]);
  token = tokenAddr;
  assert.equal((await read(factory, "LaunchpadFactoryQuote", "quoteOf", [token])).toLowerCase(), stock.toLowerCase());
  assert.equal(await read(token, "LaunchToken", "balanceOf", [pool]), E(1_000_000_000));
  assert.equal(await read(token, "LaunchToken", "totalSupply"), E(1_000_000_000));
});

test("покупка за quote: токены получены, комиссия 50/50", async () => {
  // покупаем 1 акцию (< порога градации 6.5) — вся сумма идёт в кривую
  await call(alice, stock, "MockStock", "approve", [pool, E(1)]);
  await call(alice, pool, "BondingCurvePoolQuote", "buy", [E(1), 0n, alice.address]);
  const bal = await read(token, "LaunchToken", "balanceOf", [alice.address]);
  assert.ok(bal > 0n, "токены не получены");
  const fee = E(1) * 100n / 10_000n; // 1% от 1 акции = 0.01
  assert.equal(await read(pool, "BondingCurvePoolQuote", "creatorFeesAccrued"), fee / 2n);
  assert.equal(await read(pool, "BondingCurvePoolQuote", "protocolFeesAccrued"), fee - fee / 2n);
  assert.equal(await read(pool, "BondingCurvePoolQuote", "quoteReserve"), E(1) - fee);
});

test("продажа: quote возвращается за вычетом комиссии", async () => {
  const bal = await read(token, "LaunchToken", "balanceOf", [alice.address]);
  const half = bal / 2n;
  await call(alice, token, "LaunchToken", "approve", [pool, half]);
  const before = await read(stock, "MockStock", "balanceOf", [alice.address]);
  await call(alice, pool, "BondingCurvePoolQuote", "sell", [half, 0n]);
  const after = await read(stock, "MockStock", "balanceOf", [alice.address]);
  assert.ok(after > before, "quote не вернулся");
});

test("клейм комиссий создателя и протокола — в quote", async () => {
  const cFee = await read(pool, "BondingCurvePoolQuote", "creatorFeesAccrued");
  assert.ok(cFee > 0n);
  const c0 = await read(stock, "MockStock", "balanceOf", [creator.address]);
  await call(creator, pool, "BondingCurvePoolQuote", "claimCreatorFees", [creator.address]);
  assert.equal((await read(stock, "MockStock", "balanceOf", [creator.address])) - c0, cFee);

  const pFee = await read(pool, "BondingCurvePoolQuote", "protocolFeesAccrued");
  const t0 = await read(stock, "MockStock", "balanceOf", [treasury.address]);
  await call(alice, pool, "BondingCurvePoolQuote", "claimProtocolFees");
  assert.equal((await read(stock, "MockStock", "balanceOf", [treasury.address])) - t0, pFee);
});

test("кап создателя в quote соблюдается", async () => {
  await call(owner, stock, "MockStock", "mint", [creator.address, E(1)]);
  await call(creator, stock, "MockStock", "approve", [pool, E(1)]);
  // CREATOR_CAP = 0.13; покупка на 1 акцию от создателя > кап → реверт
  await assert.rejects(call(creator, pool, "BondingCurvePoolQuote", "buy", [E(1), 0n, creator.address]));
});

test("слиппедж: завышенный minTokensOut → реверт", async () => {
  await call(owner, stock, "MockStock", "mint", [alice.address, E(5)]);
  await call(alice, stock, "MockStock", "approve", [pool, E(5)]);
  await assert.rejects(call(alice, pool, "BondingCurvePoolQuote", "buy", [E(5), E(999_999_999), alice.address]));
});

test("градация: докупаем до SALE_CAP, migrate зовёт мигратора", async () => {
  // отдельный свежий запуск, чтобы докупить кривую целиком
  await call(owner, stock, "MockStock", "mint", [alice.address, E(20)]);
  const rc = await call(alice, factory, "LaunchpadFactoryQuote", "createToken",
    ["Grad", "GRAD", "ipfs://g", stock, creator.address]);
  const tk = await read(factory, "LaunchpadFactoryQuote", "allTokens", [
    (await read(factory, "LaunchpadFactoryQuote", "tokenCount")) - 1n,
  ]);
  const pl = await read(factory, "LaunchpadFactoryQuote", "poolOf", [tk]);

  // покупаем большими порциями до градации
  let graduated = false;
  for (let i = 0; i < 12 && !graduated; i++) {
    await call(alice, stock, "MockStock", "approve", [pl, E(2)]);
    try { await call(alice, pl, "BondingCurvePoolQuote", "buy", [E(2), 0n, alice.address]); } catch {}
    graduated = await read(pl, "BondingCurvePoolQuote", "graduated");
  }
  assert.ok(graduated, "не градуировался");
  // migrate: пул шлёт токен+quote мигратору и зовёт migrateQuote
  await call(alice, pl, "BondingCurvePoolQuote", "migrate");
  assert.equal(await read(pl, "BondingCurvePoolQuote", "migrated"), true);
});
