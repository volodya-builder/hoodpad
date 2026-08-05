/**
 * HoodTaxToken v1 — налог на сделки через пулы + аллокация + дивиденды.
 *  1. переводы между кошельками — без налога
 *  2. покупка (пул → юзер): налог по buy-ставке, делится по аллокации
 *  3. продажа (юзер → пул): налог по sell-ставке
 *  4. дивиденды: только балансы >= minShare; claim работает; ниже порога — 0
 *  5. если правомочных холдеров нет — дивидендная доля уходит в lpReserve
 *  6. flushLp отправляет накопленное в lpSink
 *  7. exempt-адреса не платят налог
 *  8. controller: только он отмечает пулы; renounce блокирует навсегда
 *  9. конструктор: ставка >10% и аллокация != 100% — реверт
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer/controller
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // alice
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // bob
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // pool (EOA как «пул»)
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // creatorWallet
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // lpSink
];
const [deployer, alice, bob, pool, creator, sink] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

const E = (n) => parseEther(String(n));
let token, abi;

const read = (fn, args = []) => pub.readContract({ address: token, abi, functionName: fn, args });
const write = async (acc, fn, args = []) => {
  const hash = await w(acc).writeContract({ address: token, abi, functionName: fn, args });
  return pub.waitForTransactionReceipt({ hash });
};
const bal = (a) => read("balanceOf", [a.address ?? a]);

// конфиг: buy 5%, sell 8%; аллокация 40% кошелёк / 20% burn / 30% дивиденды / 10% LP;
// порог дивидендов — 1000 токенов
const CFG = { buyTaxBps: 500, sellTaxBps: 800, mktBps: 4000, burnBps: 2000, divBps: 3000, lpBps: 1000, minShare: E(1000) };

async function deployToken(cfg = CFG) {
  const art = ART("HoodTaxToken");
  const hash = await w(deployer).deployContract({
    abi: art.abi, bytecode: art.bytecode,
    args: ["Tax Test", "TAXT", "ipfs://meta", pool.address, E(1_000_000), creator.address, sink.address, cfg],
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return rc.contractAddress;
}

before(async () => {
  abi = ART("HoodTaxToken").abi;
  token = await deployToken();
  await write(deployer, "setPool", [pool.address, true]);
});

test("переводы между кошельками — без налога", async () => {
  // пул раздаёт напрямую нельзя (он taxed) — но alice→bob чистый перевод
  await write(pool, "transfer", [alice.address, E(100_000)]); // это «покупка», налог возьмётся
  const aliceBal = await bal(alice);
  await write(alice, "transfer", [bob.address, E(10_000)]);
  assert.equal(await bal(bob), E(10_000)); // без удержаний
  assert.equal(await bal(alice), aliceBal - E(10_000));
});

test("покупка: налог 5%, делится 40/20/30/10", async () => {
  const t2 = await deployToken();
  token = t2;
  await write(deployer, "setPool", [pool.address, true]);

  const supply0 = await read("totalSupply");
  await write(pool, "transfer", [alice.address, E(100_000)]); // buy

  const fee = E(100_000) * 500n / 10_000n;            // 5 000
  assert.equal(await bal(alice), E(100_000) - fee);    // 95 000 получено
  assert.equal(await bal(creator), fee * 4000n / 10_000n);       // 2 000 кошельку
  assert.equal(supply0 - (await read("totalSupply")), fee * 2000n / 10_000n); // 1 000 сожжено
  // дивиденды (30%): alice — единственный правомочный холдер, всё ей
  // (допуск 1 wei — пыль целочисленного деления magnified-схемы)
  const wd = await read("withdrawableDividendOf", [alice.address]);
  const expDiv = fee * 3000n / 10_000n;
  assert.ok(expDiv - wd <= 1n && wd <= expDiv, `dividend ${wd} != ~${expDiv}`);
  assert.equal(await read("lpReserve"), fee * 1000n / 10_000n);  // 500 в LP
});

test("продажа: налог по sell-ставке 8%", async () => {
  const creator0 = await bal(creator);
  await write(alice, "transfer", [pool.address, E(10_000)]); // sell
  const fee = E(10_000) * 800n / 10_000n; // 800
  assert.equal((await bal(creator)) - creator0, fee * 4000n / 10_000n);
});

test("порог дивидендов: мелкий холдер не участвует", async () => {
  // bob получает меньше порога (1000)
  await write(alice, "transfer", [bob.address, E(500)]);
  assert.equal(await read("divBalance", [bob.address]), 0n);
  const bobDiv0 = await read("withdrawableDividendOf", [bob.address]);
  await write(pool, "transfer", [alice.address, E(50_000)]); // новая покупка → новые дивиденды
  assert.equal(await read("withdrawableDividendOf", [bob.address]), bobDiv0); // не выросло
  // а после пополнения выше порога — участвует
  await write(alice, "transfer", [bob.address, E(2_000)]);
  assert.ok((await read("divBalance", [bob.address])) >= E(2_000));
});

test("claim выплачивает и обнуляет", async () => {
  const wd = await read("withdrawableDividendOf", [alice.address]);
  assert.ok(wd > 0n);
  const b0 = await bal(alice);
  await write(alice, "claim");
  assert.equal((await bal(alice)) - b0, wd);
  assert.equal(await read("withdrawableDividendOf", [alice.address]), 0n);
});

test("без правомочных холдеров дивиденды уходят в LP", async () => {
  const t3 = await deployToken();
  const save = token; token = t3;
  await write(deployer, "setPool", [pool.address, true]);
  // покупка НИЖЕ порога дивидендов (900 < 1000): правомочных нет,
  // дивидендная доля падает в lpReserve
  await write(pool, "transfer", [alice.address, E(900)]);
  const fee = E(900) * 500n / 10_000n;
  // 30% дивидендов + 10% lp = 40% от fee легло в lpReserve
  assert.equal(await read("lpReserve"), fee * 4000n / 10_000n);
  token = save;
});

test("flushLp отправляет в lpSink, второй раз — реверт", async () => {
  const lp = await read("lpReserve");
  assert.ok(lp > 0n);
  await write(bob, "flushLp");
  assert.equal(await bal(sink), lp);
  assert.equal(await read("lpReserve"), 0n);
  await assert.rejects(write(bob, "flushLp"));
});

test("exempt не платит налог", async () => {
  // creatorWallet exempt: перевод пул → creator без удержаний
  const c0 = await bal(creator);
  await write(pool, "transfer", [creator.address, E(1_000)]);
  assert.equal((await bal(creator)) - c0, E(1_000));
});

test("controller: чужой не отметит пул; renounce навсегда", async () => {
  await assert.rejects(write(alice, "setPool", [alice.address, true]));
  await write(deployer, "renounceController");
  await assert.rejects(write(deployer, "setPool", [bob.address, true]));
});

test("конструктор: реверт на ставке >10% и кривой аллокации", async () => {
  await assert.rejects(deployToken({ ...CFG, buyTaxBps: 1001 }));
  await assert.rejects(deployToken({ ...CFG, lpBps: 999 })); // сумма != 100%
});
