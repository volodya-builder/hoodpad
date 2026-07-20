// Реферальная система v0 (без контрактов).
// Привязки «трейдер → реферер» лежат в Firebase RTDB, начисления считаются
// по комиссиям из Goldsky-сабграфа. Ставка — доля от каждой комиссии (1%)
// приведённого трейдера; финансируется из командной доли, казна и создатели
// не затронуты. Выплаты — еженедельным скриптом владельца (scripts/referral-payout.js).
import { CHAT_DB_URL } from "./config.js";
import { subgraphTraderFees } from "./data.js";

export const REF_RATE = 0.05; // 5% каждой комиссии = 25% командной доли

const LS = "hood_ref";
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");

/** Сохранить код реферера из ссылки #/r/0x… (первый пришедший — навсегда). */
export function captureRef(code) {
  if (!isAddr(code)) return false;
  try {
    if (!localStorage.getItem(LS)) localStorage.setItem(LS, code.toLowerCase());
    return true;
  } catch (e) { return false; }
}

export function getRef() {
  try { return localStorage.getItem(LS); } catch (e) { return null; }
}

/** После успешной сделки: закрепить трейдера за реферером (первый — навсегда). */
export async function bindRefIfNeeded(trader) {
  const ref = getRef();
  if (!ref || !isAddr(trader)) return;
  const t = trader.toLowerCase();
  if (ref === t) return; // самореферал не считаем
  try {
    const cur = await fetch(`${CHAT_DB_URL}/referrals/${t}.json`).then((r) => r.json());
    if (cur && cur.ref) return;
    await fetch(`${CHAT_DB_URL}/referrals/${t}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, ts: Date.now() }),
    });
  } catch (e) { /* ignore — привязка не критична для сделки */ }
}

export async function loadAllReferrals() {
  const j = await fetch(`${CHAT_DB_URL}/referrals.json`).then((r) => r.json()).catch(() => null);
  return j || {};
}

/** Сколько уже выплачено рефереру (записи делает скрипт владельца). */
export async function loadPaid(refAddr) {
  const j = await fetch(`${CHAT_DB_URL}/referralPayouts/${refAddr.toLowerCase()}.json`)
    .then((r) => r.json()).catch(() => null);
  if (!j) return 0;
  return Object.values(j).reduce((s, p) => s + (Number(p?.eth) || 0), 0);
}

/** Полная сводка для реферера: список приведённых, начислено, выплачено. */
export async function refStats(refAddr) {
  const me = refAddr.toLowerCase();
  const all = await loadAllReferrals();
  const mine = Object.entries(all).filter(([, v]) => v && v.ref === me);
  const rows = await Promise.all(
    mine.slice(0, 100).map(async ([trader, v]) => {
      const r = await subgraphTraderFees(trader, v.ts || 0).catch(() => ({ fees: 0, trades: 0 }));
      return { trader, ts: v.ts || 0, fees: r.fees, trades: r.trades, accrued: r.fees * REF_RATE };
    })
  );
  rows.sort((a, b) => b.accrued - a.accrued);
  const accrued = rows.reduce((s, r) => s + r.accrued, 0);
  const paid = await loadPaid(me).catch(() => 0);
  return { rows, accrued, paid, pending: Math.max(0, accrued - paid) };
}
