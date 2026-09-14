// Проверка экономики агента на живом EVM (hardhat node).
//
// Проверяем ровно то, что стоит денег: куда уходит ETH, кому он
// приписывается и что происходит, когда какая-то часть схемы сломана.

import fs from "node:fs";
import { createWalletClient, createPublicClient, http, parseEther, formatEther, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8545";
const chain = { id: 31337, name: "hh", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
// Первый аккаунт стандартной hardhat-мнемоники. Тестовый, публично известный.
const acc = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const wallet = createWalletClient({ account: acc, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });
const art = JSON.parse(fs.readFileSync("artifacts.json", "utf8"));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = String(got) === String(want);
  console.log(`${ok ? "  ok  " : "ПРОВАЛ"} ${name}${ok ? "" : `\n        получил ${got}\n        ожидал  ${want}`}`);
  ok ? pass++ : fail++;
};

async function deploy(name, args = []) {
  const hash = await wallet.deployContract({ abi: art[name].abi, bytecode: art[name].bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress;
}
const read = (addr, name, fn, args = []) =>
  pub.readContract({ address: addr, abi: art[name].abi, functionName: fn, args });
async function write(addr, name, fn, args = [], value) {
  const hash = await wallet.writeContract({ address: addr, abi: art[name].abi, functionName: fn, args, value });
  return pub.waitForTransactionReceipt({ hash });
}
const bal = (a) => pub.getBalance({ address: a });

const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const TEAM  = getAddress("0x2222222222222222222222222222222222222222");
const TOKEN2 = getAddress("0x3333333333333333333333333333333333333333");

console.log("\n— Новая монета: доля протокола 30%, делим 20/10 —\n");
{
  const tre = await deploy("AgentTreasury", [acc.address]);
  // teamBps 6667: из 30% протокольной доли команде 20 п.п., агенту 10 п.п.
  const spl = await deploy("FeeSplitterV3", [TEAM, tre, 6667]);
  const pool = await deploy("MockPool", [TOKEN]);

  await wallet.sendTransaction({ to: pool, value: parseEther("10") });
  const before = await bal(TEAM);
  await write(pool, "MockPool", "claimTo", [spl, parseEther("3")]); // 30% от 10 ETH оборота комиссий

  const team = (await bal(TEAM)) - before;
  const agent = await read(tre, "AgentTreasury", "budget", [TOKEN]);

  eq("команде 66.67% протокольной доли", formatEther(team), "2.0001");
  eq("агенту остальное", formatEther(agent), "0.9999");
  eq("зачислено именно этому токену", await read(tre, "AgentTreasury", "funded", [TOKEN]), agent);
  eq("чужому токену ноль", await read(tre, "AgentTreasury", "budget", [TOKEN2]), 0n);
}

console.log("\n— Отправитель не пул: зачислять некому —\n");
{
  const tre = await deploy("AgentTreasury", [acc.address]);
  const spl = await deploy("FeeSplitterV3", [TEAM, tre, 6667]);
  const stranger = await deploy("NotAPool");

  await wallet.sendTransaction({ to: stranger, value: parseEther("5") });
  const before = await bal(TEAM);
  await write(stranger, "NotAPool", "sendTo", [spl, parseEther("1")]);

  eq("всё ушло команде", formatEther((await bal(TEAM)) - before), "1");
}

console.log("\n— Казна агента сломана: выплата комиссий обязана пройти —\n");
{
  const broken = await deploy("BrokenTreasury");
  const spl = await deploy("FeeSplitterV3", [TEAM, broken, 6667]);
  const pool = await deploy("MockPool", [TOKEN]);

  await wallet.sendTransaction({ to: pool, value: parseEther("5") });
  const before = await bal(TEAM);
  let reverted = false;
  try { await write(pool, "MockPool", "claimTo", [spl, parseEther("3")]); }
  catch { reverted = true; }

  eq("выплата не откатилась", reverted, false);
  eq("доля агента ушла команде", formatEther((await bal(TEAM)) - before), "3");
}

console.log("\n— Траты: только оператор и только в пределах бюджета —\n");
{
  const tre = await deploy("AgentTreasury", [acc.address]);
  const spl = await deploy("FeeSplitterV3", [TEAM, tre, 6667]);
  const pool = await deploy("MockPool", [TOKEN]);
  await wallet.sendTransaction({ to: pool, value: parseEther("10") });
  await write(pool, "MockPool", "claimTo", [spl, parseEther("3")]);

  const budget = await read(tre, "AgentTreasury", "budget", [TOKEN]);

  let over = false;
  try { await write(tre, "AgentTreasury", "spend", [TOKEN, budget + 1n, "перебор"]); }
  catch { over = true; }
  eq("больше бюджета нельзя", over, true);

  await write(tre, "AgentTreasury", "spend", [TOKEN, parseEther("0.5"), "claude-opus 1.2M токенов"]);
  eq("бюджет уменьшился", formatEther(await read(tre, "AgentTreasury", "budget", [TOKEN])), formatEther(budget - parseEther("0.5")));
  eq("потрачено записано", formatEther(await read(tre, "AgentTreasury", "spent", [TOKEN])), "0.5");
  eq("собрано за всё время не изменилось", formatEther(await read(tre, "AgentTreasury", "funded", [TOKEN])), formatEther(budget));

  // Чужой кошелёк оператором не является.
  const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const w2 = createWalletClient({ account: other, chain, transport: http(RPC) });
  let notOp = false;
  try {
    const h = await w2.writeContract({ address: tre, abi: art.AgentTreasury.abi, functionName: "spend", args: [TOKEN, 1n, "чужой"] });
    await pub.waitForTransactionReceipt({ hash: h });
  } catch { notOp = true; }
  eq("чужой потратить не может", notOp, true);
}

console.log("\n— Старая монета: доля протокола 50%, пропорция та же —\n");
{
  const tre = await deploy("AgentTreasury", [acc.address]);
  const spl = await deploy("FeeSplitterV3", [TEAM, tre, 6667]);
  const pool = await deploy("MockPool", [TOKEN]);
  await wallet.sendTransaction({ to: pool, value: parseEther("10") });

  const before = await bal(TEAM);
  await write(pool, "MockPool", "claimTo", [spl, parseEther("5")]); // 50% протоколу

  eq("команде ~33% комиссии", formatEther((await bal(TEAM)) - before), "3.3335");
  eq("агенту ~17% комиссии", formatEther(await read(tre, "AgentTreasury", "budget", [TOKEN])), "1.6665");
}

console.log(`\nИтог: ${pass} прошло, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
