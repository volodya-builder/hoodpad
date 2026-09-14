/**
 * CurveZap — купить и продать монету за валюту, платя ETH.
 *
 * Что проверяем:
 *  1. покупка за ETH: ETH → валюта (через мок-пул V3) → монета покупателю;
 *     валюта попала в пул кривой, у zap ничего не осталось;
 *  2. дивиденды от такой покупки начисляются как от обычной (в валюте);
 *  3. продажа за ETH: монета → валюта → ETH на кошелёк; у zap пусто;
 *  4. проскальзывание: завышенный minTokensOut / minEthOut — реверт, и деньги
 *     покупателя не тронуты;
 *  5. дедлайн в прошлом — реверт;
 *  6. маршрут в два хопа (через USDG) — работает;
 *  7. валюта без маршрута — реверт NoRoute; монета не из фабрики — реверт;
 *  8. чужой колбэк — реверт; нечестный пул (взял вход, отдал ноль) — реверт;
 *  9. покупка, упёршаяся в потолок кривой: сдача возвращается покупателю;
 * 10. кап создателя действует и через zap;
 * 11. прямой перевод ETH на zap — реверт; rescue только владельцу.
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
const [owner, creator, alice, bob] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

async function deploy(account, name, args = []) {
  const art = ART(name);
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
}
const call = async (acc, addr, abiName, fn, args = [], value = 0n) => {
  const hash = await w(acc).writeContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args, value });
  return pub.waitForTransactionReceipt({ hash });
};
const read = (addr, abiName, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });
const sim = (acc, addr, abiName, fn, args = [], value = 0n) =>
  pub.simulateContract({ account: acc, address: addr, abi: ART(abiName).abi, functionName: fn, args, value }).then((r) => r.result);

const DEC = 6, U = (n) => parseUnits(String(n), DEC), E = (n) => parseEther(String(n));
const FAR = 4_000_000_000n; // дедлайн в далёком будущем
// Курс мок-пула WETH/USDG: 1 ETH = 2500 USDG. num/den между token0 и token1
// зависят от порядка адресов — считаем после деплоя.

let weth, usdg, msft, v3f, poolWU, poolUM, hoodF, migrator, zap, token, pool, tokenMsft, poolMsft;

before(async () => {
  weth = await deploy(owner, "MockWETH");
  usdg = await deploy(owner, "MockQuote6", ["Global Dollar", "USDG", DEC]);
  msft = await deploy(owner, "MockStock", ["Microsoft", "MSFT"]);
  v3f  = await deploy(owner, "MockV3Factory");

  // WETH/USDG: 1 ETH (1e18) = 2500 USDG (2500e6). out = in * num / den для token0→token1.
  const wIs0 = weth.toLowerCase() < usdg.toLowerCase();
  const [numWU, denWU] = wIs0 ? [2500n * 10n ** 6n, 10n ** 18n] : [10n ** 18n, 2500n * 10n ** 6n];
  poolWU = await deploy(owner, "MockV3SwapPool", [weth, usdg, numWU, denWU]);
  await call(owner, v3f, "MockV3Factory", "setPool", [weth, usdg, 500, poolWU]);
  // USDG/MSFT: 500 USDG = 1 MSFT (18 знаков).
  const uIs0 = usdg.toLowerCase() < msft.toLowerCase();
  const [numUM, denUM] = uIs0 ? [10n ** 18n, 500n * 10n ** 6n] : [500n * 10n ** 6n, 10n ** 18n];
  poolUM = await deploy(owner, "MockV3SwapPool", [usdg, msft, numUM, denUM]);
  await call(owner, v3f, "MockV3Factory", "setPool", [usdg, msft, 3000, poolUM]);
  // Запасы пулов: USDG и MSFT для выдачи, WETH — покупаем позже
  await call(owner, usdg, "MockQuote6", "mint", [poolWU, U(10_000_000)]);
  await call(owner, usdg, "MockQuote6", "mint", [poolUM, U(10_000_000)]);
  await call(owner, msft, "MockStock", "mint", [poolUM, E(100_000)]);
  // чтобы пул WETH/USDG мог отдавать WETH при продаже — положим ему WETH
  await call(owner, weth, "MockWETH", "deposit", [], E(50));
  await call(owner, weth, "MockWETH", "transfer", [poolWU, E(50)]);

  const pm = await deploy(owner, "MockPositionManager");
  migrator = await deploy(owner, "UniswapV3MigratorQuote", [pm]);
  hoodF = await deploy(owner, "LaunchpadFactoryQuote", [owner.address, migrator]);
  await call(owner, hoodF, "LaunchpadFactoryQuote", "initConfig", [owner.address, migrator, 100, 5000]);
  await call(owner, hoodF, "LaunchpadFactoryQuote", "setQuote", [usdg, true, U(4000), U(1600)]);
  await call(owner, hoodF, "LaunchpadFactoryQuote", "setQuote", [msft, true, E(5), E(0.5)]);

  zap = await deploy(owner, "CurveZap", [weth, v3f, hoodF]);
  await call(owner, zap, "CurveZap", "setRoute", [usdg, "0x0000000000000000000000000000000000000000", 500, 0, true]);
  await call(owner, zap, "CurveZap", "setRoute", [msft, usdg, 500, 3000, true]);

  // монета за USDG с 2% дивидендов
  await call(creator, hoodF, "LaunchpadFactoryQuote", "createToken", ["Div Coin", "DIV", "data:,x", usdg, creator.address, 200]);
  token = await read(hoodF, "LaunchpadFactoryQuote", "allTokens", [0]);
  pool = await read(hoodF, "LaunchpadFactoryQuote", "poolOf", [token]);
  // монета за MSFT (два хопа)
  await call(creator, hoodF, "LaunchpadFactoryQuote", "createToken", ["MS Coin", "MSC", "data:,x", msft, creator.address, 0]);
  tokenMsft = await read(hoodF, "LaunchpadFactoryQuote", "allTokens", [1]);
  poolMsft = await read(hoodF, "LaunchpadFactoryQuote", "poolOf", [tokenMsft]);
});

const bal = (t, a) => read(t, "MockQuote6", "balanceOf", [a]);
const tb = (t, a) => read(t, "DividendToken", "balanceOf", [a]);
const ethOf = (a) => pub.getBalance({ address: a });

test("покупка за ETH: монета у покупателя, валюта в пуле кривой, у zap пусто", async () => {
  assert.equal(await read(zap, "CurveZap", "supported", [token]), true);
  const expect = await sim(alice, zap, "CurveZap", "buyWithEth", [token, 0n, FAR], E(0.4));
  assert.ok(expect > 0n, "симуляция должна дать оценку");
  const q0 = await bal(usdg, pool);
  await call(alice, zap, "CurveZap", "buyWithEth", [token, expect, FAR], E(0.4));
  assert.equal(await tb(token, alice.address), expect, "получили ровно то, что обещала симуляция");
  // 0.4 ETH × 2500 = 1000 USDG ушли на кривую (за вычетом налога, он уехал в токен)
  const got = (await bal(usdg, pool)) - q0;
  assert.ok(got > U(900) && got <= U(1000), `в пуле кривой +${got}`);
  assert.equal(await bal(usdg, zap), 0n, "у zap не остаётся валюты");
  assert.equal(await read(weth, "MockWETH", "balanceOf", [zap]), 0n, "у zap не остаётся WETH");
  assert.equal(await tb(token, zap), 0n, "у zap не остаётся монет");
});

test("дивиденды от покупки через zap начисляются как обычно", async () => {
  await call(bob, zap, "CurveZap", "buyWithEth", [token, 0n, FAR], E(0.2));
  const owed = await read(token, "DividendToken", "withdrawableDividendOf", [alice.address]);
  assert.ok(owed > 0n, "alice должна получить долю налога с покупки bob");
});

test("продажа за ETH: ETH пришёл на кошелёк, у zap пусто", async () => {
  const half = (await tb(token, alice.address)) / 2n;
  await call(alice, token, "DividendToken", "approve", [zap, half]);
  const expect = await sim(alice, zap, "CurveZap", "sellForEth", [token, half, 0n, FAR]);
  assert.ok(expect > 0n);
  const e0 = await ethOf(alice.address);
  const rc = await call(alice, zap, "CurveZap", "sellForEth", [token, half, expect, FAR]);
  const gas = rc.gasUsed * rc.effectiveGasPrice;
  const e1 = await ethOf(alice.address);
  assert.equal(e1 - e0 + gas, expect, "получили ровно оценку");
  assert.equal(await bal(usdg, zap), 0n);
  assert.equal(await tb(token, zap), 0n);
});

test("проскальзывание: завышенный minTokensOut → реверт, ETH покупателя цел", async () => {
  const expect = await sim(alice, zap, "CurveZap", "buyWithEth", [token, 0n, FAR], E(0.1));
  const e0 = await ethOf(alice.address);
  await assert.rejects(call(alice, zap, "CurveZap", "buyWithEth", [token, expect * 2n, FAR], E(0.1)));
  const e1 = await ethOf(alice.address);
  assert.ok(e0 - e1 < E(0.01), "ушёл только газ, не 0.1 ETH");
});

test("проскальзывание на продаже: завышенный minEthOut → реверт, монеты целы", async () => {
  const amt = await tb(token, alice.address);
  await call(alice, token, "DividendToken", "approve", [zap, amt]);
  await assert.rejects(call(alice, zap, "CurveZap", "sellForEth", [token, amt, E(1000), FAR]));
  assert.equal(await tb(token, alice.address), amt);
});

test("дедлайн в прошлом — реверт", async () => {
  await assert.rejects(call(alice, zap, "CurveZap", "buyWithEth", [token, 0n, 1n], E(0.1)));
});

test("два хопа через USDG: монета за MSFT покупается за ETH", async () => {
  const expect = await sim(alice, zap, "CurveZap", "buyWithEth", [tokenMsft, 0n, FAR], E(0.4));
  assert.ok(expect > 0n);
  await call(alice, zap, "CurveZap", "buyWithEth", [tokenMsft, expect, FAR], E(0.4));
  assert.equal(await tb(tokenMsft, alice.address), expect);
  // 0.4 ETH → 1000 USDG → 2 MSFT ушли на кривую
  const inPool = await read(msft, "MockStock", "balanceOf", [poolMsft]);
  assert.ok(inPool > E(1.9) && inPool <= E(2), `MSFT в пуле: ${inPool}`);
  // и обратно
  const half = expect / 2n;
  await call(alice, tokenMsft, "DividendToken", "approve", [zap, half]);
  const out = await sim(alice, zap, "CurveZap", "sellForEth", [tokenMsft, half, 0n, FAR]);
  assert.ok(out > 0n);
  await call(alice, zap, "CurveZap", "sellForEth", [tokenMsft, half, out, FAR]);
  assert.equal(await read(msft, "MockStock", "balanceOf", [zap]), 0n);
  assert.equal(await bal(usdg, zap), 0n);
});

test("валюта без маршрута и чужая монета — реверт", async () => {
  await call(owner, zap, "CurveZap", "setRoute", [msft, usdg, 500, 3000, false]);
  assert.equal(await read(zap, "CurveZap", "supported", [tokenMsft]), false);
  await assert.rejects(call(alice, zap, "CurveZap", "buyWithEth", [tokenMsft, 0n, FAR], E(0.1)));
  await call(owner, zap, "CurveZap", "setRoute", [msft, usdg, 500, 3000, true]);
  await assert.rejects(call(alice, zap, "CurveZap", "buyWithEth", [usdg, 0n, FAR], E(0.1)), "не монета фабрики");
});

test("чужой колбэк — реверт; нечестный пул — реверт, ETH цел", async () => {
  await assert.rejects(call(alice, zap, "CurveZap", "uniswapV3SwapCallback", [1n, 0n, "0x"]));
  await call(owner, poolWU, "MockV3SwapPool", "setGreedy", [true]);
  const e0 = await ethOf(alice.address);
  await assert.rejects(call(alice, zap, "CurveZap", "buyWithEth", [token, 1n, FAR], E(0.1)));
  assert.ok(e0 - (await ethOf(alice.address)) < E(0.01), "жадный пул не унёс ETH");
  await call(owner, poolWU, "MockV3SwapPool", "setGreedy", [false]);
});

test("кап создателя действует и через zap", async () => {
  // кап 1600 USDG = 0.64 ETH; создатель пробует купить на 1 ETH
  await assert.rejects(call(creator, zap, "CurveZap", "buyWithEth", [token, 0n, FAR], E(1)));
});

test("покупка, упёршаяся в потолок кривой: сдача возвращается покупателю в валюте", async () => {
  // Порог 16 000 USDG = 6.4 ETH. Даём 10 ETH: кривая возьмёт сколько надо, остальное — назад.
  await call(owner, usdg, "MockQuote6", "mint", [poolWU, U(100_000_000)]);
  const u0 = await bal(usdg, bob.address);
  await call(bob, zap, "CurveZap", "buyWithEth", [token, 0n, FAR], E(10));
  assert.equal(await read(pool, "BondingCurvePoolQuote", "graduated", []), true, "градация наступила");
  const refund = (await bal(usdg, bob.address)) - u0;
  assert.ok(refund > 0n, `сдача вернулась: ${refund}`);
  assert.equal(await bal(usdg, zap), 0n);
});

test("прямой ETH на zap — реверт; rescue только владельцу", async () => {
  await assert.rejects(w(alice).sendTransaction({ to: zap, value: E(0.01) }).then((h) => pub.waitForTransactionReceipt({ hash: h })));
  await assert.rejects(call(alice, zap, "CurveZap", "rescue", [usdg, alice.address]));
});

test("валюта = WETH: покупка и продажа за ETH без обмена", async () => {
  await call(owner, hoodF, "LaunchpadFactoryQuote", "setQuote", [weth, true, E(1.625), E(0.13)]);
  await call(creator, hoodF, "LaunchpadFactoryQuote", "createToken", ["Weth Coin", "WC", "data:,x", weth, creator.address, 100]);
  const tw = await read(hoodF, "LaunchpadFactoryQuote", "allTokens", [2]);
  assert.equal(await read(zap, "CurveZap", "supported", [tw]), true, "WETH поддерживается без маршрута");
  const expect = await sim(alice, zap, "CurveZap", "buyWithEth", [tw, 0n, FAR], E(0.3));
  await call(alice, zap, "CurveZap", "buyWithEth", [tw, expect, FAR], E(0.3));
  assert.equal(await tb(tw, alice.address), expect);
  const half = expect / 2n;
  await call(alice, tw, "DividendToken", "approve", [zap, half]);
  const out = await sim(alice, zap, "CurveZap", "sellForEth", [tw, half, 0n, FAR]);
  const e0 = await ethOf(alice.address);
  const rc = await call(alice, zap, "CurveZap", "sellForEth", [tw, half, out, FAR]);
  assert.equal((await ethOf(alice.address)) - e0 + rc.gasUsed * rc.effectiveGasPrice, out);
  assert.equal(await read(weth, "MockWETH", "balanceOf", [zap]), 0n);
  assert.equal(await ethOf(zap), 0n, "ETH на zap не задерживается");
});
