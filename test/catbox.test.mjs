/**
 * CatBox — кейсы с котами (лимит 10k, commit-reveal рандом).
 *  1. buy: точная цена, выручка сразу в казну, бокс записан на игрока
 *  2. open в том же блоке — реверт (TooEarly); после блока — кот выдан
 *  3. чужой open — реверт; повторный open — реверт
 *  4. редкость из бокса валидна (0..4), кот зарегистрирован в дивидендах
 *  5. mintFromBox напрямую (не из бокса) — реверт
 *  6. просроченное окно: open реверт, recommit чинит
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
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // other
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // treasury
];
const [owner, player, other, treasury] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });
const E = (n) => parseEther(String(n));
const PRICE = E(0.02);

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
// продвинуть цепочку на N блоков
const mine = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await fetch("http://127.0.0.1:8545", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }),
    });
  }
};

let cats, vault, box;
const FEED = "0x00000000000000000000000000000000000000f1";

before(async () => {
  cats = await deploy(owner, "BrokerCats", [E(0.01), treasury.address, "ipfs://cats/"]);
  vault = await deploy(owner, "CatStockVault", [cats]);
  box = await deploy(owner, "CatBox", [cats, treasury.address, PRICE]);
  await call(owner, cats, "BrokerCats", "setVault", [vault]);
  await call(owner, cats, "BrokerCats", "setBox", [box]);
  for (const tk of ["NVDA", "AAPL", "TSLA"]) await call(owner, cats, "BrokerCats", "addRoster", [tk, FEED]);
});

test("buy: цена обязательна, выручка в казну, бокс у игрока", async () => {
  await assert.rejects(call(player, box, "CatBox", "buy", [], PRICE - 1n));
  const t0 = await pub.getBalance({ address: treasury.address });
  await call(player, box, "CatBox", "buy", [], PRICE);
  assert.equal((await pub.getBalance({ address: treasury.address })) - t0, PRICE);
  assert.equal(await read(box, "CatBox", "sold"), 1n);
  assert.equal(await read(box, "CatBox", "boxesLeft"), 9_999n);
  const mine_ = await read(box, "CatBox", "boxesOf", [player.address]);
  assert.equal(mine_.length, 1);
  assert.equal(mine_[0], 1n);
});

test("open слишком рано — реверт; после блока — кот выдан", async () => {
  await assert.rejects(call(player, box, "CatBox", "open", [1n])); // тот же/следующий блок
  await mine(2);
  const [ready] = await read(box, "CatBox", "openable", [1n]);
  assert.equal(ready, true);
  await call(player, box, "CatBox", "open", [1n]);
  assert.equal(await read(cats, "BrokerCats", "totalMinted"), 1n);
  assert.equal(await read(cats, "BrokerCats", "ownerOf", [1n]), player.address);
  assert.equal(await read(box, "CatBox", "opened"), 1n);
});

test("редкость валидна и кот зарегистрирован в дивидендах", async () => {
  const [, , rarity, mult] = await read(cats, "BrokerCats", "catInfo", [1n]);
  assert.ok(rarity <= 4);
  assert.ok([1, 2, 3, 5, 8].includes(Number(mult)));
  assert.ok((await read(vault, "CatStockVault", "weightOf", [1n])) > 0);
});

test("чужой open и повторный open — реверт", async () => {
  await call(player, box, "CatBox", "buy", [], PRICE); // бокс #2
  await mine(2);
  await assert.rejects(call(other, box, "CatBox", "open", [2n]));
  await call(player, box, "CatBox", "open", [2n]);
  await assert.rejects(call(player, box, "CatBox", "open", [2n]));
});

test("mintFromBox напрямую — реверт", async () => {
  await assert.rejects(call(player, cats, "BrokerCats", "mintFromBox", [player.address, 4, 123n]));
  await assert.rejects(call(owner, cats, "BrokerCats", "mintFromBox", [owner.address, 4, 123n]));
});

test("просроченное окно: open реверт, recommit чинит", async () => {
  await call(player, box, "CatBox", "buy", [], PRICE); // бокс #3
  await mine(210); // окно REVEAL_WINDOW=200 прошло
  const [ready, expired] = await read(box, "CatBox", "openable", [3n]);
  assert.equal(ready, false);
  assert.equal(expired, true);
  await assert.rejects(call(player, box, "CatBox", "open", [3n]));
  await call(player, box, "CatBox", "recommit", [3n]);
  await mine(2);
  await call(player, box, "CatBox", "open", [3n]); // теперь открывается
  assert.equal(await read(box, "CatBox", "opened"), 3n);
});
