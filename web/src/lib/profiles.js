// Профили кошельков (имя, аватар, соцсети) — из ProfileRegistry в блокчейне.
// Один общий кэш на весь сайт: компоненты просят адреса, загрузчик собирает
// их пачкой в один вызов profilesOf (дребезг 60 мс), результат живёт в памяти
// и в localStorage до 6 часов. Нет профиля — null, ещё не спросили — undefined.
import { useEffect, useSyncExternalStore } from "react";
import { publicClient, short } from "./web3.js";
import { profileRegistryAbi } from "./abi.js";
import { PROFILE_REGISTRY_ADDRESS, PROFILES_LIVE } from "./config.js";

const LS = "hood_profiles_v1";
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

async function flush() {
  timer = null;
  const list = [...pending]; pending.clear();
  if (!list.length || !PROFILES_LIVE) return;
  for (let i = 0; i < list.length; i += 60) {
    const chunk = list.slice(i, i + 60);
    try {
      const res = await publicClient.readContract({ address: PROFILE_REGISTRY_ADDRESS, abi: profileRegistryAbi, functionName: "profilesOf", args: [chunk] });
      chunk.forEach((a, j) => {
        const p = res[j];
        store.set(a, p && Number(p.updatedAt) > 0
          ? { name: String(p.name || "").slice(0, 32), avatar: okAvatar(p.avatar) ? p.avatar : "", x: String(p.x || ""), telegram: String(p.telegram || ""), website: String(p.website || ""), at: Number(p.updatedAt) * 1000 }
          : null);
      });
    } catch (e) { chunk.forEach((a) => { if (!store.has(a)) store.set(a, null); }); }
  }
  persist(); notify();
}
const okAvatar = (a) => /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(a || "") || /^https:\/\//.test(a || "");

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

/** Сбросить кэш одного адреса (после сохранения своего профиля). */
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
