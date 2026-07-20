#!/usr/bin/env node
// Еженедельные реферальные выплаты. Запускается ВЛАДЕЛЬЦЕМ ЛОКАЛЬНО.
//
//   node scripts/referral-payout.js            — посчитать и показать, кому сколько (ничего не платит)
//   node scripts/referral-payout.js --send     — выплатить всем pending >= MIN_PAYOUT и записать в Firebase
//                                                (нужен PRIVATE_KEY в окружении: командный кошелёк)
//
// Логика: привязки из Firebase (/referrals), комиссии трейдеров из Goldsky,
// начислено = fee * REF_RATE с момента привязки, к выплате = начислено - выплачено (/referralPayouts).

const DB = "https://hood-chat-4b664-default-rtdb.europe-west1.firebasedatabase.app";
const SUBGRAPH = "https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/1.0.0/gn";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const REF_RATE = 0.05;       // 5% каждой комиссии приведённого трейдера
const MIN_PAYOUT = 0.005;    // ETH — меньше не платим, копится дальше

async function gql(query) {
  const r = await fetch(SUBGRAPH, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0]?.message || "subgraph error");
  return j.data;
}

async function traderFees(trader, sinceTs) {
  const d = await gql(`{ trades(first: 1000, orderBy: timestamp, orderDirection: desc,
    where: { trader: "${trader.toLowerCase()}" }) { fee timestamp } }`);
  let fees = 0;
  for (const t of d.trades || []) {
    if (Number(t.timestamp) * 1000 < sinceTs) continue;
    fees += Number(t.fee) / 1e18;
  }
  return fees;
}

async function main() {
  const send = process.argv.includes("--send");
  const refs = (await fetch(`${DB}/referrals.json`).then((r) => r.json())) || {};
  const payouts = (await fetch(`${DB}/referralPayouts.json`).then((r) => r.json())) || {};

  // начислено по рефererам
  const accrued = {}; // ref -> eth
  for (const [trader, v] of Object.entries(refs)) {
    if (!v || !v.ref) continue;
    const fees = await traderFees(trader, v.ts || 0).catch(() => 0);
    accrued[v.ref] = (accrued[v.ref] || 0) + fees * REF_RATE;
  }

  const rows = Object.entries(accrued).map(([ref, acc]) => {
    const paid = Object.values(payouts[ref] || {}).reduce((s, p) => s + (Number(p?.eth) || 0), 0);
    return { ref, accrued: acc, paid, pending: Math.max(0, acc - paid) };
  }).sort((a, b) => b.pending - a.pending);

  console.log("Реферер                                     Начислено   Выплачено   К выплате");
  for (const r of rows) {
    console.log(`${r.ref}  ${r.accrued.toFixed(6)}  ${r.paid.toFixed(6)}  ${r.pending.toFixed(6)}`);
  }
  const total = rows.reduce((s, r) => s + r.pending, 0);
  console.log(`\nИтого к выплате: ${total.toFixed(6)} ETH (порог ${MIN_PAYOUT} ETH на кошелёк)`);

  if (!send) { console.log("\nСухой прогон. Для выплаты: PRIVATE_KEY=0x… node scripts/referral-payout.js --send"); return; }

  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error("Нет PRIVATE_KEY в окружении"); process.exit(1); }
  const { createWalletClient, http, parseEther } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(pk);
  const client = createWalletClient({ account, transport: http(RPC) });

  for (const r of rows) {
    if (r.pending < MIN_PAYOUT) continue;
    const eth = Math.floor(r.pending * 1e6) / 1e6; // округляем вниз до 6 знаков
    const hash = await client.sendTransaction({
      to: r.ref, value: parseEther(String(eth)), chain: null,
    });
    console.log(`→ ${r.ref}: ${eth} ETH, tx ${hash}`);
    await fetch(`${DB}/referralPayouts/${r.ref}/${Date.now()}.json`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eth, tx: hash, ts: Date.now() }),
    });
  }
  console.log("Готово.");
}

main().catch((e) => { console.error(e); process.exit(1); });
