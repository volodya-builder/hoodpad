/**
 * CatMarket — эскроу-биржа котов.
 *  1. list: кот уезжает в эскроу, лот виден в listings
 *  2. чужой cancel — реверт; свой cancel возвращает кота
 *  3. buy: неверная цена — реверт; верная — кот покупателю, 2% казне, 98% продавцу
 *  4. купленный лот исчезает из списка; повторный buy — реверт
 *  5. дивиденды кота переезжают с ним: новый владелец клеймит накопленное
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner/казна-получатель fund
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // seller
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // buyer
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // treasury
];
const [owner, seller, buyer, treasury] = KEYS.map((k) => privateKeyToAccount(k));
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

let cats, vault, market, spy;
const FEED = "0x00000000000000000000000000000000000000f1";
const PRICE = E(0.5);

before(async () => {
  cats = await deploy(owner, "BrokerCats", [E(0.01), treasury.address, "ipfs://cats/"]);
  vault = await deploy(owner, "CatStockVault", [cats]);
  await call(owner, cats, "BrokerCats", "setVault", [vault]);
  await call(owner, cats, "BrokerCats", "addRoster", ["NVDA", FEED]);
  market = await deploy(owner, "CatMarket", [cats, treasury.address]);
  // кот #1 продавцу
  await call(owner, cats, "BrokerCats", "airdrop", [[seller.address]]);
  // насыпать дивидендов коту #1 (SPY-мок)
  spy = await deploy(owner, "MockStock", ["SPY RH", "SPY"]);
  await call(owner, vault, "CatStockVault", "addPayoutToken", [spy]);
  await call(owner, spy, "MockStock", "mint", [owner.address, E(1000)]);
  await call(owner, spy, "MockStock", "approve", [vault, E(100)]);
  await call(owner, vault, "CatStockVault", "fund", [spy, E(100)]);
});

test("list: кот в эскроу, лот в списке", async () => {
  await call(seller, cats, "BrokerCats", "approve", [market, 1n]);
  await call(seller, market, "CatMarket", "list", [1n, PRICE]);
  assert.equal((await read(cats, "BrokerCats", "ownerOf", [1n])).toLowerCase(), market.toLowerCase());
  assert.equal(await read(market, "CatMarket", "listedCount"), 1n);
  const [ids, sellers, prices, rarities] = await read(market, "CatMarket", "listings", [0n, 10n]);
  assert.equal(ids[0], 1n);
  assert.equal(sellers[0], seller.address);
  assert.equal(prices[0], PRICE);
  assert.ok(rarities[0] <= 4);
});

test("чужой cancel — реверт; свой возвращает кота", async () => {
  await assert.rejects(call(buyer, market, "CatMarket", "cancel", [1n]));
  await call(seller, market, "CatMarket", "cancel", [1n]);
  assert.equal(await read(cats, "BrokerCats", "ownerOf", [1n]), seller.address);
  assert.equal(await read(market, "CatMarket", "listedCount"), 0n);
  // перелистим обратно для следующих тестов
  await call(seller, cats, "BrokerCats", "approve", [market, 1n]);
  await call(seller, market, "CatMarket", "list", [1n, PRICE]);
});

test("buy: неверная цена — реверт; верная — кот, 2% казне, 98% продавцу", async () => {
  await assert.rejects(call(buyer, market, "CatMarket", "buy", [1n], PRICE - 1n));
  const t0 = await pub.getBalance({ address: treasury.address });
  const s0 = await pub.getBalance({ address: seller.address });
  await call(buyer, market, "CatMarket", "buy", [1n], PRICE);
  const fee = PRICE * 200n / 10_000n;
  assert.equal(await read(cats, "BrokerCats", "ownerOf", [1n]), buyer.address);
  assert.equal((await pub.getBalance({ address: treasury.address })) - t0, fee);
  assert.equal((await pub.getBalance({ address: seller.address })) - s0, PRICE - fee);
});

test("купленный лот исчез; повторный buy — реверт", async () => {
  assert.equal(await read(market, "CatMarket", "listedCount"), 0n);
  await assert.rejects(call(buyer, market, "CatMarket", "buy", [1n], PRICE));
});

test("дивиденды кота переехали к покупателю", async () => {
  const pending = await read(vault, "CatStockVault", "pendingOf", [1n, spy]);
  assert.ok(pending > 0n, "у кота должны быть накопленные дивиденды");
  // старый владелец клеймить не может
  await assert.rejects(call(seller, vault, "CatStockVault", "claim", [1n, seller.address]));
  const b0 = await read(spy, "MockStock", "balanceOf", [buyer.address]);
  await call(buyer, vault, "CatStockVault", "claim", [1n, buyer.address]);
  assert.equal((await read(spy, "MockStock", "balanceOf", [buyer.address])) - b0, pending);
});
