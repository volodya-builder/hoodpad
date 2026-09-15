/**
 * Экономика 70/20/10: FeeSplitterV5 + ArenaTreasury.
 *
 * Что проверяем:
 *  1. ETH-монета без ИИ при 60% создателю в пуле: из 40% входящего половина
 *     в казну арены, четверть команде, четверть создателю → создателю итого
 *     70%, арене 20%, команде 10% (до wei);
 *  2. ETH-монета с ИИ: четверть — в бюджет агента, создателю сверх 60% ничего;
 *  3. монета за валюту (реальная фабрика, USDG): claim делит валюту так же —
 *     половина арене, четверть команде, четверть создателю; с ИИ — агенту;
 *  4. старый пул (50% создателю): сплиттер получает 50% и делит в той же
 *     пропорции (арене 25%, команде 12.5%, создателю 12.5%);
 *  5. не пул прислал ETH — всё команде; казна арены не приняла ETH — доля
 *     команде, выплата не встаёт;
 *  6. казна арены: выкуп ETH-монеты (buybackEth) — монеты сожжены, ETH ушёл в
 *     пул; выкуп валютной монеты через зап (buybackViaZap) и из валюты казны
 *     (buybackQuote); всё купленное на 0x…dEaD; счётчики burnedOf/totalEthSpent;
 *  7. только владелец казны; вывода нет (интерфейс не содержит withdraw);
 *     проскальзывание (minTokensOut) — реверт, деньги на месте;
 *  8. переезд фабрики за валюту на V5 через proposeConfig + 48ч + applyConfig.
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
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
];
const [owner, creator, alice, team, treasurer] = KEYS.map((k) => privateKeyToAccount(k));
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
const sim = (acc, addr, abiName, fn, args = [], value = 0n) =>
  pub.simulateContract({ account: acc, address: addr, abi: ART(abiName).abi, functionName: fn, args, value }).then((r) => r.result);
const fails = (p) => p.then(() => false).catch(() => true);
const read = (addr, abiName, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });
const ethOf = (a) => pub.getBalance({ address: a });
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const DEC = 6, U = (n) => parseUnits(String(n), DEC), E = (n) => parseEther(String(n));
const FAR = 4_000_000_000n;

let ethF, ethMig, agentT, splitter, prevSplitter, arena, quoteF, quoteMig, usdg, weth, v3f, zap;
let tokenA, poolA;   // ETH-монета без ИИ (60% создателю)
let tokenB, poolB;   // ETH-монета с ИИ
let qOld, qOldPool;  // монета за USDG, создана при 50% создателю
let qNew, qNewPool;  // монета за USDG при 60%

before(async () => {
  ethMig = await deploy(owner, "MockMigrator");
  ethF = await deploy(owner, "LaunchpadFactoryV2", [owner.address, ethMig]);
  const pm = await deploy(owner, "MockPositionManager");
  quoteMig = await deploy(owner, "UniswapV3MigratorQuote", [pm]);
  quoteF = await deploy(owner, "LaunchpadFactoryQuote", [owner.address, quoteMig]);
  usdg = await deploy(owner, "MockQuote6", ["Global Dollar", "USDG", DEC]);
  // Uniswap-мок и зап: ETH ↔ USDG по 2500
  weth = await deploy(owner, "MockWETH");
  v3f = await deploy(owner, "MockV3Factory");
  const wIs0 = weth.toLowerCase() < usdg.toLowerCase();
  const [numWU, denWU] = wIs0 ? [2500n * 10n ** 6n, 10n ** 18n] : [10n ** 18n, 2500n * 10n ** 6n];
  const poolWU = await deploy(owner, "MockV3SwapPool", [weth, usdg, numWU, denWU]);
  await call(owner, v3f, "MockV3Factory", "setPool", [weth, usdg, 500, poolWU]);
  await call(owner, usdg, "MockQuote6", "mint", [poolWU, U(10_000_000)]);
  await call(owner, weth, "MockWETH", "deposit", [], E(50));
  await call(owner, weth, "MockWETH", "transfer", [poolWU, E(50)]);
  zap = await deploy(owner, "CurveZap", [weth, v3f, quoteF]);
  await call(owner, zap, "CurveZap", "setRoute", [usdg, ZERO, 500, 0, true]);

  // казна агента, казна арены (владелец — казначей), сплиттер: арене 2/4, команде 1/4
  agentT = await deploy(owner, "AgentTreasury", [owner.address]);
  arena = await deploy(owner, "ArenaTreasury", [treasurer.address, ethF, quoteF, zap]);
  // прежний сплиттер V4: у него включённый ИИ должен действовать и в V5
  prevSplitter = await deploy(owner, "FeeSplitterV4", [team.address, agentT, ethF, quoteF, 2n, 3n]);
  splitter = await deploy(owner, "FeeSplitterV5", [team.address, arena, agentT, ethF, quoteF, prevSplitter, 2n, 1n, 4n]);
  await call(owner, ethF, "LaunchpadFactoryV2", "initConfig", [splitter, ethMig, ZERO, 100, 6000]);
  // фабрика за валюту — сначала по-старому (50%), чтобы завести «старую» монету
  await call(owner, quoteF, "LaunchpadFactoryQuote", "initConfig", [owner.address, quoteMig, 100, 5000]);
  await call(owner, quoteF, "LaunchpadFactoryQuote", "setQuote", [usdg, true, U(4000), U(1600)]);

  await call(creator, ethF, "LaunchpadFactoryV2", "createToken", ["Plain", "PLN", "", creator.address]);
  tokenA = await read(ethF, "LaunchpadFactoryV2", "allTokens", [0n]);
  poolA = await read(ethF, "LaunchpadFactoryV2", "poolOf", [tokenA]);
  await call(creator, ethF, "LaunchpadFactoryV2", "createToken", ["Smart", "SMRT", "", creator.address]);
  tokenB = await read(ethF, "LaunchpadFactoryV2", "allTokens", [1n]);
  poolB = await read(ethF, "LaunchpadFactoryV2", "poolOf", [tokenB]);
  await call(creator, quoteF, "LaunchpadFactoryQuote", "createToken", ["Old Coin", "OLD", "data:,x", usdg, creator.address, 0]);
  qOld = await read(quoteF, "LaunchpadFactoryQuote", "allTokens", [0n]);
  qOldPool = await read(quoteF, "LaunchpadFactoryQuote", "poolOf", [qOld]);
  await call(owner, usdg, "MockQuote6", "mint", [alice.address, U(1_000_000)]);
});

const protocolAccrued = (pool, abi) => read(pool, abi, "protocolFeesAccrued");
const tb = (t, a) => read(t, "LaunchToken", "balanceOf", [a]);
const qb = (t, a) => read(t, "DividendToken", "balanceOf", [a]);
const ub = (a) => read(usdg, "MockQuote6", "balanceOf", [a]);

test("ETH без ИИ: создателю 70%, арене 20%, команде 10% — до wei", async () => {
  await call(alice, poolA, "BondingCurvePoolV2", "buy", [0n, alice.address], E(1));
  const creatorCut = await read(poolA, "BondingCurvePoolV2", "creatorFeesAccrued");
  const protocol = await protocolAccrued(poolA, "BondingCurvePoolV2");
  const fee = creatorCut + protocol;
  assert.equal(creatorCut, (fee * 6000n) / 10000n, "создателю в пуле 60%");

  const t0 = await ethOf(team.address), c0 = await ethOf(creator.address), a0 = await ethOf(arena);
  await call(alice, poolA, "BondingCurvePoolV2", "claimProtocolFees", []);
  const toArena = (protocol * 2n) / 4n, toTeam = protocol / 4n, toCreator = protocol - toArena - toTeam;
  assert.equal((await ethOf(arena)) - a0, toArena, "арене ровно половину входящего");
  assert.equal((await ethOf(team.address)) - t0, toTeam, "команде четверть");
  assert.equal((await ethOf(creator.address)) - c0, toCreator, "создателю четверть");
  assert.ok(Math.abs(Number(creatorCut + toCreator) - Number(fee) * 0.7) <= 2, "создателю 70% до wei");
  assert.ok(Math.abs(Number(toArena) - Number(fee) * 0.2) <= 2, "арене 20%");
  assert.ok(Math.abs(Number(toTeam) - Number(fee) * 0.1) <= 2, "команде 10%");
  assert.equal(await read(splitter, "FeeSplitterV5", "arenaShareBps"), 5000n);
  assert.equal(await read(splitter, "FeeSplitterV5", "teamShareBps"), 2500n);
  assert.equal(await ethOf(splitter), 0n, "на сплиттере не оседает");
});

test("ETH с ИИ: четверть входящего — в бюджет агента, создателю сверх 60% ничего", async () => {
  // ИИ включён ещё на V4 — V5 видит это, второй раз включать нельзя
  await call(creator, prevSplitter, "FeeSplitterV4", "enableAi", [tokenB]);
  assert.equal(await read(splitter, "FeeSplitterV5", "aiOf", [tokenB]), true, "V5 видит включение на V4");
  assert.ok(await fails(call(creator, splitter, "FeeSplitterV5", "enableAi", [tokenB])), "уже включено");
  await call(alice, poolB, "BondingCurvePoolV2", "buy", [0n, alice.address], E(0.5));
  const protocol = await protocolAccrued(poolB, "BondingCurvePoolV2");
  const t0 = await ethOf(team.address), c0 = await ethOf(creator.address), a0 = await ethOf(arena);
  await call(alice, poolB, "BondingCurvePoolV2", "claimProtocolFees", []);
  const toArena = protocol / 2n, toTeam = protocol / 4n, toAgent = protocol - toArena - toTeam;
  assert.equal((await ethOf(arena)) - a0, toArena);
  assert.equal((await ethOf(team.address)) - t0, toTeam);
  assert.equal((await ethOf(creator.address)) - c0, 0n, "создателю через сплиттер — ничего");
  assert.equal(await read(agentT, "AgentTreasury", "budget", [tokenB]), toAgent, "бюджет агента = четверть");
});

test("не пул прислал ETH — всё команде; казна арены не приняла — её доля команде", async () => {
  const donor = await deploy(alice, "NotAPool");
  await w(alice).sendTransaction({ to: donor, value: E(0.3) });
  const t0 = await ethOf(team.address);
  await call(alice, donor, "NotAPool", "sendTo", [splitter, E(0.3)]);
  assert.equal((await ethOf(team.address)) - t0, E(0.3));

  // сплиттер с «казной арены», которая не принимает ETH (контракт без receive):
  // её половина уходит команде, создатель получает свою четверть, реверта нет
  const bad = await deploy(owner, "NoReturnToken");
  const f2 = await deploy(owner, "LaunchpadFactoryV2", [owner.address, ethMig]);
  const s2 = await deploy(owner, "FeeSplitterV5", [team.address, bad, agentT, f2, quoteF, ZERO, 2n, 1n, 4n]);
  await call(owner, f2, "LaunchpadFactoryV2", "initConfig", [s2, ethMig, ZERO, 100, 6000]);
  await call(creator, f2, "LaunchpadFactoryV2", "createToken", ["X", "X", "", creator.address]);
  const tx = await read(f2, "LaunchpadFactoryV2", "allTokens", [0n]);
  const px = await read(f2, "LaunchpadFactoryV2", "poolOf", [tx]);
  await call(alice, px, "BondingCurvePoolV2", "buy", [0n, alice.address], E(0.2));
  const protocol = await protocolAccrued(px, "BondingCurvePoolV2");
  const t1 = await ethOf(team.address), c1 = await ethOf(creator.address);
  await call(alice, px, "BondingCurvePoolV2", "claimProtocolFees", []);
  const toCreator = protocol - protocol / 2n - protocol / 4n;
  assert.equal((await ethOf(team.address)) - t1, protocol - toCreator, "команде — своя четверть и половина арены");
  assert.equal((await ethOf(creator.address)) - c1, toCreator, "создателю — четверть");
  assert.equal(await ethOf(bad), 0n, "у «казны» ничего");
});

test("монета за валюту (старый пул 50%): claim делит USDG — половина арене, по четверти команде и создателю", async () => {
  await call(alice, usdg, "MockQuote6", "approve", [qOldPool, U(100_000)]);
  await call(alice, qOldPool, "BondingCurvePoolQuote", "buy", [U(1000), 0n, alice.address]);
  // переезд фабрики за валюту на сплиттер V5 (60% создателю новым монетам)
  await call(owner, quoteF, "LaunchpadFactoryQuote", "proposeConfig", [splitter, quoteMig, 100, 6000]);
  assert.ok(await fails(call(owner, quoteF, "LaunchpadFactoryQuote", "applyConfig", [])), "таймлок держит");
  await pub.request({ method: "evm_increaseTime", params: [48 * 3600 + 5] });
  await pub.request({ method: "evm_mine", params: [] });
  await call(owner, quoteF, "LaunchpadFactoryQuote", "applyConfig", []);
  assert.equal((await read(quoteF, "LaunchpadFactoryQuote", "treasury")).toLowerCase(), splitter.toLowerCase());

  const protocol = await protocolAccrued(qOldPool, "BondingCurvePoolQuote");
  assert.ok(protocol > 0n);
  const a0 = await ub(arena), t0 = await ub(team.address), c0 = await ub(creator.address);
  await call(alice, splitter, "FeeSplitterV5", "claim", [qOldPool]);
  const toArena = protocol / 2n, toTeam = protocol / 4n, toCreator = protocol - toArena - toTeam;
  assert.equal((await ub(arena)) - a0, toArena, "арене половина");
  assert.equal((await ub(team.address)) - t0, toTeam, "команде четверть");
  assert.equal((await ub(creator.address)) - c0, toCreator, "создателю четверть");
  assert.equal(await ub(splitter), 0n, "на сплиттере не оседает");
  await call(alice, splitter, "FeeSplitterV5", "claim", [qOldPool]); // повторный — пусто, без реверта
});

test("монета за валюту с ИИ (новый пул 60%): четверть входящего — агенту в валюте", async () => {
  await call(creator, quoteF, "LaunchpadFactoryQuote", "createToken", ["New Coin", "NEW", "data:,x", usdg, creator.address, 0]);
  qNew = await read(quoteF, "LaunchpadFactoryQuote", "allTokens", [1n]);
  qNewPool = await read(quoteF, "LaunchpadFactoryQuote", "poolOf", [qNew]);
  assert.equal(await read(qNewPool, "BondingCurvePoolQuote", "creatorFeeShareBps"), 6000);
  await call(creator, splitter, "FeeSplitterV5", "enableAi", [qNew]);
  await call(alice, usdg, "MockQuote6", "approve", [qNewPool, U(100_000)]);
  await call(alice, qNewPool, "BondingCurvePoolQuote", "buy", [U(2000), 0n, alice.address]);
  const protocol = await protocolAccrued(qNewPool, "BondingCurvePoolQuote");
  const a0 = await ub(arena), c0 = await ub(creator.address);
  await call(alice, splitter, "FeeSplitterV5", "claim", [qNewPool]);
  assert.equal((await ub(arena)) - a0, protocol / 2n);
  assert.equal((await ub(creator.address)) - c0, 0n);
  assert.equal(await read(agentT, "AgentTreasury", "budgetErc20", [qNew, usdg]), protocol - protocol / 2n - protocol / 4n);
});

test("казна арены: выкуп ETH-монеты — монеты сожжены, ETH ушёл в кривую", async () => {
  await w(owner).sendTransaction({ to: arena, value: E(1) }); // как будто накопилось
  const bal0 = await ethOf(arena);
  const expect = await sim(treasurer, arena, "ArenaTreasury", "buybackEth", [tokenA, E(0.1), 0n, "подиум 1 место"]);
  assert.ok(expect > 0n);
  const dead0 = await tb(tokenA, DEAD);
  await call(treasurer, arena, "ArenaTreasury", "buybackEth", [tokenA, E(0.1), expect, "подиум 1 место"]);
  assert.equal((await tb(tokenA, DEAD)) - dead0, expect, "всё купленное — на 0x…dEaD");
  assert.equal(await tb(tokenA, arena), 0n, "у казны монет не остаётся");
  assert.equal(bal0 - (await ethOf(arena)), E(0.1), "ETH ушёл ровно на выкуп");
  assert.equal(await read(arena, "ArenaTreasury", "burnedOf", [tokenA]), expect);
  assert.equal(await read(arena, "ArenaTreasury", "totalEthSpent"), E(0.1));
});

test("казна арены: выкуп валютной монеты через зап и из валюты казны", async () => {
  const dead0 = await qb(qNew, DEAD);
  const expect = await sim(treasurer, arena, "ArenaTreasury", "buybackViaZap", [qNew, E(0.05), 0n, FAR, "2 место"]);
  assert.ok(expect > 0n);
  await call(treasurer, arena, "ArenaTreasury", "buybackViaZap", [qNew, E(0.05), expect, FAR, "2 место"]);
  assert.equal((await qb(qNew, DEAD)) - dead0, expect, "куплено через зап и сожжено");
  assert.equal(await qb(qNew, arena), 0n);

  const have = await ub(arena);
  assert.ok(have > 0n, "в казне есть USDG от сплиттера");
  const dead1 = await qb(qOld, DEAD);
  const expect2 = await sim(treasurer, arena, "ArenaTreasury", "buybackQuote", [qOld, have, 0n, "3 место"]);
  await call(treasurer, arena, "ArenaTreasury", "buybackQuote", [qOld, have, expect2, "3 место"]);
  assert.equal((await qb(qOld, DEAD)) - dead1, expect2, "куплено за USDG казны и сожжено");
  assert.equal(await ub(arena), 0n, "USDG потрачены");
});

test("казна арены: только владелец, проскальзывание, лишнего не потратить, вывода нет", async () => {
  assert.ok(await fails(call(alice, arena, "ArenaTreasury", "buybackEth", [tokenA, E(0.01), 0n, ""])), "не владелец");
  const b0 = await ethOf(arena);
  assert.ok(await fails(call(treasurer, arena, "ArenaTreasury", "buybackEth", [tokenA, E(0.01), 10n ** 30n, ""])), "minTokensOut слишком велик");
  assert.equal(await ethOf(arena), b0, "деньги на месте");
  assert.ok(await fails(call(treasurer, arena, "ArenaTreasury", "buybackEth", [tokenA, b0 + 1n, 0n, ""])), "больше баланса");
  assert.ok(await fails(call(treasurer, arena, "ArenaTreasury", "buybackEth", [usdg, E(0.01), 0n, ""])), "не наша монета");
  const abi = ART("ArenaTreasury").abi.filter((x) => x.type === "function").map((x) => x.name);
  assert.ok(!abi.some((n) => /withdraw|rescue|sweep/i.test(n)), "функций вывода нет: " + abi.join(","));
});
