/**
 * FeeSplitterV4 — делёж протокольной доли: команда / агент / создатель.
 *
 * Что проверяем:
 *  1. ETH-монета без ИИ: из 30% комиссии команде 20 п.п., создателю 10 п.п.
 *     (итого создателю 80%); суммы сходятся до wei;
 *  2. ETH-монета с ИИ (enableAi): 10 п.п. уходят в казну агента, создателю
 *     ничего сверх 70%;
 *  3. enableAi: только создатель, только один раз, только наша монета;
 *  4. отправитель-не-пул (пожертвование) — всё команде, без реверта;
 *  5. сломанная казна агента — её доля уходит команде, выплата не встаёт;
 *  6. создатель-контракт, не принимающий ETH — сумма откладывается,
 *     команда получает своё, позже создатель забирает withdrawEth;
 *  7. монета за валюту (реальная фабрика): claim(pool) делит USDG 2/3 : 1/3;
 *     с ИИ — треть в казну агента (budgetErc20); повторный claim — пусто;
 *  8. старый пул с 50% создателю: сплиттер получает 50% и делит их 2/3:1/3
 *     (33% / 17%); переезд фабрики через proposeConfig + 48ч + applyConfig;
 *  9. claim для чужого контракта — реверт;
 * 10. ERC20 без return (USDT-стиль) и чёрный список: перевод создателю
 *     откладывается, withdrawErc20 отдаёт; sweep не трогает отложенное;
 * 11. AgentTreasury: spendErc20 только оператор и не больше бюджета.
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
const read = (addr, abiName, fn, args = []) =>
  pub.readContract({ address: addr, abi: ART(abiName).abi, functionName: fn, args });
const ethOf = (a) => pub.getBalance({ address: a });
const ZERO = "0x0000000000000000000000000000000000000000";
const DEC = 6, U = (n) => parseUnits(String(n), DEC), E = (n) => parseEther(String(n));
const gasOf = (rc) => rc.gasUsed * rc.effectiveGasPrice;

let ethF, ethMig, agentT, splitter, quoteF, quoteMig, usdg;
let tokenA, poolA;        // ETH-монета без ИИ
let tokenB, poolB;        // ETH-монета с ИИ
let qOld, qOldPool;       // монета за USDG, создана при 50% создателю
let qNew, qNewPool;       // монета за USDG при 70%

before(async () => {
  // --- ETH-фабрика (V2, с таймлоком, как в репозитории)
  ethMig = await deploy(owner, "MockMigrator");
  ethF = await deploy(owner, "LaunchpadFactoryV2", [owner.address, ethMig]);
  // --- фабрика за валюту
  const pm = await deploy(owner, "MockPositionManager");
  quoteMig = await deploy(owner, "UniswapV3MigratorQuote", [pm]);
  quoteF = await deploy(owner, "LaunchpadFactoryQuote", [owner.address, quoteMig]);
  usdg = await deploy(owner, "MockQuote6", ["Global Dollar", "USDG", DEC]);
  // --- казна агента + сплиттер (2/3 команде)
  agentT = await deploy(owner, "AgentTreasury", [owner.address]);
  splitter = await deploy(owner, "FeeSplitterV4", [team.address, agentT, ethF, quoteF, 2n, 3n]);
  // ETH-фабрика сразу на новой экономике: казна = сплиттер, создателю 70%
  await call(owner, ethF, "LaunchpadFactoryV2", "initConfig", [splitter, ethMig, ZERO, 100, 7000]);
  // Фабрика за валюту — сначала по-старому (50%), чтобы завести «старую» монету
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

// протокольная доля = комиссия − доля создателя; комиссию восстанавливаем из
// creatorFeesAccrued и creatorFeeShareBps пула
async function protocolAccrued(pool, abiName) {
  return read(pool, abiName, "protocolFeesAccrued");
}

test("ETH без ИИ: команде 2/3 протокольной доли, создателю 1/3 → итого 80%", async () => {
  await call(alice, poolA, "BondingCurvePoolV2", "buy", [0n, alice.address], E(1));
  const creatorCut = await read(poolA, "BondingCurvePoolV2", "creatorFeesAccrued");
  const protocol = await protocolAccrued(poolA, "BondingCurvePoolV2");
  const fee = creatorCut + protocol;
  assert.equal(creatorCut, (fee * 7000n) / 10000n, "создателю в пуле 70%");

  const t0 = await ethOf(team.address), c0 = await ethOf(creator.address);
  await call(alice, poolA, "BondingCurvePoolV2", "claimProtocolFees", []);
  const toTeam = (protocol * 2n) / 3n, toCreator = protocol - toTeam;
  assert.equal((await ethOf(team.address)) - t0, toTeam, "команде ровно 2/3");
  assert.equal((await ethOf(creator.address)) - c0, toCreator, "создателю ровно 1/3 (и без газа — платил alice)");
  // итого создателю: 70% в пуле + 10% через сплиттер = 80% комиссии
  assert.equal(creatorCut + toCreator, (fee * 8000n) / 10000n + (fee * 8000n) % 10000n / 10000n, "≈80%");
  assert.ok(Math.abs(Number(creatorCut + toCreator) - Number(fee) * 0.8) <= 2, "80% до wei");
  assert.equal(await read(agentT, "AgentTreasury", "budget", [tokenA]), 0n, "агенту ничего");
  assert.equal(await read(splitter, "FeeSplitterV4", "teamShareBps"), 6666n);
});

test("enableAi: только создатель, один раз, только наша монета", async () => {
  assert.ok(await fails(call(alice, splitter, "FeeSplitterV4", "enableAi", [tokenB])), "не создатель");
  assert.ok(await fails(call(creator, splitter, "FeeSplitterV4", "enableAi", [usdg])), "не монета фабрики");
  await call(creator, splitter, "FeeSplitterV4", "enableAi", [tokenB]);
  assert.equal(await read(splitter, "FeeSplitterV4", "aiOf", [tokenB]), true);
  assert.ok(await fails(call(creator, splitter, "FeeSplitterV4", "enableAi", [tokenB])), "второй раз нельзя");
});

test("ETH с ИИ: треть протокольной доли — в бюджет агента, создателю ничего сверх", async () => {
  await call(alice, poolB, "BondingCurvePoolV2", "buy", [0n, alice.address], E(0.5));
  const protocol = await protocolAccrued(poolB, "BondingCurvePoolV2");
  const t0 = await ethOf(team.address), c0 = await ethOf(creator.address);
  await call(alice, poolB, "BondingCurvePoolV2", "claimProtocolFees", []);
  const toTeam = (protocol * 2n) / 3n, toAgent = protocol - toTeam;
  assert.equal((await ethOf(team.address)) - t0, toTeam);
  assert.equal((await ethOf(creator.address)) - c0, 0n, "создателю через сплиттер — ничего");
  assert.equal(await read(agentT, "AgentTreasury", "budget", [tokenB]), toAgent, "бюджет агента = 1/3");
  assert.equal(await read(agentT, "AgentTreasury", "funded", [tokenB]), toAgent);
  assert.equal(await ethOf(splitter), 0n, "на сплиттере не оседает");
});

test("не пул прислал ETH — всё команде, без реверта", async () => {
  const donor = await deploy(alice, "NotAPool");
  await w(alice).sendTransaction({ to: donor, value: E(0.3) });
  const t0 = await ethOf(team.address);
  await call(alice, donor, "NotAPool", "sendTo", [splitter, E(0.3)]);
  assert.equal((await ethOf(team.address)) - t0, E(0.3));
});

test("сломанная казна агента: её доля уходит команде, выплата не встаёт", async () => {
  const mf = await deploy(owner, "MockFactoryV4");
  const broken = await deploy(owner, "BrokenTreasuryV4");
  const s2 = await deploy(owner, "FeeSplitterV4", [team.address, broken, mf, ZERO, 2n, 3n]);
  const tok = "0x00000000000000000000000000000000000000A1";
  const mp = await deploy(owner, "MockEthPoolV4", [tok, creator.address]);
  await call(owner, mf, "MockFactoryV4", "set", [tok, mp]);
  await w(alice).sendTransaction({ to: mp, value: E(0.9) });
  // включаем ИИ — теперь треть должна была бы уйти в (сломанную) казну
  await call(creator, s2, "FeeSplitterV4", "enableAi", [tok]);
  const t0 = await ethOf(team.address);
  await call(alice, mp, "MockEthPoolV4", "pay", [s2, E(0.9)]);
  assert.equal((await ethOf(team.address)) - t0, E(0.9), "всё команде");
});

test("создатель-контракт не принимает ETH: откладываем, потом withdrawEth", async () => {
  const mf = await deploy(owner, "MockFactoryV4");
  const s3 = await deploy(owner, "FeeSplitterV4", [team.address, agentT, mf, ZERO, 2n, 3n]);
  const cc = await deploy(owner, "MockCreatorV4");
  const tok = "0x00000000000000000000000000000000000000A2";
  const mp = await deploy(owner, "MockEthPoolV4", [tok, cc]);
  await call(owner, mf, "MockFactoryV4", "set", [tok, mp]);
  await w(alice).sendTransaction({ to: mp, value: E(0.6) });
  const t0 = await ethOf(team.address);
  await call(alice, mp, "MockEthPoolV4", "pay", [s3, E(0.6)]);
  assert.equal((await ethOf(team.address)) - t0, E(0.4), "команде 2/3 как обычно");
  assert.equal(await read(s3, "FeeSplitterV4", "pendingEth", [cc]), E(0.2), "создателю отложено 1/3");
  assert.equal(await ethOf(s3), E(0.2));
  assert.ok(await fails(call(alice, cc, "MockCreatorV4", "pullEth", [s3])), "пока не принимает — не забрать");
  await call(alice, cc, "MockCreatorV4", "setAccept", [true]);
  await call(alice, cc, "MockCreatorV4", "pullEth", [s3]);
  assert.equal(await ethOf(cc), E(0.2));
  assert.equal(await read(s3, "FeeSplitterV4", "pendingEth", [cc]), 0n);
  assert.ok(await fails(call(alice, cc, "MockCreatorV4", "pullEth", [s3])), "второй раз — нечего");
});

test("старый пул за валюту (50% создателю) + переезд фабрики через таймлок", async () => {
  // торгуем старой монетой, пока казна фабрики — просто кошелёк владельца
  await call(alice, usdg, "MockQuote6", "approve", [qOldPool, U(100_000)]);
  await call(alice, qOldPool, "BondingCurvePoolQuote", "buy", [U(1000), 0n, alice.address]);
  // заявка → рано → 48ч → применили
  await call(owner, quoteF, "LaunchpadFactoryQuote", "proposeConfig", [splitter, quoteMig, 100, 7000]);
  assert.ok(await fails(call(owner, quoteF, "LaunchpadFactoryQuote", "applyConfig", [])), "таймлок держит");
  await pub.request({ method: "evm_increaseTime", params: [48 * 3600 + 5] });
  await pub.request({ method: "evm_mine", params: [] });
  await call(owner, quoteF, "LaunchpadFactoryQuote", "applyConfig", []);
  assert.equal((await read(quoteF, "LaunchpadFactoryQuote", "treasury")).toLowerCase(), splitter.toLowerCase());
  assert.equal(await read(quoteF, "LaunchpadFactoryQuote", "creatorFeeShareBps"), 7000);
  assert.equal(await read(qOldPool, "BondingCurvePoolQuote", "creatorFeeShareBps"), 5000, "старый пул остался с 50%");

  const protocol = await read(qOldPool, "BondingCurvePoolQuote", "protocolFeesAccrued");
  const creatorCut = await read(qOldPool, "BondingCurvePoolQuote", "creatorFeesAccrued");
  assert.equal(protocol, creatorCut, "50/50 в старом пуле");
  const bal = (a) => read(usdg, "MockQuote6", "balanceOf", [a]);
  const t0 = await bal(team.address), c0 = await bal(creator.address);
  await call(alice, splitter, "FeeSplitterV4", "claim", [qOldPool]);
  const toTeam = (protocol * 2n) / 3n;
  assert.equal((await bal(team.address)) - t0, toTeam, "команде 2/3 от 50% = 33%");
  assert.equal((await bal(creator.address)) - c0, protocol - toTeam, "создателю 1/3 от 50% = 17%");
  assert.equal(await bal(splitter), 0n);
  // повторный claim — нечего делить, не падает
  await call(alice, splitter, "FeeSplitterV4", "claim", [qOldPool]);
  assert.equal((await bal(team.address)) - t0, toTeam);
});

test("новая монета за валюту с ИИ: треть протокольной доли — в казну агента в USDG", async () => {
  await call(creator, quoteF, "LaunchpadFactoryQuote", "createToken", ["New Coin", "NEW", "data:,x", usdg, creator.address, 100]);
  qNew = await read(quoteF, "LaunchpadFactoryQuote", "allTokens", [1n]);
  qNewPool = await read(quoteF, "LaunchpadFactoryQuote", "poolOf", [qNew]);
  assert.equal(await read(qNewPool, "BondingCurvePoolQuote", "creatorFeeShareBps"), 7000);
  await call(creator, splitter, "FeeSplitterV4", "enableAi", [qNew]);

  await call(alice, usdg, "MockQuote6", "approve", [qNewPool, U(100_000)]);
  await call(alice, qNewPool, "BondingCurvePoolQuote", "buy", [U(2000), 0n, alice.address]);
  const protocol = await read(qNewPool, "BondingCurvePoolQuote", "protocolFeesAccrued");
  const creatorCut = await read(qNewPool, "BondingCurvePoolQuote", "creatorFeesAccrued");
  assert.equal(creatorCut, ((creatorCut + protocol) * 7000n) / 10000n);
  const bal = (a) => read(usdg, "MockQuote6", "balanceOf", [a]);
  const t0 = await bal(team.address), c0 = await bal(creator.address);
  await call(alice, splitter, "FeeSplitterV4", "claim", [qNewPool]);
  const toTeam = (protocol * 2n) / 3n, toAgent = protocol - toTeam;
  assert.equal((await bal(team.address)) - t0, toTeam);
  assert.equal((await bal(creator.address)) - c0, 0n);
  assert.equal(await read(agentT, "AgentTreasury", "budgetErc20", [qNew, usdg]), toAgent, "бюджет агента в USDG");
  assert.equal(await bal(agentT), toAgent);
  assert.equal(await read(usdg, "MockQuote6", "allowance", [splitter, agentT]), 0n, "разрешение обнулено");
});

test("claim чужого контракта — реверт", async () => {
  const fake = await deploy(alice, "MockQuotePoolV4", [qNew, alice.address, usdg, splitter]);
  assert.ok(await fails(call(alice, splitter, "FeeSplitterV4", "claim", [fake])), "poolOf не совпадает");
  assert.ok(await fails(call(alice, splitter, "FeeSplitterV4", "claim", [usdg])), "вообще не пул");
});

test("ERC20 без return и чёрный список: откладываем, withdrawErc20, sweep не трогает отложенное", async () => {
  const mf = await deploy(owner, "MockFactoryV4");
  const s4 = await deploy(owner, "FeeSplitterV4", [team.address, agentT, ZERO, mf, 2n, 3n]);
  const nrt = await deploy(owner, "NoReturnToken");
  const cc = await deploy(owner, "MockCreatorV4");
  const tok = "0x00000000000000000000000000000000000000A3";
  const mp = await deploy(owner, "MockQuotePoolV4", [tok, cc, nrt, s4]);
  await call(owner, mf, "MockFactoryV4", "set", [tok, mp]);
  await call(owner, nrt, "NoReturnToken", "mint", [mp, E(30)]);
  await call(owner, nrt, "NoReturnToken", "block_", [cc, true]);
  const bal = (a) => read(nrt, "NoReturnToken", "balanceOf", [a]);
  await call(alice, s4, "FeeSplitterV4", "claim", [mp]);
  assert.equal(await bal(team.address), E(20), "команде 2/3 дошло (без return — не помеха)");
  assert.equal(await read(s4, "FeeSplitterV4", "pendingErc20", [cc, nrt]), E(10), "создателю отложено");
  assert.equal(await read(s4, "FeeSplitterV4", "totalPendingErc20", [nrt]), E(10));
  // случайно попавшая на сплиттер валюта — команде, отложенное не трогаем
  await call(owner, nrt, "NoReturnToken", "mint", [s4, E(7)]);
  await call(alice, s4, "FeeSplitterV4", "sweep", [nrt]);
  assert.equal(await bal(team.address), E(27));
  assert.equal(await bal(s4), E(10), "отложенные 10 остались");
  assert.ok(await fails(call(alice, s4, "FeeSplitterV4", "sweep", [nrt])), "больше нечего");
  // создателя разблокировали — забирает сам
  await call(owner, nrt, "NoReturnToken", "block_", [cc, false]);
  await call(alice, cc, "MockCreatorV4", "pullErc20", [s4, nrt]);
  assert.equal(await bal(cc), E(10));
  assert.equal(await read(s4, "FeeSplitterV4", "totalPendingErc20", [nrt]), 0n);
});

test("AgentTreasury: spendErc20 — только оператор и не больше бюджета", async () => {
  const b = await read(agentT, "AgentTreasury", "budgetErc20", [qNew, usdg]);
  assert.ok(b > 0n);
  assert.ok(await fails(call(alice, agentT, "AgentTreasury", "spendErc20", [qNew, usdg, 1n, "x"])), "не оператор");
  assert.ok(await fails(call(owner, agentT, "AgentTreasury", "spendErc20", [qNew, usdg, b + 1n, "x"])), "сверх бюджета");
  const o0 = await read(usdg, "MockQuote6", "balanceOf", [owner.address]);
  await call(owner, agentT, "AgentTreasury", "spendErc20", [qNew, usdg, b, "claude 1k tokens"]);
  assert.equal((await read(usdg, "MockQuote6", "balanceOf", [owner.address])) - o0, b);
  assert.equal(await read(agentT, "AgentTreasury", "budgetErc20", [qNew, usdg]), 0n);
  assert.equal(await read(agentT, "AgentTreasury", "spentErc20", [qNew, usdg]), b);
  // ETH-бюджет тоже тратится
  const eb = await read(agentT, "AgentTreasury", "budget", [tokenB]);
  await call(owner, agentT, "AgentTreasury", "spend", [tokenB, eb, "eth spend"]);
  assert.equal(await read(agentT, "AgentTreasury", "budget", [tokenB]), 0n);
});
