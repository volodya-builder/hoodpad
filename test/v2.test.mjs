/** hood v2 e2e: голос за шкуру — power, vote, buybackAndReward, claim, burn. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createPublicClient, createWalletClient, http, parseEther, decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ART = (n) => JSON.parse(fs.readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url), "utf8"));
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];
const [deployer, creator, t1, t2] = KEYS.map((k) => privateKeyToAccount(k));
const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const w = (a) => createWalletClient({ account: a, chain: hardhat, transport });

async function deploy(account, name, args = []) {
  const art = ART(name);
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return { address: rc.contractAddress, abi: art.abi };
}
const read = (c, functionName, args = []) => pub.readContract({ address: c.address, abi: c.abi, functionName, args });
async function write(account, c, functionName, args = [], value) {
  const hash = await w(account).writeContract({ address: c.address, abi: c.abi, functionName, args, value });
  return pub.waitForTransactionReceipt({ hash });
}
const rpc = (method, params = []) => pub.request({ method, params });

const DEAD = "0x000000000000000000000000000000000000dEaD";
let factory, treasury, votePower, migrator, token, pool;

before(async () => {
  migrator = await deploy(deployer, "MockMigrator");
  factory = await deploy(deployer, "LaunchpadFactoryV2", [deployer.address, migrator.address]);
  treasury = await deploy(deployer, "BuybackTreasuryV2", [factory.address]);
  votePower = await deploy(deployer, "VotePower", [factory.address, treasury.address, parseEther("0.002")]);
  await write(deployer, treasury, "setVotePower", [votePower.address]);
  // протокольные комиссии в тесте идут напрямую в казну (без сплиттера)
  await write(deployer, factory, "setConfig",
    [treasury.address, migrator.address, votePower.address, 100, 4000]);

  const rc = await write(creator, factory, "createToken", ["pow", "POW", "uri", creator.address]);
  for (const log of rc.logs) {
    try {
      const ev = decodeEventLog({ abi: factory.abi, data: log.data, topics: log.topics });
      if (ev.eventName === "TokenCreated") {
        token = { address: ev.args.token, abi: ART("LaunchToken").abi };
        pool = { address: ev.args.pool, abi: ART("BondingCurvePoolV2").abi };
      }
    } catch {}
  }
  assert.ok(token && pool, "token deployed");
});

test("fee => voting power (40/40/20 economics)", async () => {
  const e = await read(votePower, "epoch");
  await write(t1, pool, "buy", [0n, t1.address], parseEther("1"));   // fee 0.01
  await write(t2, pool, "buy", [0n, t2.address], parseEther("3"));   // fee 0.03
  const p1 = await read(votePower, "powerOf", [e, t1.address]);
  const p2 = await read(votePower, "powerOf", [e, t2.address]);
  assert.equal(p1, parseEther("0.01"));
  assert.equal(p2, parseEther("0.03"));
  // creator 40% of fees
  const creatorAcc = await read(pool, "creatorFeesAccrued");
  assert.equal(creatorAcc, parseEther("0.016")); // 40% от 0.04
  const protoAcc = await read(pool, "protocolFeesAccrued");
  assert.equal(protoAcc, parseEther("0.024"));   // 60% от 0.04
});

test("minPower: below-threshold wallets cannot vote", async () => {
  // t1 заплатил 0.01 комиссий (0.002 нужно) — проходит; свежий кошелёк — нет
  await assert.rejects(write(deployer, votePower, "vote", [token.address])); // 0 силы
});

test("vote commits current and future power", async () => {
  const e = await read(votePower, "epoch");
  await write(t1, votePower, "vote", [token.address]);
  assert.equal(await read(votePower, "totalFor", [e, token.address]), parseEther("0.01"));
  // после голоса новая торговля докидывает силу автоматически
  await write(t1, pool, "buy", [0n, t1.address], parseEther("1")); // ещё 0.01
  assert.equal(await read(votePower, "totalFor", [e, token.address]), parseEther("0.02"));
  await write(t2, votePower, "vote", [token.address]);
  assert.equal(await read(votePower, "totalFor", [e, token.address]), parseEther("0.05"));
  // повторный голос запрещён
  await assert.rejects(write(t1, votePower, "vote", [token.address]));
});

test("buybackAndReward: 50% voters / 50% burn, claims pro-rata", async () => {
  await write(deployer, treasury, "setRewardBps", [5000]);
  const e = await read(votePower, "epoch");
  // комиссии из пула в казну
  await write(deployer, pool, "claimProtocolFees");
  const treBal = await pub.getBalance({ address: treasury.address });
  assert.ok(treBal > 0n, "treasury funded");

  // закончить эпоху
  await rpc("evm_increaseTime", [7 * 86400]);
  await rpc("evm_mine");

  // до конца эпохи фонд нельзя было — теперь можно
  const rc = await write(deployer, treasury, "buybackAndReward",
    [token.address, treBal, 0n, e]);
  assert.ok(rc.status === "success");

  const reward = await read(votePower, "rewardOf", [e]);
  const bought = await read(treasury, "boughtOf", [token.address]);
  const burned = await read(treasury, "burnedOf", [token.address]);
  assert.equal(reward[0].toLowerCase(), token.address.toLowerCase());
  assert.equal(reward[1], bought / 2n);         // 50% голосовавшим
  assert.equal(burned, bought - bought / 2n);   // 50% сожжено
  assert.equal(await read(token, "balanceOf", [DEAD]), burned);

  // t1: 0.02 из 0.05 силы; t2: 0.03 из 0.05
  const pend1 = await read(votePower, "pendingReward", [e, t1.address]);
  const pend2 = await read(votePower, "pendingReward", [e, t2.address]);
  assert.equal(pend1, (reward[1] * 2n) / 5n);
  assert.equal(pend2, (reward[1] * 3n) / 5n);

  const before1 = await read(token, "balanceOf", [t1.address]);
  await write(t1, votePower, "claim", [e]);
  const after1 = await read(token, "balanceOf", [t1.address]);
  assert.equal(after1 - before1, pend1);

  // дважды нельзя, чужим нельзя
  await assert.rejects(write(t1, votePower, "claim", [e]));
  await assert.rejects(write(deployer, votePower, "claim", [e]));

  // портфель казны ведётся
  assert.equal(await read(treasury, "portfolioCount"), 1n);
  assert.equal((await read(treasury, "portfolio", [0n])).toLowerCase(), token.address.toLowerCase());
});

test("guardian: delist emits and flags", async () => {
  await write(deployer, treasury, "delist", [token.address, "test reason"]);
  assert.equal(await read(treasury, "delisted", [token.address]), true);
  await write(deployer, treasury, "relist", [token.address]);
  assert.equal(await read(treasury, "delisted", [token.address]), false);
});

test("security: random caller cannot record fees or fund rewards", async () => {
  await assert.rejects(write(t1, votePower, "recordFee", [t1.address, 1000n]));
  await assert.rejects(write(t1, votePower, "fundReward", [0n, token.address, 1n]));
  // казна не отдаёт ETH никак, кроме выкупа
  const fns = treasury.abi.filter((x) => x.type === "function").map((x) => x.name);
  assert.ok(!fns.some((n) => /withdraw|rescue|sweep/i.test(n)), "no withdrawal functions");
});
