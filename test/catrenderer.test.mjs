/**
 * CatRenderer — метаданные и картинка кота прямо в блокчейне.
 *  1. без рендерера tokenURI работает по-старому (baseURI + id)
 *  2. с рендерером отдаётся data:application/json;base64 и он разбирается
 *  3. в JSON есть имя, картинка-SVG, редкость, тикер и вес выплат
 *  4. SVG валиден и содержит цвет редкости
 *  5. рендерер меняется только владельцем; ноль возвращает baseURI
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // player
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // treasury
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
const call = async (acc, addr, abiName, fn, args = [], value = 0n) => {
  const hash = await w(acc).writeContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args, value });
  return pub.waitForTransactionReceipt({ hash });
};
const read = (addr, abiName, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });

const b64json = (uri) => {
  assert.ok(uri.startsWith("data:application/json;base64,"), "не data-URI: " + uri.slice(0, 40));
  return JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
};

let cats, renderer;
const FEED = "0x00000000000000000000000000000000000000f1";

before(async () => {
  cats = await deploy(owner, "BrokerCats", [PRICE, treasury.address, "ipfs://base/"]);
  renderer = await deploy(owner, "CatRenderer", []);
  await call(owner, cats, "BrokerCats", "addRoster", ["NVDA", FEED]);
  await call(player, cats, "BrokerCats", "mint", [], PRICE); // кот #1
});

test("без рендерера — старый baseURI + id", async () => {
  assert.equal(await read(cats, "BrokerCats", "tokenURI", [1n]), "ipfs://base/1");
});

test("чужой setRenderer — реверт; владелец привязывает", async () => {
  await assert.rejects(call(player, cats, "BrokerCats", "setRenderer", [renderer]));
  await call(owner, cats, "BrokerCats", "setRenderer", [renderer]);
  assert.equal((await read(cats, "BrokerCats", "renderer")).toLowerCase(), renderer.toLowerCase());
});

test("с рендерером — валидный JSON с картинкой и атрибутами", async () => {
  const uri = await read(cats, "BrokerCats", "tokenURI", [1n]);
  const meta = b64json(uri);
  assert.equal(meta.name, "hood cat #1");
  assert.ok(meta.description.length > 20);
  assert.ok(meta.image.startsWith("data:image/svg+xml;base64,"));

  const traits = Object.fromEntries(meta.attributes.map((a) => [a.trait_type, a.value]));
  assert.equal(traits.Ticker, "NVDA");
  assert.ok(["Common", "Rare", "Epic", "Mythic", "Legendary"].includes(traits.Rarity));
  assert.ok([1, 2, 3, 5, 8].includes(traits["Payout weight"]));

  // вес в метаданных совпадает с он-чейн множителем кота
  const [, , rarity, mult] = await read(cats, "BrokerCats", "catInfo", [1n]);
  assert.equal(traits["Payout weight"], Number(mult));
  assert.equal(traits.Rarity, ["Common", "Rare", "Epic", "Mythic", "Legendary"][Number(rarity)]);
});

test("SVG корректен и покрашен в цвет редкости", async () => {
  const meta = b64json(await read(cats, "BrokerCats", "tokenURI", [1n]));
  const svg = Buffer.from(meta.image.split(",")[1], "base64").toString("utf8");
  assert.ok(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""));
  assert.ok(svg.trim().endsWith("</svg>"));
  assert.ok(svg.includes("$NVDA"), "тикер на картинке");
  const [, , rarity] = await read(cats, "BrokerCats", "catInfo", [1n]);
  const color = ["#8b93a7", "#4aa3e0", "#a06bff", "#e0559a", "#f5b544"][Number(rarity)];
  assert.ok(svg.includes(color), "цвет редкости в SVG");
  // base64 не должен ломаться на длине, не кратной трём
  assert.ok(!meta.image.includes("=="), "хвост base64 не должен быть двойным padding для этой длины");
});

test("нулевой рендерер возвращает baseURI; несуществующий кот — реверт", async () => {
  await call(owner, cats, "BrokerCats", "setRenderer", ["0x0000000000000000000000000000000000000000"]);
  assert.equal(await read(cats, "BrokerCats", "tokenURI", [1n]), "ipfs://base/1");
  await assert.rejects(read(cats, "BrokerCats", "tokenURI", [999n]));
});
