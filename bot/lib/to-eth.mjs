// ============================================================================
//  Казна копит в ETH (решение владельца 17.09.2026).
//
//  Доля арены/выкупа от монет за акции и крипту приходит в казну в их валюте
//  (GME, USDG…). Подиум же может состоять из любых монет, поэтому перед
//  выплатой бот переводит всю валюту казны в ETH: ArenaTreasuryV2.toEth()
//  меняет её через Uniswap V3 по маршрутам запа, ETH остаётся в казне.
//
//  Почему не «просто поменять всё с проскальзыванием 3%» (проверка 17.09.2026
//  на реальных пулах): у USDe пул против USDG почти пустой — 25 USDe там
//  дают $0.31 ETH. Тупой обмен либо слил бы деньги, либо вечно падал бы по
//  проскальзыванию и валюта лежала бы мёртвым грузом. Поэтому:
//    1. курс — только из глубокого пула (≥ MIN_DEPTH_USD) или подтверждённый
//       обозревателем (расхождение ≤ 10%); иначе валюту не трогаем;
//    2. сумма — симулируется заранее: если пул даёт меньше справедливой цены
//       на > MAX_IMPACT (5%), делим порцию пополам (до 6 раз) — большие
//       остатки уходят частями по дням, а не одним ударом по тонкому пулу;
//    3. minEthOut в транзакции = результат симуляции − 1%: защита от
//       сэндвича, а не гадание по курсу.
//  У старой казны (без toEth) модуль ничего не делает.
// ============================================================================
import { parseAbi, formatUnits } from "viem";
import { quoteUsd, ethUsdRate } from "./quote-price.mjs";

const MIN_DEPTH_USD = Number(process.env.CONVERT_MIN_DEPTH_USD || 5000);  // тоньше — курсу не верим без обозревателя
const MAX_IMPACT_BPS = BigInt(process.env.CONVERT_MAX_IMPACT_BPS || 500);  // 5%: комиссии пулов (до 1%+1%) + удар по цене
const TX_SLIPPAGE_BPS = BigInt(process.env.CONVERT_TX_SLIPPAGE_BPS || 100); // 1% от симуляции — против сэндвича
const MAX_HALVINGS = 6;                                                     // 1/64 остатка минимум
const MAX_PASSES = Number(process.env.CONVERT_MAX_PASSES || 4);             // порций одной валюты за запуск
const MIN_USD = Number(process.env.CONVERT_MIN_USD || 0.05);                // пыль — не тратим газ

// Базовые валюты площадки: всегда проверяем, даже если сделок по ним ещё не было
export const BASE_ASSETS = [
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
  "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", // USDe
];

const v2Abi = parseAbi([
  "function owner() view returns (address)",
  "function totalEthConverted() view returns (uint256)",
  "function toEth(address asset, uint256 amount, uint256 minEthOut) returns (uint256)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);

/** Казна умеет менять валюту в ETH? (ArenaTreasuryV2) */
export async function treasuryCanConvert(pub, treasury) {
  try { await pub.readContract({ address: treasury, abi: v2Abi, functionName: "totalEthConverted" }); return true; }
  catch (e) { return false; }
}

/** Справедливый курс валюты в $ — или причина, почему ему нельзя верить. */
function trustedUsd(info) {
  const { usd, depthUsd, explorerUsd } = info;
  if (!(usd > 0)) return { usd: 0, why: "курса нет" };
  const agree = explorerUsd > 0 && Math.abs(explorerUsd / usd - 1) <= 0.10;
  if (depthUsd >= MIN_DEPTH_USD) return { usd, why: "" };
  if (agree) return { usd, why: "" };
  return { usd: 0, why: `пул тонкий (глубина $${Math.round(depthUsd || 0)}), обозреватель ${explorerUsd > 0 ? "не согласен" : "молчит"}` };
}

/**
 * Перевести в ETH валюту казны из списка assets (+ базовые). Возвращает
 * сколько ETH получено (wei, по симуляциям). Никогда не бросает исключений.
 */
export async function convertTreasuryToEth(pub, wallet, treasury, assets, { dry = false, log = console.log } = {}) {
  const uniq = [...new Set([...(assets || []), ...BASE_ASSETS].map((a) => String(a).toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
  let got = 0n;
  let owner;
  try { owner = await pub.readContract({ address: treasury, abi: v2Abi, functionName: "owner" }); } catch (e) { log(`  казна не отвечает: ${e.shortMessage || e.message}`); return 0n; }
  if (!dry && owner.toLowerCase() !== wallet.account.address.toLowerCase()) { log(`  кошелёк бота не владелец казны (${owner}) — обмен невозможен`); return 0n; }
  const eth = await ethUsdRate(pub);
  if (!(eth > 0)) { log("  курс ETH недоступен — обмен отложен до следующего запуска"); return 0n; }
  for (const asset of uniq) {
    // до MAX_PASSES порций за запуск: большой остаток уходит несколькими сделками, не одним ударом
    for (let pass = 0; pass < MAX_PASSES; pass++) {
    try {
      const bal = await pub.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [treasury] }).catch(() => 0n);
      if (bal === 0n) break;
      const sym = await pub.readContract({ address: asset, abi: erc20, functionName: "symbol" }).catch(() => "?");
      const info = await quoteUsd(pub, asset, eth);
      const dec = info.dec;
      const amtH = Number(formatUnits(bal, dec));
      const { usd, why } = trustedUsd(info);
      if (!(usd > 0)) { log(`  ${sym}: ${amtH} — ${why}; не меняем, копим.`); break; }
      const valUsd = amtH * usd;
      if (valUsd < MIN_USD) { log(`  ${sym}: ${amtH} ≈ $${valUsd.toFixed(2)} — пыль, копим.`); break; }

      // порция: с полной суммы вниз, пока пул не даёт ≥ справедливой − MAX_IMPACT
      let amt = bal, expected = null, fairWei = 0n;
      for (let i = 0; i <= MAX_HALVINGS; i++) {
        const part = Number(formatUnits(amt, dec));
        fairWei = BigInt(Math.floor((part * usd / eth) * 1e18));
        if (Number(fairWei) / 1e18 * eth < MIN_USD) { expected = null; break; }
        let sim;
        try {
          sim = await pub.simulateContract({ account: owner, address: treasury, abi: v2Abi, functionName: "toEth", args: [asset, amt, 0n] });
        } catch (e) {
          log(`  ${sym}: симуляция обмена ${part} не прошла — ${(e.shortMessage || e.message).split("\n")[0]}; копим.`);
          expected = null; amt = 0n; break;
        }
        expected = sim.result;
        const minFair = fairWei * (10000n - MAX_IMPACT_BPS) / 10000n;
        if (expected >= minFair) break;
        const lossPct = (100 - Number(expected * 10000n / (fairWei || 1n)) / 100).toFixed(1);
        log(`  ${sym}: ${part} → ${(Number(expected) / 1e18).toFixed(6)} ETH хуже курса на ${lossPct}% — делю порцию пополам`);
        amt /= 2n; expected = null;
      }
      if (expected === null || amt === 0n) { if (amt !== 0n) log(`  ${sym}: даже 1/64 остатка (${amtH / 64}) уходит слишком дорого — копим, попробую завтра.`); break; }
      const minOut = expected * (10000n - TX_SLIPPAGE_BPS) / 10000n;
      const part = Number(formatUnits(amt, dec));
      log(`  ${sym}: ${part}${amt < bal ? ` из ${amtH}` : ""} (≈$${(part * usd).toFixed(2)}) → ${(Number(expected) / 1e18).toFixed(6)} ETH, минимум ${(Number(minOut) / 1e18).toFixed(6)}${dry ? " (сухо)" : ""}`);
      if (dry) { got += expected; break; }
      const hash = await wallet.writeContract({ address: treasury, abi: v2Abi, functionName: "toEth", args: [asset, amt, minOut] });
      const rc = await pub.waitForTransactionReceipt({ hash });
      log(`    ${rc.status} ${hash}`);
      if (rc.status !== "success") { log(`    обмен ${sym} не прошёл — валюта осталась в казне, попробую в следующий раз.`); break; }
      got += expected;
      if (amt >= bal) break; // всё обменяли — следующая валюта; иначе ещё порция
    } catch (e) {
      log(`  ${asset}: ошибка — ${e.shortMessage || e.message}; пропускаю.`);
      break;
    }
    }
  }
  return got;
}
