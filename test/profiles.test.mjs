/**
 * ProfileRegistry — профили кошельков (имя, аватар, соцсети) в блокчейне.
 *  1. setProfile пишет только за msg.sender; profileOf/profilesOf читают;
 *  2. лимиты: длинное имя, большой аватар, аватар не картинка — реверт;
 *  3. https-ссылка на аватар — можно; пустые поля снимают; clearProfile стирает.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
];
const [alice, bob] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });
const call = async (acc, addr, fn, args = []) => {
  const hash = await w(acc).writeContract({ address: addr, abi: ART("ProfileRegistry").abi, functionName: fn, args });
  return pub.waitForTransactionReceipt({ hash });
};
const read = (addr, fn, args = []) => pub.readContract({ address: addr, abi: ART("ProfileRegistry").abi, functionName: fn, args });
const fails = (p) => p.then(() => false).catch(() => true);

let reg;
before(async () => {
  const art = ART("ProfileRegistry");
  const hash = await w(alice).deployContract({ abi: art.abi, bytecode: art.bytecode, args: [] });
  reg = (await pub.waitForTransactionReceipt({ hash })).contractAddress;
});

const PNG = "data:image/png;base64," + "A".repeat(2000);

test("профиль пишется за себя и читается", async () => {
  await call(alice, reg, "setProfile", ["Володя", PNG, "@hoodandarrow", "hood_chat", "https://hoodandarrow.com"]);
  const p = await read(reg, "profileOf", [alice.address]);
  assert.equal(p.name, "Володя"); assert.equal(p.avatar, PNG); assert.equal(p.x, "@hoodandarrow");
  assert.equal(p.telegram, "hood_chat"); assert.equal(p.website, "https://hoodandarrow.com"); assert.ok(p.updatedAt > 0n);
  const both = await read(reg, "profilesOf", [[alice.address, bob.address]]);
  assert.equal(both[0].name, "Володя"); assert.equal(both[1].updatedAt, 0n, "у боба профиля нет");
});

test("лимиты и защита от мусора", async () => {
  assert.ok(await fails(call(bob, reg, "setProfile", ["x".repeat(200), "", "", "", ""])), "имя длиннее 32×4 байт");
  assert.ok(await fails(call(bob, reg, "setProfile", ["b", "data:image/png;base64," + "A".repeat(70 * 1024), "", "", ""])), "аватар > 64 КБ");
  assert.ok(await fails(call(bob, reg, "setProfile", ["b", "javascript:alert(1)", "", "", ""])), "аватар не картинка");
  assert.ok(await fails(call(bob, reg, "setProfile", ["b", "", "x".repeat(121), "", ""])), "ник длиннее 120");
  await call(bob, reg, "setProfile", ["bob", "https://example.com/a.png", "", "", ""]);
  assert.equal((await read(reg, "profileOf", [bob.address])).avatar, "https://example.com/a.png");
});

test("пустые поля снимают, clearProfile стирает", async () => {
  await call(alice, reg, "setProfile", ["Володя", "", "", "", ""]);
  const p = await read(reg, "profileOf", [alice.address]);
  assert.equal(p.avatar, ""); assert.equal(p.x, "");
  await call(alice, reg, "clearProfile", []);
  assert.equal((await read(reg, "profileOf", [alice.address])).updatedAt, 0n);
});
