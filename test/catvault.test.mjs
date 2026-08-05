/**
 * CatStockVault — дивиденды холдерам котов в токенизированных акциях.
 *  1. аирдроп: owner раздаёт бесплатно, кап работает, чужому нельзя
 *  2. fund: транш делится по весам редкости (проверяем пропорции точно)
 *  3. кот, сминченный ПОСЛЕ транша, прошлый транш не получает
 *  4. claim: только владелец кота; выплата уходит получателю; повторно — ноль
 *  5. продажа кота: невыплаченные дивиденды уезжают к новому владельцу
 *  6. вторая валюта выплат: добавили токен — раздача работает и по нему
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner/казна
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // alice
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // bob
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // proceeds
];
const [owner, alice, bob, proceeds] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });
const E = (n) => parseEther(String(n));

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

let cats, vault, spy;
const FEED = "0x00000000000000000000000000000000000000f1";

// вес кота id из контракта (после регистрации)
const weightOf = (id) => read(vault, "CatStockVault", "weightOf", [id]);

before(async () => {
  cats = await deploy(owner, "BrokerCats", [E(0.01), proceeds.address, "ipfs://cats/"]);
  vault = await deploy(owner, "CatStockVault", [cats]);
  await call(owner, cats, "BrokerCats", "setVault", [vault]);
  for (const tk of ["NVDA", "AAPL", "TSLA"]) await call(owner, cats, "BrokerCats", "addRoster", [tk, FEED]);
  spy = await deploy(owner, "MockStock", ["SPDR S&P 500 RH", "SPY"]);
  await call(owner, vault, "CatStockVault", "addPayoutToken", [spy]);
  await call(owner, spy, "MockStock", "mint", [owner.address, E(1_000_000)]);
});

test("аирдроп: owner раздаёт, чужому нельзя, коты регистрируются в хранилище", async () => {
  await assert.rejects(call(alice, cats, "BrokerCats", "airdrop", [[alice.address]]));
  await call(owner, cats, "BrokerCats", "airdrop", [[alice.address, bob.address]]);
  assert.equal(await read(cats, "BrokerCats", "totalMinted"), 2n);
  assert.equal(await read(cats, "BrokerCats", "airdropped"), 2n);
  // оба кота зарегистрированы: веса ненулевые, totalWeight = сумма
  const w1 = await weightOf(1n), w2 = await weightOf(2n);
  assert.ok(w1 > 0 && w2 > 0);
  assert.equal(await read(vault, "CatStockVault", "totalWeight"), BigInt(w1) + BigInt(w2));
});

test("fund: транш делится по весам точно", async () => {
  await call(owner, spy, "MockStock", "approve", [vault, E(100)]);
  await call(owner, vault, "CatStockVault", "fund", [spy, E(100)]);
  const w1 = BigInt(await weightOf(1n)), w2 = BigInt(await weightOf(2n));
  const total = w1 + w2;
  const p1 = await read(vault, "CatStockVault", "pendingOf", [1n, spy]);
  const p2 = await read(vault, "CatStockVault", "pendingOf", [2n, spy]);
  // пропорция по весам с точностью до 1 wei пыли
  const exp1 = E(100) * w1 / total;
  const exp2 = E(100) * w2 / total;
  assert.ok(exp1 - p1 <= 1n && p1 <= exp1);
  assert.ok(exp2 - p2 <= 1n && p2 <= exp2);
});

test("кот, сминченный после транша, прошлый транш не получает", async () => {
  await call(owner, cats, "BrokerCats", "airdrop", [[bob.address]]); // кот #3
  assert.equal(await read(vault, "CatStockVault", "pendingOf", [3n, spy]), 0n);
});

test("claim: только владелец; повторный клейм — ноль", async () => {
  const p1 = await read(vault, "CatStockVault", "pendingOf", [1n, spy]);
  assert.ok(p1 > 0n);
  await assert.rejects(call(bob, vault, "CatStockVault", "claim", [1n, bob.address]));
  const b0 = await read(spy, "MockStock", "balanceOf", [alice.address]);
  await call(alice, vault, "CatStockVault", "claim", [1n, alice.address]);
  assert.equal((await read(spy, "MockStock", "balanceOf", [alice.address])) - b0, p1);
  assert.equal(await read(vault, "CatStockVault", "pendingOf", [1n, spy]), 0n);
});

test("продажа кота: невыплаченное уезжает к новому владельцу", async () => {
  // у кота #2 (bob) ещё есть невыплаченный транш
  const p2 = await read(vault, "CatStockVault", "pendingOf", [2n, spy]);
  assert.ok(p2 > 0n);
  await call(bob, cats, "BrokerCats", "transferFrom", [bob.address, alice.address, 2n]);
  // теперь клеймит alice — и получает всё, что накопил кот
  const b0 = await read(spy, "MockStock", "balanceOf", [alice.address]);
  await call(alice, vault, "CatStockVault", "claim", [2n, alice.address]);
  assert.equal((await read(spy, "MockStock", "balanceOf", [alice.address])) - b0, p2);
  // старый владелец больше не может
  await assert.rejects(call(bob, vault, "CatStockVault", "claim", [2n, bob.address]));
});

test("вторая валюта выплат работает независимо", async () => {
  const nvda = await deploy(owner, "MockStock", ["NVIDIA RH", "NVDA"]);
  await call(owner, vault, "CatStockVault", "addPayoutToken", [nvda]);
  await call(owner, nvda, "MockStock", "mint", [owner.address, E(30)]);
  await call(owner, nvda, "MockStock", "approve", [vault, E(30)]);
  await call(owner, vault, "CatStockVault", "fund", [nvda, E(30)]);
  const w1 = BigInt(await weightOf(1n));
  const total = await read(vault, "CatStockVault", "totalWeight");
  const p = await read(vault, "CatStockVault", "pendingOf", [1n, nvda]);
  const exp = E(30) * w1 / BigInt(total);
  assert.ok(exp - p <= 1n && p <= exp);
  // SPY-учёт не задет
  assert.equal(await read(vault, "CatStockVault", "pendingOf", [1n, spy]), 0n);
});
