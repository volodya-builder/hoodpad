/**
 * Дивиденды в валюте курвы — то, ради чего всё: холдерам капает USDG.
 *
 * Правила, которые здесь проверяются:
 *  1. налог берётся с каждой сделки в валюте монеты и уходит в токен;
 *  2. свой налог участнику сделки не достаётся: на покупке — тем, кто уже
 *     держит; на продаже — тем, кто остаётся;
 *  3. раздача пропорциональна балансу, и уже начисленное не переписывается
 *     при переводах и продажах;
 *  4. пул кривой держит сапплай и НЕ получает ничего;
 *  5. claim платит в валюте самому холдеру — и через claimFor тоже;
 *  6. деньги сходятся: на токене лежит ровно сумма невыплаченного (± вей);
 *  7. после градации DEX-пул исключён из раздачи автоматически;
 *  8. нулевой налог — старое поведение, валюта на токен не уходит;
 *  9. границы: >3% реверт, чужой вызов notify/setExcluded реверт.
 *
 * Валюта — 6-значная, как USDG: там ошибки со знаками вылезают первыми.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];
const [owner, alice, bob, carol] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

async function deploy(account, name, args = []) {
  const art = ART(name);
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
}
const call = async (acc, addr, abiName, fn, args = []) => {
  const hash = await w(acc).writeContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });
  return pub.waitForTransactionReceipt({ hash });
};
const read = (addr, abiName, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });

const DEC = 6;
const U = (n) => parseUnits(String(n), DEC);
const TARGET = U(16000);
const VIRTUAL = TARGET / 4n;
const CAP = U(1600);
const DIV_BPS = 200; // 2%
const FEE_BPS = 100; // 1%

let factory, quote, migrator, pm, token, pool;
const bal = (a) => read(quote, "MockQuote6", "balanceOf", [a]);
const tb = (a) => read(token, "DividendToken", "balanceOf", [a]);
const owed = (a) => read(token, "DividendToken", "withdrawableDividendOf", [a]);
const approveBuy = async (who, gross) => {
  await call(who, quote, "MockQuote6", "approve", [pool, gross]);
  return call(who, pool, "BondingCurvePoolQuote", "buy", [gross, 0n, who.address]);
};
const near = (a, b, tol, msg) => assert.ok((a > b ? a - b : b - a) <= tol, `${msg}: ${a} vs ${b}`);
// Пропорция «как балансы»: a/ta ≈ b/tb. Сравниваем произведения с
// относительной точностью 1e-6 — суммы в 6 знаках округляются до единицы,
// и абсолютный допуск для произведений порядка 1e33 не имеет смысла.
const proportional = (a, tbA, b, tbB, msg) => {
  const l = a * tbB, r = b * tbA;
  const diff = l > r ? l - r : r - l;
  assert.ok(diff * 1_000_000n <= (l > r ? l : r), `${msg}: ${l} vs ${r}`);
};

before(async () => {
  pm = await deploy(owner, "MockPositionManager");
  migrator = await deploy(owner, "UniswapV3MigratorQuote", [pm]);
  factory = await deploy(owner, "LaunchpadFactoryQuote", [owner.address, migrator]);
  await call(owner, factory, "LaunchpadFactoryQuote", "initConfig", [owner.address, migrator, FEE_BPS, 5000]);
  quote = await deploy(owner, "MockQuote6", ["Global Dollar", "USDG", DEC]);
  for (const s of [alice, bob, carol]) await call(owner, quote, "MockQuote6", "mint", [s.address, U(1_000_000)]);
  await call(owner, factory, "LaunchpadFactoryQuote", "setQuote", [quote, true, VIRTUAL, CAP]);
});

test("границы: налог выше 3% не запускается", async () => {
  await assert.rejects(call(alice, factory, "LaunchpadFactoryQuote", "createToken",
    ["X", "X", "data:,x", quote, alice.address, 301]));
});

test("запуск с налогом 2%: пул исключён из раздачи с первой секунды", async () => {
  await call(owner, factory, "LaunchpadFactoryQuote", "createToken",
    ["Div Coin", "DIV", "data:,x", quote, owner.address, DIV_BPS]);
  token = await read(factory, "LaunchpadFactoryQuote", "allTokens", [0]);
  pool = await read(factory, "LaunchpadFactoryQuote", "poolOf", [token]);
  assert.equal(Number(await read(token, "DividendToken", "divBps", [])), DIV_BPS);
  assert.equal(Number(await read(pool, "BondingCurvePoolQuote", "divBps", [])), DIV_BPS);
  assert.equal(await read(token, "DividendToken", "excluded", [pool]), true);
  assert.equal(await read(token, "DividendToken", "divSupply", []), 0n);
});

test("первая покупка: раздавать некому — налог ждёт в pot, покупатель сам себе не платит", async () => {
  const gross = U(1000);
  const expectTokens = await read(pool, "BondingCurvePoolQuote", "quoteBuy", [gross]);
  await approveBuy(alice, gross);
  assert.equal(await tb(alice.address), expectTokens, "quoteBuy должен совпадать с покупкой");
  assert.equal(await read(token, "DividendToken", "pot", []), gross * BigInt(DIV_BPS) / 10_000n);
  assert.equal(await owed(alice.address), 0n);
  // валюта налога уже лежит на токене, а не на пуле
  assert.equal(await bal(token), gross * BigInt(DIV_BPS) / 10_000n);
});

test("вторая покупка: pot + налог целиком уходят единственному холдеру", async () => {
  const gross = U(2000);
  await approveBuy(bob, gross);
  const expected = (U(1000) + gross) * BigInt(DIV_BPS) / 10_000n; // pot + этот налог
  near(await owed(alice.address), expected, 2n, "alice");
  assert.equal(await owed(bob.address), 0n, "bob покупал — свой налог не получает");
  assert.equal(await read(token, "DividendToken", "pot", []), 0n);
});

test("третья покупка: делится между двумя по балансу", async () => {
  const a0 = await owed(alice.address), b0 = await owed(bob.address);
  const gross = U(3000);
  await approveBuy(carol, gross);
  const div = gross * BigInt(DIV_BPS) / 10_000n;
  const ta = await tb(alice.address), tbb = await tb(bob.address);
  const gotA = (await owed(alice.address)) - a0, gotB = (await owed(bob.address)) - b0;
  near(gotA + gotB, div, 2n, "сумма раздачи = налог");
  // пропорция как балансы (с точностью до округления)
  proportional(gotA, ta, gotB, tbb, "пропорция по балансам");
  assert.equal(await owed(carol.address), 0n);
});

test("пул держит нераспроданный сапплай — и не получает ничего", async () => {
  // Кривая отдаёт первым покупкам много (после 6000 из 16000 продано ~59%),
  // поэтому сравниваем не «кто больше», а «пул вне раздачи, точка».
  const held = (await tb(alice.address)) + (await tb(bob.address)) + (await tb(carol.address));
  assert.equal((await tb(pool)) + held, 1_000_000_000n * 10n ** 18n, "сапплай = пул + люди");
  assert.equal(await read(token, "DividendToken", "divSupply", []), held, "в раздаче только люди");
  assert.equal(await owed(pool), 0n);
  assert.equal(await read(token, "DividendToken", "divBalance", [pool]), 0n);
});

test("перевод между людьми: начисленное остаётся, будущее делится по-новому", async () => {
  const a0 = await owed(alice.address);
  const half = (await tb(alice.address)) / 2n;
  await call(alice, token, "DividendToken", "transfer", [carol.address, half]);
  assert.equal(await owed(alice.address), a0, "перевод не трогает уже начисленное");
  const c0 = await owed(carol.address);
  await approveBuy(bob, U(1000)); // bob покупает — раздача alice и carol
  assert.ok((await owed(carol.address)) > c0, "carol теперь получает");
  const gotA = (await owed(alice.address)) - a0;
  const gotC = (await owed(carol.address)) - c0;
  const ta = await tb(alice.address), tc = await tb(carol.address);
  proportional(gotA, ta, gotC, tc, "пропорция по новым балансам");
});

test("продажа: продавцу свой налог не идёт, начисленное ранее сохраняется", async () => {
  const b0 = await owed(bob.address);
  const all = await tb(bob.address);
  await call(bob, token, "DividendToken", "approve", [pool, all]);
  const others0 = (await owed(alice.address)) + (await owed(carol.address));
  await call(bob, pool, "BondingCurvePoolQuote", "sell", [all, 0n]);
  assert.equal(await tb(bob.address), 0n);
  assert.equal(await owed(bob.address), b0, "продал всё — накопленное осталось, нового не прибавилось");
  const others1 = (await owed(alice.address)) + (await owed(carol.address));
  assert.ok(others1 > others0, "налог с продажи ушёл оставшимся");
  // продавец больше не в раздаче
  await approveBuy(carol, U(500));
  assert.equal(await owed(bob.address), b0, "после продажи капать перестало");
});

test("деньги сходятся: на токене ровно сумма невыплаченного", async () => {
  const sum = (await owed(alice.address)) + (await owed(bob.address)) + (await owed(carol.address));
  const pot = await read(token, "DividendToken", "pot", []);
  near(await bal(token), sum + pot, 5n, "баланс токена = долги + pot");
});

test("claim: валюта приходит холдеру; повторный claim даёт ноль", async () => {
  const due = await owed(alice.address);
  assert.ok(due > 0n);
  const q0 = await bal(alice.address);
  await call(alice, token, "DividendToken", "claim", []);
  assert.equal((await bal(alice.address)) - q0, due);
  assert.equal(await owed(alice.address), 0n);
  await call(alice, token, "DividendToken", "claim", []);
  assert.equal((await bal(alice.address)) - q0, due, "второй claim ничего не платит");
});

test("claimFor: чужой вызов платит холдеру, а не вызывающему", async () => {
  const due = await owed(carol.address);
  assert.ok(due > 0n);
  const c0 = await bal(carol.address), o0 = await bal(owner.address);
  await call(owner, token, "DividendToken", "claimFor", [carol.address]);
  assert.equal((await bal(carol.address)) - c0, due);
  assert.equal(await bal(owner.address), o0);
});

test("чужой notifyDividend / setExcluded — реверт", async () => {
  await assert.rejects(call(alice, token, "DividendToken", "notifyDividend", [1n]));
  await assert.rejects(call(alice, token, "DividendToken", "setExcluded", [alice.address, true]));
});

test("градация: DEX-пул исключён из раздачи автоматически; пул кривой сходится по деньгам", async () => {
  for (let i = 0; i < 60; i++) {
    if (await read(pool, "BondingCurvePoolQuote", "graduated", [])) break;
    const step = U(3000);
    await call(owner, quote, "MockQuote6", "mint", [alice.address, step]);
    try { await approveBuy(alice, step); } catch { break; }
  }
  assert.equal(await read(pool, "BondingCurvePoolQuote", "graduated", []), true);
  // На пуле: резерв + комиссии. Дивиденды ушли — их тут быть не должно.
  const r = await read(pool, "BondingCurvePoolQuote", "quoteReserve", []);
  const cf = await read(pool, "BondingCurvePoolQuote", "creatorFeesAccrued", []);
  const pf = await read(pool, "BondingCurvePoolQuote", "protocolFeesAccrued", []);
  assert.equal(await bal(pool), r + cf + pf, "на пуле ровно резерв + комиссии");
  const paid = await read(pool, "BondingCurvePoolQuote", "dividendsPaid", []);
  assert.ok(paid > 0n);

  await call(owner, pool, "BondingCurvePoolQuote", "migrate", []);
  const [t0, t1] = token.toLowerCase() < quote.toLowerCase() ? [token, quote] : [quote, token];
  const key = await read(pm, "MockPositionManager", "key", [t0, t1, 3000]);
  const v3 = await read(pm, "MockPositionManager", "pools", [key]);
  assert.notEqual(v3, "0x0000000000000000000000000000000000000000");
  assert.equal(await read(token, "DividendToken", "excluded", [v3]), true, "DEX-пул исключён");
  assert.equal(await read(token, "DividendToken", "divBalance", [v3]), 0n);
  // а что уже начислено людям — на месте и забирается
  const due = await owed(alice.address);
  assert.ok(due > 0n);
  const q0 = await bal(alice.address);
  await call(alice, token, "DividendToken", "claim", []);
  assert.equal((await bal(alice.address)) - q0, due);
});

test("налог 0%: валюта на токен не уходит, всё как раньше", async () => {
  await call(owner, factory, "LaunchpadFactoryQuote", "createToken",
    ["Plain", "PLN", "data:,x", quote, owner.address, 0]);
  const t2 = await read(factory, "LaunchpadFactoryQuote", "allTokens", [1]);
  const p2 = await read(factory, "LaunchpadFactoryQuote", "poolOf", [t2]);
  await call(bob, quote, "MockQuote6", "approve", [p2, U(1000)]);
  await call(bob, p2, "BondingCurvePoolQuote", "buy", [U(1000), 0n, bob.address]);
  assert.equal(await bal(t2), 0n);
  assert.equal(await read(p2, "BondingCurvePoolQuote", "dividendsPaid", []), 0n);
  assert.equal(await read(t2, "DividendToken", "withdrawableDividendOf", [bob.address]), 0n);
});
