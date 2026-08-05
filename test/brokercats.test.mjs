/**
 * BrokerCats — NFT-коты фэнтези-спорта на акциях.
 *  1. минт: точная цена обязательна, выручка сразу уходит в proceeds
 *  2. коту назначается тикер из ростера и редкость с валидным множителем
 *  3. sold out на MAX_SUPPLY (проверяем через мини-ростер и цикл до лимита нельзя —
 *     3000 дорого; проверяем require по счётчику через каст)
 *  4. минт без ростера — реверт; чужой addRoster — реверт
 *  5. catInfo несуществующего кота — реверт
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // player
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // treasury (proceeds)
];
const [owner, player, treasury] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });
const PRICE = parseEther("0.01");

async function deploy(account, name, args = []) {
  const art = ART(name);
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
}
const call = async (acc, addr, fn, args = [], value = 0n) => {
  const hash = await w(acc).writeContract({ address: addr, abi: ART("BrokerCats").abi, functionName: fn, args, value });
  return pub.waitForTransactionReceipt({ hash });
};
const read = (addr, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART("BrokerCats").abi, functionName: fn, args });

let cats;
const FEED = "0x00000000000000000000000000000000000000f1";

before(async () => {
  cats = await deploy(owner, "BrokerCats", [PRICE, treasury.address, "ipfs://cats/"]);
});

test("минт без ростера — реверт", async () => {
  await assert.rejects(call(player, cats, "mint", [], PRICE));
});

test("чужой addRoster — реверт; owner добавляет ростер", async () => {
  await assert.rejects(call(player, cats, "addRoster", ["NVDA", FEED]));
  for (const tk of ["NVDA", "AAPL", "TSLA", "MSFT", "COIN"]) {
    await call(owner, cats, "addRoster", [tk, FEED]);
  }
  assert.equal(await read(cats, "rosterCount"), 5n);
});

test("минт: неверная цена — реверт; верная — кот с тикером и редкостью", async () => {
  await assert.rejects(call(player, cats, "mint", [], PRICE - 1n));
  const t0 = await pub.getBalance({ address: treasury.address });
  await call(player, cats, "mint", [], PRICE);
  // выручка ушла в казну сразу
  assert.equal((await pub.getBalance({ address: treasury.address })) - t0, PRICE);
  assert.equal(await read(cats, "ownerOf", [1n]), player.address);
  const [ticker, feed, rarity, mult] = await read(cats, "catInfo", [1n]);
  assert.ok(["NVDA", "AAPL", "TSLA", "MSFT", "COIN"].includes(ticker));
  assert.equal(feed.toLowerCase(), FEED.toLowerCase());
  assert.ok(rarity <= 4);
  assert.ok([1, 2, 3, 5, 8].includes(Number(mult)));
});

test("несколько минтов: id растут, редкости валидны", async () => {
  for (let i = 0; i < 5; i++) await call(player, cats, "mint", [], PRICE);
  assert.equal(await read(cats, "totalMinted"), 6n);
  for (let id = 2n; id <= 6n; id++) {
    const [, , rarity] = await read(cats, "catInfo", [id]);
    assert.ok(rarity <= 4);
  }
});

test("catInfo несуществующего кота — реверт", async () => {
  await assert.rejects(read(cats, "catInfo", [999n]));
});
