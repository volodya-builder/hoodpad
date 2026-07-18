/**
 * End-to-end tests for the launchpad against a local Hardhat node.
 * Run: npm test  (starts the node automatically via scripts/run-tests.sh)
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  decodeEventLog,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", `${name}.json`), "utf8")
  );

// Well-known hardhat accounts
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer / protocol owner
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // creator
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // trader1
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // trader2
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // treasury
];
const accounts = KEYS.map((k) => privateKeyToAccount(k));
const [deployer, creator, trader1, trader2, treasury] = accounts;

const transport = http("http://127.0.0.1:8545");
const pub = createPublicClient({ chain: hardhat, transport });
const wallet = (account) => createWalletClient({ account, chain: hardhat, transport });

async function deploy(account, artifactName, args = [], value = 0n) {
  const art = ART(artifactName);
  const hash = await wallet(account).deployContract({
    abi: art.abi,
    bytecode: art.bytecode,
    args,
    value,
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rcpt.status, "success", `${artifactName} deploy failed`);
  return { address: rcpt.contractAddress, abi: art.abi };
}

async function write(account, contract, functionName, args = [], value = 0n) {
  const hash = await wallet(account).writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
    value,
  });
  return pub.waitForTransactionReceipt({ hash });
}

const read = (contract, functionName, args = []) =>
  pub.readContract({ address: contract.address, abi: contract.abi, functionName, args });

// ---------------------------------------------------------------- state
let factory, migrator, token, pool;
const FEE_BPS = 100n;
const TOTAL = parseEther("1000000000");
const CAP = parseEther("800000000");
const VIRT = parseEther("1.625");

before(async () => {
  migrator = await deploy(deployer, "MockMigrator");
  factory = await deploy(deployer, "LaunchpadFactory", [
    treasury.address,
    migrator.address,
  ]);
});

test("launch: token + pool deployed in one tx, registry updated", async () => {
  const rcpt = await write(creator, factory, "createToken", [
    "Volodya Coin",
    "VOLO",
    "ipfs://volo-metadata",
    "0x0000000000000000000000000000000000000000",
  ]);

  const created = rcpt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: factory.abi, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e && e.eventName === "TokenCreated");
  assert.ok(created, "TokenCreated event missing");

  token = { address: created.args.token, abi: ART("LaunchToken").abi };
  pool = { address: created.args.pool, abi: ART("BondingCurvePool").abi };

  assert.equal(await read(factory, "tokenCount"), 1n);
  assert.equal(
    getAddress(await read(factory, "poolOf", [token.address])),
    getAddress(pool.address)
  );
  // token address predicted correctly inside the factory
  assert.equal(getAddress(await read(pool, "token")), getAddress(token.address));
  // full supply sits in the pool
  assert.equal(await read(token, "balanceOf", [pool.address]), TOTAL);
  assert.equal(await read(token, "metadataURI"), "ipfs://volo-metadata");
  assert.equal(getAddress(await read(pool, "creator")), getAddress(creator.address));
});

test("launch with initial creator buy in the same tx", async () => {
  const rcpt = await write(
    creator,
    factory,
    "createToken",
    ["Second", "SEC", "ipfs://sec", "0x0000000000000000000000000000000000000000"],
    parseEther("1")
  );
  const created = rcpt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: factory.abi, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e && e.eventName === "TokenCreated");
  const tok2 = { address: created.args.token, abi: ART("LaunchToken").abi };
  const bal = await read(tok2, "balanceOf", [creator.address]);
  assert.ok(bal > 0n, "creator got no tokens from initial buy");
  // expected: net = 0.99 ETH; out = Y*e/(x+e) = 1e9 * 0.99 / (1.625+0.99)
  const expected = (TOTAL * parseEther("0.99")) / (VIRT + parseEther("0.99"));
  assert.equal(bal, expected);
});

test("launch with custom creator wallet: fees and dev buy go to it", async () => {
  const rcpt = await write(
    trader1, // launcher is trader1...
    factory,
    "createToken",
    ["Custom", "CUST", "ipfs://cust", trader2.address], // ...but creator wallet is trader2
    parseEther("0.5")
  );
  const created = rcpt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: factory.abi, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e && e.eventName === "TokenCreated");
  assert.equal(getAddress(created.args.creator), getAddress(trader2.address));

  const tok = { address: created.args.token, abi: ART("LaunchToken").abi };
  const poolC = { address: created.args.pool, abi: ART("BondingCurvePool").abi };
  // dev buy landed on the custom wallet, not the launcher
  assert.ok((await read(tok, "balanceOf", [trader2.address])) > 0n);
  assert.equal(await read(tok, "balanceOf", [trader1.address]), 0n);
  assert.equal(getAddress(await read(poolC, "creator")), getAddress(trader2.address));
});

test("buy: quoted amount matches, fees accrue 70/30", async () => {
  const ethIn = parseEther("0.5");
  const quoted = await read(pool, "quoteBuy", [ethIn]);
  const balBefore = await read(token, "balanceOf", [trader1.address]);

  await write(trader1, pool, "buy", [quoted, trader1.address], ethIn);

  const balAfter = await read(token, "balanceOf", [trader1.address]);
  assert.equal(balAfter - balBefore, quoted);

  const fee = (ethIn * FEE_BPS) / 10000n;
  const creatorCut = (fee * 7000n) / 10000n;
  assert.equal(await read(pool, "creatorFeesAccrued"), creatorCut);
  assert.equal(await read(pool, "protocolFeesAccrued"), fee - creatorCut);
  assert.equal(await read(pool, "ethReserve"), ethIn - fee);
});

test("slippage protection reverts", async () => {
  const ethIn = parseEther("0.1");
  const quoted = await read(pool, "quoteBuy", [ethIn]);
  await assert.rejects(
    write(trader2, pool, "buy", [quoted * 2n, trader2.address], ethIn),
    /SlippageExceeded/
  );
});

test("sell: round trip returns ETH minus fees, reserves stay consistent", async () => {
  const bal = await read(token, "balanceOf", [trader1.address]);
  // approve + sell everything back
  await write(trader1, token, "approve", [pool.address, bal]);

  const quotedGross = await read(pool, "quoteSell", [bal]);
  const minOut = quotedGross - (quotedGross * FEE_BPS) / 10000n;

  const ethBefore = await pub.getBalance({ address: trader1.address });
  await write(trader1, pool, "sell", [bal, minOut]);
  const ethAfter = await pub.getBalance({ address: trader1.address });

  assert.ok(ethAfter > ethBefore, "seller received no ETH");
  assert.equal(await read(token, "balanceOf", [trader1.address]), 0n);

  // Pool solvency invariant: balance covers reserve + accrued fees
  const poolBal = await pub.getBalance({ address: pool.address });
  const reserve = await read(pool, "ethReserve");
  const cFees = await read(pool, "creatorFeesAccrued");
  const pFees = await read(pool, "protocolFeesAccrued");
  assert.ok(poolBal >= reserve + cFees + pFees, "pool insolvent");
});

test("graduation: cap fills exactly, excess refunded, trading freezes", async () => {
  // Gross ETH needed ≈ 6.5 / 0.99 plus already-collected reserve; send plenty.
  const ethBefore = await pub.getBalance({ address: trader2.address });
  const rcpt = await write(trader2, pool, "buy", [0n, trader2.address], parseEther("10"));
  const ethAfter = await pub.getBalance({ address: trader2.address });

  assert.equal(await read(pool, "graduated"), true);
  assert.equal(await read(pool, "tokensSold"), CAP);

  // Reserve must be ~6.5 ETH (rounding dust at most a few wei)
  const reserve = await read(pool, "ethReserve");
  const target = parseEther("6.5");
  const dust = reserve > target ? reserve - target : target - reserve;
  assert.ok(dust < 1000n, `reserve off target by ${dust} wei`);

  // Refund happened: trader2 paid ~6.56 ETH + gas, far less than 10
  const spent = ethBefore - ethAfter;
  assert.ok(spent < parseEther("7"), `spent too much: ${formatEther(spent)}`);

  // Curve is closed both ways now
  await assert.rejects(
    write(trader1, pool, "buy", [0n, trader1.address], parseEther("0.1")),
    /TradingClosed/
  );
  const someTokens = await read(token, "balanceOf", [trader2.address]);
  assert.ok(someTokens > 0n);
  await write(trader2, token, "approve", [pool.address, someTokens]);
  await assert.rejects(write(trader2, pool, "sell", [someTokens, 0n]), /TradingClosed/);
});

test("migration: DEX reserve (200M tokens + ~6.5 ETH) reaches the migrator", async () => {
  const reserveBefore = await read(pool, "ethReserve");
  await write(trader1, pool, "migrate"); // permissionless

  assert.equal(await read(migrator, "migrations"), 1n);
  assert.equal(getAddress(await read(migrator, "lastToken")), getAddress(token.address));
  assert.equal(await read(migrator, "lastTokenAmount"), TOTAL - CAP);
  assert.equal(await read(migrator, "lastEthAmount"), reserveBefore);
  assert.equal(await read(token, "balanceOf", [migrator.address]), TOTAL - CAP);
  assert.equal(await read(pool, "ethReserve"), 0n);

  // double migration blocked
  await assert.rejects(write(trader1, pool, "migrate"), /AlreadyMigrated/);
});

test("fees: creator and protocol claims pay out", async () => {
  const cAcc = await read(pool, "creatorFeesAccrued");
  const pAcc = await read(pool, "protocolFeesAccrued");
  assert.ok(cAcc > 0n && pAcc > 0n);

  // only the creator can claim creator fees
  await assert.rejects(
    write(trader1, pool, "claimCreatorFees", [trader1.address]),
    /NotAuthorized/
  );

  const cBefore = await pub.getBalance({ address: creator.address });
  await write(creator, pool, "claimCreatorFees", [creator.address]);
  const cAfter = await pub.getBalance({ address: creator.address });
  assert.ok(cAfter > cBefore, "creator fee claim paid nothing");
  assert.equal(await read(pool, "creatorFeesAccrued"), 0n);

  const tBefore = await pub.getBalance({ address: treasury.address });
  await write(trader1, pool, "claimProtocolFees"); // permissionless, goes to treasury
  const tAfter = await pub.getBalance({ address: treasury.address });
  assert.equal(tAfter - tBefore, pAcc);

  // pool now holds nothing but dust
  const poolBal = await pub.getBalance({ address: pool.address });
  assert.ok(poolBal < 1000n, `pool retains ${poolBal} wei`);
});

test("factory admin: config bounds enforced, ownership respected", async () => {
  await assert.rejects(
    write(trader1, factory, "setConfig", [treasury.address, migrator.address, 100, 5000])
  );
  await assert.rejects(
    write(deployer, factory, "setConfig", [treasury.address, migrator.address, 600, 5000]),
    /fee>5%/
  );
  await write(deployer, factory, "setConfig", [treasury.address, migrator.address, 200, 8000]);
  assert.equal(await read(factory, "feeBps"), 200);
  assert.equal(await read(factory, "creatorFeeShareBps"), 8000);
});
