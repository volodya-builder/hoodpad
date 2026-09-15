// Бан-лист чата — подписанный кошельком команды документ в базе сайта, как
// профили (lib/profiles.js): ветка `bans/{ts}` = { p, s }, где p — JSON
// {"t":ts,"list":["кто",…]}, s — подпись TEAM_ADDRESS. База принимает записи
// от кого угодно (авторизации нет), поэтому чужие записи просто не проходят
// проверку подписи и пропускаются; действует самая свежая верная. Раньше
// админка писала `bans/{кто}` напрямую — правила базы это запрещали, и бан
// молча не срабатывал (аудит 15.09.2026).
import { verifyMessage } from "viem";
import { CHAT_DB_URL, TEAM_ADDRESS } from "./config.js";

export const BANS_MSG_PREFIX = "hood bans v1\n";
const WINDOW = 12; // сколько последних записей смотрим (мусор пропускаем)
const TTL = 30_000;
let cache = { at: 0, list: null };

const norm = (s) => String(s || "").trim().toLowerCase();

/** Текущий бан-лист (массив в нижнем регистре). Ошибка сети → пустой список. */
export async function loadBans({ force = false } = {}) {
  if (!CHAT_DB_URL) return [];
  if (!force && cache.list && Date.now() - cache.at < TTL) return cache.list;
  try {
    const r = await fetch(`${CHAT_DB_URL}/bans.json?orderBy="$key"&limitToLast=${WINDOW}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("bans " + r.status);
    const j = (await r.json()) || {};
    const keys = Object.keys(j).sort((a, b) => Number(b) - Number(a)); // свежие первыми
    let list = [];
    for (const k of keys) {
      const e = j[k];
      if (!e || typeof e.p !== "string" || typeof e.s !== "string") continue;
      let d;
      try { d = JSON.parse(e.p); } catch { continue; }
      if (String(d.t) !== String(k) || !Array.isArray(d.list)) continue;
      const ok = await verifyMessage({ address: TEAM_ADDRESS, message: BANS_MSG_PREFIX + e.p, signature: e.s }).catch(() => false);
      if (!ok) continue;
      list = d.list.map(norm).filter(Boolean).slice(0, 500);
      break;
    }
    cache = { at: Date.now(), list };
    return list;
  } catch (e) {
    return cache.list || [];
  }
}

/** Сохранить новый бан-лист: подпись кошельком команды + запись в базу. */
export async function saveBans(wallet, list) {
  const t = Date.now();
  const clean = [...new Set((list || []).map(norm).filter(Boolean))].slice(0, 500);
  const p = JSON.stringify({ t, list: clean });
  const s = await wallet.walletClient.signMessage({ account: wallet.account, message: BANS_MSG_PREFIX + p });
  const r = await fetch(`${CHAT_DB_URL}/bans/${t}.json`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p, s }),
  });
  if (!r.ok) throw new Error("db " + r.status);
  cache = { at: Date.now(), list: clean };
  return clean;
}

export const isBanned = (list, who) => list.includes(norm(who));
