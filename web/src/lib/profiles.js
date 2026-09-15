// Профили кошельков (имя, аватар, соцсети) — бесплатно и мгновенно, без
// транзакций (решение владельца 15.09.2026): кошелёк подписывает запись
// (подпись сообщения — без газа), запись кладётся в базу сайта по адресу,
// а сайт при чтении проверяет подпись. Чужую запись подделать нельзя:
// без верной подписи её просто не покажут. Записи только добавляются
// (правила базы запрещают перезапись) — берём самую свежую верную.
//
// Один общий кэш на весь сайт: компоненты просят адреса, загрузчик собирает
// их пачкой (дребезг 60 мс), результат живёт в памяти и в localStorage до
// 6 часов. Нет профиля — null, ещё не спросили — undefined.
import { useEffect, useSyncExternalStore } from "react";
import { verifyMessage } from "viem";
import { short } from "./web3.js";
import { CHAT_DB_URL, PROFILES_LIVE } from "./config.js";

export const PROFILE_MSG_PREFIX = "hood profile v1\n";
const LS = "hood_profiles_v2";
const TTL = 6 * 3600 * 1000;
const store = new Map();   // addr(lower) → { name, avatar, x, telegram, website, at } | null
const pending = new Set();
const listeners = new Set();
let version = 0;
let timer = null;

try {
  const raw = JSON.parse(localStorage.getItem(LS) || "{}");
  if (raw && raw.t && Date.now() - raw.t < TTL && raw.m) for (const [k, v] of Object.entries(raw.m)) store.set(k, v);
} catch (e) { /* ignore */ }

function persist() {
  try {
    const m = {}; let n = 0;
    for (const [k, v] of store) { if (v) { m[k] = v; if (++n > 300) break; } }
    localStorage.setItem(LS, JSON.stringify({ t: Date.now(), m }));
  } catch (e) { /* ignore */ }
}
function notify() { version++; for (const l of listeners) l(); }

const okAvatar = (a) => /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(a || "") || /^https:\/\//.test(a || "");
const dbUrl = (addr) => `${CHAT_DB_URL}/profiles/${addr}.json?orderBy="$key"&limitToLast=8`;

/** Собрать текст, который подписывает кошелёк. Поля — в фиксированном порядке. */
export function profilePayload(addr, f, ts) {
  return JSON.stringify({
    a: String(addr).toLowerCase(), t: ts,
    n: String(f.name || "").trim().slice(0, 32),
    av: okAvatar(f.avatar) ? f.avatar : "",
    x: String(f.x || "").trim().slice(0, 120),
    tg: String(f.telegram || "").trim().slice(0, 120),
    w: String(f.website || "").trim().slice(0, 200),
  });
}

/** Проверить одну запись базы: подпись должна принадлежать адресу, а
 *  адрес и время внутри — совпадать с местом записи.
 *  Возвращает { ok, profile }: ok=false — запись чужая или битая;
 *  ok=true и profile=null — владелец стёр профиль. */
async function verifyEntry(addr, key, e) {
  try {
    if (!e || typeof e.p !== "string" || typeof e.s !== "string") return { ok: false };
    const d = JSON.parse(e.p);
    if (d.a !== addr || String(d.t) !== String(key)) return { ok: false };
    const ok = await verifyMessage({ address: addr, message: PROFILE_MSG_PREFIX + e.p, signature: e.s });
    if (!ok) return { ok: false };
    const p = { name: String(d.n || "").slice(0, 32), avatar: okAvatar(d.av) ? d.av : "", x: String(d.x || ""), telegram: String(d.tg || ""), website: String(d.w || ""), at: Number(d.t) };
    return { ok: true, profile: (p.name || p.avatar || p.x || p.telegram || p.website) ? p : null };
  } catch (err) { return { ok: false }; }
}

/** Профиль адреса: самая свежая запись с верной подписью. undefined — база не ответила. */
async function loadOne(addr) {
  try {
    const r = await fetch(dbUrl(addr), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return undefined;
    const j = await r.json();
    const keys = Object.keys(j || {}).sort((a, b) => Number(b) - Number(a)); // свежие первыми
    for (const k of keys) {
      const v = await verifyEntry(addr, k, j[k]);
      if (v.ok) return v.profile;
    }
    return null;
  } catch (e) { return undefined; }
}

async function flush() {
  timer = null;
  const list = [...pending]; pending.clear();
  if (!list.length || !PROFILES_LIVE) return;
  // не больше 8 запросов разом
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const a = list[i++];
      const p = await loadOne(a);
      if (p !== undefined) store.set(a, p);
      else if (!store.has(a)) store.set(a, null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, list.length) }, worker));
  persist(); notify();
}

export function requestProfiles(addrs) {
  if (!PROFILES_LIVE) return;
  let added = false;
  for (const a of addrs || []) {
    const k = String(a || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(k) || store.has(k) || pending.has(k)) continue;
    pending.add(k); added = true;
  }
  if (added && !timer) timer = setTimeout(flush, 60);
}

/** Сохранить свой профиль: подпись кошельком (бесплатно) + запись в базу.
 *  Пустые поля — профиль стёрт. Возвращает сохранённый профиль или null. */
export async function saveProfile(wallet, f) {
  const addr = String(wallet.account).toLowerCase();
  const ts = Date.now();
  const p = profilePayload(addr, f, ts);
  const s = await wallet.walletClient.signMessage({ account: wallet.account, message: PROFILE_MSG_PREFIX + p });
  const r = await fetch(`${CHAT_DB_URL}/profiles/${addr}/${ts}.json`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p, s }),
  });
  if (!r.ok) throw new Error("db " + r.status);
  const saved = (await verifyEntry(addr, String(ts), { p, s })).profile ?? null;
  store.set(addr, saved);
  persist(); notify();
  return saved;
}

/** Сбросить кэш одного адреса. */
export function invalidateProfile(addr) {
  store.delete(String(addr || "").toLowerCase());
  persist(); notify();
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getVersion = () => version;

/** Хук: профили набора адресов. Возвращает функцию get(addr) → профиль | null | undefined. */
export function useProfiles(addrs) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const key = (addrs || []).map((a) => String(a || "").toLowerCase()).join(",");
  useEffect(() => { requestProfiles(addrs || []); }, [key]); // eslint-disable-line
  return (addr) => store.get(String(addr || "").toLowerCase());
}

export function useProfile(addr) {
  const get = useProfiles(addr ? [addr] : []);
  return addr ? get(addr) : null;
}

/** Имя для показа: имя из профиля или короткий адрес. */
export function nameOf(addr, p) {
  return p && p.name ? p.name : short(addr || "");
}

/** Ссылка на соцсеть из ника или полной ссылки. */
export function socialUrl(kind, v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (kind === "x") return `https://x.com/${s.replace(/^@/, "")}`;
  if (kind === "telegram") return `https://t.me/${s.replace(/^@/, "")}`;
  return `https://${s}`;
}
