// hood — чат холдеров с ИИ монеты. Cloudflare Worker на hoodandarrow.com/api/*.
//
// Зачем воркер: сайт статический, а ключ модели показывать в браузере нельзя.
// Воркер держит ключ, пускает только холдеров (баланс > 0 у монеты с
// включённым ИИ), считает лимиты и пишет разговор в ту же базу, из которой
// сайт его читает.
//
//   POST /api/chat/session  { address, ts, sig }   → { session, exp }
//   POST /api/chat/send     { session, coin, text } → { id, reply, model }
//   GET  /api/chat/health                            → { ok, limits }
//
// Деньги: за ответы платит hood (ключ OpenRouter). Лимиты — в LIMITS
// (wrangler.toml), считаются в Durable Object: их не сбросить снаружи.
import { isAddress } from "viem";
import {
  json, loginMessage, LOGIN_SKEW_MS, verifySignature, makeSession, checkSession, sessionSecret,
  coinInfo, isHolder, lastMessages, pushMessage, bumpStats, boardIdeas, builtPages, buildMessages, askModel, cleanText,
} from "./core.js";

// ------------------------------------------------------------------ лимиты (Durable Object)
export class Limits {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const { checks } = await req.json(); // [{ key, limit, ttl }]
    const now = Date.now();
    const vals = await Promise.all(checks.map((c) => this.state.storage.get(c.key)));
    for (let i = 0; i < checks.length; i++) {
      const v = vals[i];
      if (v && v.exp > now && v.n >= checks[i].limit) return json({ ok: false, key: checks[i].key });
    }
    await Promise.all(checks.map((c, i) => {
      const v = vals[i] && vals[i].exp > now ? vals[i] : { n: 0, exp: now + c.ttl * 1000 };
      v.n += 1;
      return this.state.storage.put(c.key, v);
    }));
    if (Math.random() < 0.02) { // изредка выметаем просроченные ключи
      const all = await this.state.storage.list();
      const dead = [...all].filter(([, v]) => !v || v.exp < now).map(([k]) => k);
      if (dead.length) await this.state.storage.delete(dead);
    }
    return json({ ok: true });
  }
}

function limits(env) {
  const out = { wallet_min: 6, wallet_day: 60, coin_min: 20, coin_day: 200, all_day: 1500 };
  for (const kv of String(env.LIMITS || "").split(",")) { const [k, v] = kv.split("="); if (k && v && k.trim() in out) out[k.trim()] = Number(v); }
  return out;
}
async function allow(env, wallet, coin) {
  const L = limits(env);
  const now = Date.now();
  const min = Math.floor(now / 60_000), day = new Date(now).toISOString().slice(0, 10);
  const checks = [
    { key: `w:m:${wallet}:${min}`, limit: L.wallet_min, ttl: 120 },
    { key: `w:d:${wallet}:${day}`, limit: L.wallet_day, ttl: 2 * 86400 },
    { key: `c:m:${coin}:${min}`, limit: L.coin_min, ttl: 120 },
    { key: `c:d:${coin}:${day}`, limit: L.coin_day, ttl: 2 * 86400 },
    { key: `a:d:${day}`, limit: L.all_day, ttl: 2 * 86400 },
  ];
  const stub = env.LIMITS_DO.get(env.LIMITS_DO.idFromName("global"));
  const r = await stub.fetch("https://limits/", { method: "POST", body: JSON.stringify({ checks }) });
  const j = await r.json();
  if (j.ok) return null;
  return j.key.startsWith("w:m") ? "Слишком часто — подождите минуту."
    : j.key.startsWith("w:d") ? "На сегодня ваш лимит сообщений исчерпан."
    : j.key.startsWith("c:m") ? "ИИ монеты занят — попробуйте через минуту."
    : "Лимит на сегодня исчерпан — ИИ вернётся завтра.";
}

// ------------------------------------------------------------------ кэши на время жизни изолята
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const c = cache.get(key);
  if (c && c.exp > Date.now()) return c.v;
  const v = await fn();
  cache.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}

// ------------------------------------------------------------------ HTTP
function cors(req) {
  const origin = req.headers.get("origin") || "";
  const ok = /^https:\/\/([a-z0-9-]+\.)?hoodandarrow\.com$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    "access-control-allow-origin": ok ? origin : "https://hoodandarrow.com",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
}
const err = (msg, status, code, h) => json({ error: code || "error", message: msg }, status, h);

async function readBody(req) {
  try { const j = await req.json(); return j && typeof j === "object" ? j : {}; } catch (e) { return {}; }
}

export default {
  async fetch(req, env, ctx) {
    const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "");

    if (p === "/api/chat/health") return json({ ok: true, limits: limits(env), fallback: env.FALLBACK_MODEL }, 200, h);

    if (p === "/api/chat/session" && req.method === "POST") {
      const { address, ts, sig } = await readBody(req);
      if (!isAddress(String(address || ""))) return err("Нет адреса.", 400, "bad_address", h);
      const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(Date.now() - t) > LOGIN_SKEW_MS) return err("Подпись устарела — подпишите ещё раз.", 400, "stale", h);
      const ok = await verifySignature(env.RPC_URL, address, loginMessage(address, t), sig);
      if (!ok) return err("Подпись не сходится с адресом.", 401, "bad_sig", h);
      const s = await makeSession(await sessionSecret(env), address);
      return json(s, 200, h);
    }

    if (p === "/api/chat/send" && req.method === "POST") {
      if (!env.OPENROUTER_KEY) return err("Чат ещё не подключён: нет ключа модели.", 503, "no_key", h);
      const body = await readBody(req);
      const wallet = await checkSession(await sessionSecret(env), body.session);
      if (!wallet) return err("Сессия истекла — подпишите вход ещё раз.", 401, "no_session", h);
      const coin = String(body.coin || "").toLowerCase();
      if (!isAddress(coin)) return err("Нет монеты.", 400, "bad_coin", h);
      const text = cleanText(body.text);
      if (!text) return err("Пустое сообщение.", 400, "empty", h);

      const info = await cached(`info:${coin}`, 5 * 60_000, () => coinInfo(env, coin));
      if (!info) return err("Такой монеты нет.", 404, "no_coin", h);
      if (!info.aiOn) return err("У этой монеты ИИ не включён.", 403, "no_ai", h);
      const holder = await cached(`bal:${coin}:${wallet}`, 60_000, () => isHolder(env, coin, wallet));
      if (!holder) return err(`Чат с ИИ — для холдеров. Купите хоть немного $${info.symbol}.`, 403, "not_holder", h);
      const limited = await allow(env, wallet, coin);
      if (limited) return err(limited, 429, "limit", h);

      const [history, ideas, built] = await Promise.all([
        lastMessages(env, coin),
        cached(`ideas:${coin}`, 60_000, () => boardIdeas(env, coin)),
        cached(`built:${coin}`, 5 * 60_000, () => builtPages(env, coin)),
      ]);
      const messages = buildMessages(info, history, ideas, built, wallet, text);
      const model = info.model || env.FALLBACK_MODEL;
      let out;
      try { out = await askModel(env, model, messages); }
      catch (e) {
        if (e.modelProblem && env.FALLBACK_MODEL && model !== env.FALLBACK_MODEL) out = await askModel(env, env.FALLBACK_MODEL, messages);
        else return err("Модель не ответила: " + String(e.message || e).slice(0, 120), 502, "model", h);
      }
      if (!out.text) return err("Модель ответила пустотой — попробуйте ещё раз.", 502, "model_empty", h);

      // Сначала вопрос, потом ответ — так они и лягут в ленту по ключам.
      await pushMessage(env, coin, { who: wallet, role: "user", text });
      const id = await pushMessage(env, coin, { who: "ai", role: "ai", text: out.text, model: out.usedModel });
      ctx.waitUntil(bumpStats(env, coin, out.cost));
      return json({ id, reply: out.text, model: out.usedModel }, 200, h);
    }

    return err("Нет такого пути.", 404, "not_found", h);
  },
};
