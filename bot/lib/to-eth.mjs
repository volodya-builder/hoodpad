// ============================================================================
//  Казна копит в ETH (решение владельца 17.09.2026).
//
//  Доля арены/выкупа от монет за акции и крипту приходит в казну в их валюте
//  (GME, USDG…). Подиум же может состоять из любых монет, поэтому перед
//  выплатой бот переводит всю валюту казны в ETH: ArenaTreasuryV2.toEth()
//  меняет её через Uniswap V3 по маршрутам запа, ETH остаётся в казне.
//
//  У старой казны (ArenaTreasury без toEth) этого умения нет — тогда
//  модуль ничего не делает и бот платит по-старому (валютой за валютные
//  монеты).
// ============================================================================
import { parseAbi, formatUnits } from "viem";
import { quoteUsd, ethUsdRate } from "./quote-price.mjs";

const v2Abi = parseAbi([
  "function totalEthConverted() view returns (uint256)",
  "function toEth(address asset, uint256 amount, uint256 minEthOut) returns (uint256)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);

/** Казна умеет менять валюту в ETH? (ArenaTreasuryV2) */
export async function treasuryCanConvert(pub, treasury) {
  try { await pub.readContract({ address: treasury, abi: v2Abi, functionName: "totalEthConverted" }); return true; }
  catch (e) { return false; }
}

/**
 * Перевести в ETH всю валюту казны из списка assets.
 * minEthOut — по курсу (валюта→$→ETH) минус slippageBps. Валюту без курса
 * или без маршрута пропускаем (остаётся копиться). Возвращает сколько ETH
 * получено (в wei) по событиям/балансу.
 */
export async function convertTreasuryToEth(pub, wallet, treasury, assets, { dry = false, slippageBps = 300n, minUsd = 0.05, log = console.log } = {}) {
  const uniq = [...new Set((assets || []).map((a) => String(a).toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
  if (!uniq.length) return 0n;
  const eth = await ethUsdRate(pub);
  let got = 0n;
  for (const asset of uniq) {
    const bal = await pub.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [treasury] }).catch(() => 0n);
    if (bal === 0n) continue;
    const sym = await pub.readContract({ address: asset, abi: erc20, functionName: "symbol" }).catch(() => "?");
    const { usd, dec } = await quoteUsd(pub, asset, eth || null);
    const amtH = Number(formatUnits(bal, dec));
    if (!(usd > 0) || !(eth > 0)) { log(`  ${sym}: ${amtH} — курса нет, не меняем, копим.`); continue; }
    const valUsd = amtH * usd;
    if (valUsd < minUsd) { log(`  ${sym}: ${amtH} ≈ $${valUsd.toFixed(2)} — пыль, копим.`); continue; }
    const expectEth = valUsd / eth;
    const minOut = BigInt(Math.floor(expectEth * 1e18)) * (10000n - slippageBps) / 10000n;
    try {
      const sim = await pub.simulateContract({ account: wallet.account, address: treasury, abi: v2Abi, functionName: "toEth", args: [asset, bal, minOut] });
      log(`  ${sym}: ${amtH} (≈$${valUsd.toFixed(2)}) → ${(Number(sim.result) / 1e18).toFixed(6)} ETH${dry ? " (сухо)" : ""}`);
      if (dry) continue;
      const hash = await wallet.writeContract({ address: treasury, abi: v2Abi, functionName: "toEth", args: [asset, bal, minOut] });
      const rc = await pub.waitForTransactionReceipt({ hash });
      log(`    ${rc.status} ${hash}`);
      if (rc.status === "success") got += sim.result;
    } catch (e) {
      log(`  ${sym}: обмен не прошёл — ${e.shortMessage || e.message}. Копим.`);
    }
  }
  return got;
}
