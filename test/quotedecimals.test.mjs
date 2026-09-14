/**
 * Кривая на валюте с НЕ-18 знаками: USDG (6) и CBBTC (8).
 *
 * Зачем отдельным файлом. Вся остальная обвязка тестов работает на 18
 * знаках, и если где-то в кривой или в мигрторе зашито «18», на USDG это
 * вылезло бы только в мейннете и только на чужих деньгах. USDG при этом —
 * самая оборотистая валюта сети, то есть первая, которую выберут.
 *
 * Проверяем ровно то, что ломается от знаков: порог градации, покупку,
 * продажу, комиссии и саму градацию.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];
const [owner, creator, alice, treasury] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

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

// USDG: 6 знаков, порог градации 16 000 — ровно то, что уйдёт в мейннет.
const DEC = 6;
const U = (n) => parseUnits(String(n), DEC);
const TARGET = U(16000);
const VIRTUAL = TARGET / 4n;      // кривая собирает 4 × virtual
const CREATOR_CAP = U(1600);

let factory, quote, migrator, token, pool;

before(async () => {
  const pm = await deploy(owner, "MockPositionManager");
  migrator = await deploy(owner, "UniswapV3MigratorQuote", [pm]);
  factory = await deploy(owner, "LaunchpadFactoryQuote", [treasury.address, migrator]);
  await call(owner, factory, "LaunchpadFactoryQuote", "initConfig", [treasury.address, migrator, 100, 5000]);

  quote = await deploy(owner, "MockQuote6", ["Global Dollar", "USDG", DEC]);
  for (const s of [creator, alice]) {
    await call(owner, quote, "MockQuote6", "mint", [s.address, U(100000)]);
  }
  await call(owner, factory, "LaunchpadFactoryQuote", "setQuote", [quote, true, VIRTUAL, CREATOR_CAP]);
});

test("валюта действительно шестизначная", async () => {
  assert.equal(Number(await read(quote, "MockQuote6", "decimals", [])), DEC);
});

test("запуск токена за шестизначную валюту", async () => {
  await call(creator, factory, "LaunchpadFactoryQuote", "createToken",
    ["Dollar Coin", "DLR", "data:,x", quote, creator.address]);
  token = await read(factory, "LaunchpadFactoryQuote", "allTokens", [0]);
  pool = await read(factory, "LaunchpadFactoryQuote", "poolOf", [token]);
  assert.equal((await read(factory, "LaunchpadFactoryQuote", "quoteOf", [token])).toLowerCase(), quote.toLowerCase());
  // у пула должен лежать весь сапплай
  assert.equal(await read(token, "LaunchToken", "balanceOf", [pool]), 1000000000n * 10n ** 18n);
});

test("покупка: токены пришли, валюта списалась ровно на сумму покупки", async () => {
  const spend = U(100);
  const before = await read(quote, "MockQuote6", "balanceOf", [alice.address]);
  await call(alice, quote, "MockQuote6", "approve", [pool, spend]);
  await call(alice, pool, "BondingCurvePoolQuote", "buy", [spend, 0n, alice.address]);
  const after = await read(quote, "MockQuote6", "balanceOf", [alice.address]);
  assert.equal(before - after, spend);
  assert.ok((await read(token, "LaunchToken", "balanceOf", [alice.address])) > 0n, "токены не пришли");
});

test("продажа возвращает валюту в тех же знаках", async () => {
  const bal = await read(token, "LaunchToken", "balanceOf", [alice.address]);
  const q0 = await read(quote, "MockQuote6", "balanceOf", [alice.address]);
  await call(alice, token, "LaunchToken", "approve", [pool, bal]);
  await call(alice, pool, "BondingCurvePoolQuote", "sell", [bal, 0n]);
  const q1 = await read(quote, "MockQuote6", "balanceOf", [alice.address]);
  const back = q1 - q0;
  assert.ok(back > 0n, "валюта не вернулась");
  // За круг покупка+продажа теряется только комиссия (1% с каждой стороны),
  // а не 12 порядков — именно это сломалось бы при путанице со знаками.
  assert.ok(back > U(97) && back < U(100), `вернулось ${back}, ожидали ~98 USDG`);
});

test("кап создателя считается в тех же знаках", async () => {
  const over = CREATOR_CAP + U(1);
  await call(owner, quote, "MockQuote6", "mint", [creator.address, over]);
  await call(creator, quote, "MockQuote6", "approve", [pool, over]);
  await assert.rejects(call(creator, pool, "BondingCurvePoolQuote", "buy", [over, 0n, creator.address]));
});

test("градация наступает у порога, а не в миллион раз позже", async () => {
  // Докупаем до распродажи кривой. Если бы знаки путались, порог оказался бы
  // недостижим и этот цикл не кончился бы градацией.
  for (let i = 0; i < 40; i++) {
    if (await read(pool, "BondingCurvePoolQuote", "graduated", [])) break;
    const step = U(3000);
    await call(owner, quote, "MockQuote6", "mint", [alice.address, step]);
    await call(alice, quote, "MockQuote6", "approve", [pool, step]);
    try { await call(alice, pool, "BondingCurvePoolQuote", "buy", [step, 0n, alice.address]); }
    catch { break; }
  }
  assert.equal(await read(pool, "BondingCurvePoolQuote", "graduated", []), true, "градация не наступила");
  const raised = await read(pool, "BondingCurvePoolQuote", "quoteReserve", []);
  // Собрано должно быть порядка порога (16 000), а не 16 миллиардов.
  assert.ok(raised >= TARGET / 2n && raised <= TARGET * 2n, `собрано ${raised}, ждали около ${TARGET}`);
});
