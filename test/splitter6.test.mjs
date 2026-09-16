/**
 * FeeSplitterV6 — делёж протокольной доли на три казны (перезапуск 09.2026):
 * создатель 70% (в пуле) · арена 10% · выкуп hood 10% · команда 10%.
 *
 *  1. ETH-монета: 30% протокольной доли делится 1/3 арене, 1/3 казне
 *     выкупа, 1/3 команде — до wei, на сплиттере не оседает;
 *  2. монета за валюту (реальная фабрика): claim(pool) делит USDG так же;
 *     повторный claim — пусто; чужой пул — реверт;
 *  3. отправитель-не-пул (пожертвование) — всё команде, без реверта;
 *  4. казна, не принимающая ETH — её доля уходит команде, выплата не встаёт;
 *  5. доли в bps для сайта: 3333 / 3333 / 3333.
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
const [owner, creator, alice, team] = KEYS.map((k) => privateKeyToAccount(k));
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
const fails = (p) => p.then(() => false).catch(() => true);
const read = (addr, abiName, fn, args = []) => pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });
const ethOf = (a) => pub.getBalance({ address: a });
const ZERO = "0x0000000000000000000000000000000000000000";
const DEC = 6, U = (n) => parseUnits(String(n), DEC), E = (n) => parseEther(String(n));

let ethF, ethMig, quoteF, quoteMig, usdg, arena, buyback, splitter, tokenA, poolA, qTok, qPool;

before(async () => {
  ethMig = await deploy(owner, "MockMigrator");
  ethF = await deploy(owner, "LaunchpadFactoryV2", [owner.address, ethMig]);
  const pm = await deploy(owner, "MockPositionManager");
  quoteMig = await deploy(owner, "UniswapV3MigratorQuote", [pm]);
  quoteF = await deploy(owner, "LaunchpadFactoryQuote", [owner.address, quoteMig]);
  usdg = await deploy(owner, "MockQuote6", ["Global Dollar", "USDG", DEC]);
  // две казны одного типа: арена и выкуп hood
  arena = await deploy(owner, "ArenaTreasury", [owner.address, ethF, quoteF, ZERO]);
  buyback = await deploy(owner, "ArenaTreasury", [owner.address, ethF, quoteF, ZERO]);
  splitter = await deploy(owner, "FeeSplitterV6", [team.address, arena, buyback, ethF, quoteF, 1n, 1n, 3n]);
  await call(owner, ethF, "LaunchpadFactoryV2", "initConfig", [splitter, ethMig, ZERO, 100, 7000]);
  await call(owner, quoteF, "LaunchpadFactoryQuote", "initConfig", [splitter, quoteMig, 100, 7000]);
  await call(owner, quoteF, "LaunchpadFactoryQuote", "setQuote", [usdg, true, U(4000), U(1600)]);

  await call(creator, ethF, "LaunchpadFactoryV2", "createToken", ["Hood", "HOOD", "", creator.address]);
  tokenA = await read(ethF, "LaunchpadFactoryV2", "allTokens", [0n]);
  poolA = await read(ethF, "LaunchpadFactoryV2", "poolOf", [tokenA]);
  await call(creator, quoteF, "LaunchpadFactoryQuote", "createToken", ["Stock Coin", "STK", "data:,x", usdg, creator.address, 0]);
  qTok = await read(quoteF, "LaunchpadFactoryQuote", "allTokens", [0n]);
  qPool = await read(quoteF, "LaunchpadFactoryQuote", "poolOf", [qTok]);
  await call(owner, usdg, "MockQuote6", "mint", [alice.address, U(1_000_000)]);
});

test("доли для сайта: арена/выкуп/команда по трети", async () => {
  assert.equal(await read(splitter, "FeeSplitterV6", "arenaShareBps"), 3333n);
  assert.equal(await read(splitter, "FeeSplitterV6", "buybackShareBps"), 3333n);
  assert.equal(await read(splitter, "FeeSplitterV6", "teamShareBps"), 3333n); // остаток до 10000 — округление, деньги делятся точно
});

test("ETH-монета: 70% создателю в пуле, 30% делятся на три казны до wei", async () => {
  await call(alice, poolA, "BondingCurvePoolV2", "buy", [0n, alice.address], E(1));
  const creatorCut = await read(poolA, "BondingCurvePoolV2", "creatorFeesAccrued");
  const protocol = await read(poolA, "BondingCurvePoolV2", "protocolFeesAccrued");
  const fee = creatorCut + protocol;
  assert.equal(creatorCut, (fee * 7000n) / 10000n, "создателю в пуле 70%");
  const t0 = await ethOf(team.address), a0 = await ethOf(arena), b0 = await ethOf(buyback);
  await call(alice, poolA, "BondingCurvePoolV2", "claimProtocolFees", []);
  const third = protocol / 3n;
  assert.equal((await ethOf(arena)) - a0, third, "арене треть");
  assert.equal((await ethOf(buyback)) - b0, third, "казне выкупа треть");
  assert.equal((await ethOf(team.address)) - t0, protocol - 2n * third, "команде остаток");
  assert.equal(await ethOf(splitter), 0n, "на сплиттере не оседает");
});

test("монета за валюту: claim(pool) делит USDG на три казны; повтор — пусто; чужой пул — реверт", async () => {
  await call(alice, usdg, "MockQuote6", "approve", [qPool, U(1_000_000)]);
  await call(alice, qPool, "BondingCurvePoolQuote", "buy", [U(1000), 0n, alice.address]);
  const protocol = await read(qPool, "BondingCurvePoolQuote", "protocolFeesAccrued");
  assert.ok(protocol > 0n);
  const bal = (a) => read(usdg, "MockQuote6", "balanceOf", [a]);
  const t0 = await bal(team.address), a0 = await bal(arena), b0 = await bal(buyback);
  await call(alice, splitter, "FeeSplitterV6", "claim", [qPool]);
  const third = protocol / 3n;
  assert.equal((await bal(arena)) - a0, third);
  assert.equal((await bal(buyback)) - b0, third);
  assert.equal((await bal(team.address)) - t0, protocol - 2n * third);
  assert.equal(await bal(splitter), 0n);
  const t1 = await bal(team.address);
  await call(alice, splitter, "FeeSplitterV6", "claim", [qPool]);
  assert.equal(await bal(team.address), t1, "повторный claim ничего не даёт");
  assert.ok(await fails(call(alice, splitter, "FeeSplitterV6", "claim", [usdg])), "чужой контракт");
});

test("не пул (пожертвование) — всё команде, без реверта", async () => {
  const t0 = await ethOf(team.address);
  const hash = await w(alice).sendTransaction({ to: splitter, value: E(0.3) });
  await pub.waitForTransactionReceipt({ hash });
  assert.equal((await ethOf(team.address)) - t0, E(0.3));
});

test("казна не принимает ETH — её доля уходит команде, выплата не встаёт", async () => {
  const mf = await deploy(owner, "MockFactoryV4");
  const broken = await deploy(owner, "BrokenTreasuryV4"); // без receive → пуш не проходит
  const s2 = await deploy(owner, "FeeSplitterV6", [team.address, broken, arena, mf, ZERO, 1n, 1n, 3n]);
  const tok = "0x00000000000000000000000000000000000000A1";
  const mp = await deploy(owner, "MockEthPoolV4", [tok, creator.address]);
  await call(owner, mf, "MockFactoryV4", "set", [tok, mp]);
  const hash = await w(alice).sendTransaction({ to: mp, value: E(0.9) });
  await pub.waitForTransactionReceipt({ hash });
  const t0 = await ethOf(team.address), a0 = await ethOf(arena);
  await call(alice, mp, "MockEthPoolV4", "pay", [s2, E(0.9)]);
  assert.equal((await ethOf(arena)) - a0, E(0.3), "рабочей казне её треть");
  assert.equal((await ethOf(team.address)) - t0, E(0.6), "команде своя треть + треть сломанной казны");
});
