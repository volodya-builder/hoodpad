// Доска идей: холдеры пишут, что ИИ монеты строит следующим, и голосуют.
// Без раундов: идеи копятся, голоса считаются сразу, агент (cron раз в
// 5 минут) забирает верхнюю идею, когда свободен и есть бюджет.
//
// ЧЕСТНО ПРО ЗАЩИТУ. База открыта на запись, поэтому подделать строку
// может кто угодно. Поэтому идея и голос подписываются кошельком, а при
// подсчёте подпись проверяется: строка, подпись которой не сходится с
// адресом, не считается. Подделка возможна, влияние — нет. Удалить чужую
// строку в открытой базе тоже можно — это известная дыра v1, закрывается
// бэкендом или голосами в цепи (см. CONCEPT-AI-BOARD.md).
//
// Вес голоса — баланс токена в момент подсчёта (v1: баланс можно занять).
// Что уже построено — builds.json в репозитории (агент коммитит его вместе
// со страницей): такую идею доска убирает.

import { verifyMessage } from "viem";
import { CHAT_DB_URL } from "./config.js";
import { publicClient } from "./web3.js";
import { tokenAbi } from "./abi.js";

/** Порог на предложение: 0.1% от выпуска (1B) — чтобы доску не заливали. */
export const PROPOSE_MIN = 1_000_000n * 10n ** 18n;
/** Столько сборок у монеты за счёт hood, дальше — на её бюджет. */
export const FREE_BUILDS = 3;
/** Агент просыпается по cron раз в столько минут. */
export const AGENT_PERIOD_MIN = 5;

const db = (path) => `${CHAT_DB_URL}/${path}.json`;
const ok = (r) => (r.ok ? r.json() : null);
const key = (token) => token.toLowerCase();

/** Текст, который подписывает кошелёк. Меняешь формат — ломаешь старые записи. */
export const proposalMessage = (token, pid, text) =>
  `hood board proposal\ntoken: ${key(token)}\npid: ${pid}\ntext: ${text}`;
export const voteMessage = (token, pid) =>
  `hood board vote\ntoken: ${key(token)}\nproposal: ${pid}`;

export const newPid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function loadBoard(token) {
  if (!CHAT_DB_URL) return { proposals: [], votes: {}, building: null };
  const b = await fetch(db(`workshop/board/${key(token)}`)).then(ok).catch(() => null);
  return parseBoard(b);
}

export function parseBoard(b) {
  const proposals = Object.entries((b && b.proposals) || {})
    .map(([pid, x]) => ({ pid, ...(x || {}) }))
    .filter((p) => p.text && p.by && p.sig)
    .sort((a, c) => (a.at || 0) - (c.at || 0));
  return { proposals, votes: (b && b.votes) || {}, building: (b && b.building) || null };
}

/** Живой поток изменений доски (RTDB REST streaming). Возвращает stop(). */
export function watchBoard(token, onBoard) {
  if (!CHAT_DB_URL || typeof EventSource === "undefined") return () => {};
  let es;
  try {
    es = new EventSource(db(`workshop/board/${key(token)}`));
  } catch (e) { return () => {}; }
  let snapshot = null;
  const apply = (path, data) => {
    if (path === "/" || path === "") { snapshot = data; }
    else {
      // патч по пути вида /votes/0xabc или /proposals/xyz
      const parts = path.split("/").filter(Boolean);
      snapshot = snapshot || {};
      let cur = snapshot;
      for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
      const last = parts[parts.length - 1];
      if (data === null) delete cur[last]; else cur[last] = data;
    }
    onBoard(parseBoard(snapshot));
  };
  const handler = (e) => {
    try { const { path, data } = JSON.parse(e.data); apply(path, data); } catch (err) { /* мусор в потоке */ }
  };
  es.addEventListener("put", handler);
  es.addEventListener("patch", handler);
  return () => { try { es.close(); } catch (e) { /* ignore */ } };
}

export async function submitProposal({ token, text, address, signature, pid }) {
  const body = JSON.stringify({ text, by: address.toLowerCase(), at: Date.now(), sig: signature });
  const r = await fetch(db(`workshop/board/${key(token)}/proposals/${pid}`), { method: "PUT", body });
  if (!r.ok) throw new Error("не удалось сохранить идею");
  return pid;
}

/** pid "" — снять голос (подпись на пустой pid). */
export async function submitVote({ token, pid, address, signature }) {
  const body = JSON.stringify({ pid, at: Date.now(), sig: signature });
  const r = await fetch(db(`workshop/board/${key(token)}/votes/${address.toLowerCase()}`), { method: "PUT", body });
  if (!r.ok) throw new Error("не удалось сохранить голос");
}

// Проверенные подписи кэшируем: подпись не меняется, а verifyMessage — это
// восстановление ключа, при каждом обновлении доски заново считать незачем.
const sigCache = new Map();
async function verified(cacheKey, address, message, signature) {
  if (sigCache.has(cacheKey)) return sigCache.get(cacheKey);
  let v = false;
  try { v = await verifyMessage({ address, message, signature }); } catch (e) { v = false; }
  sigCache.set(cacheKey, v);
  return v;
}

/** Балансы недолго кэшируем — доска обновляется чаще, чем меняются балансы. */
const balCache = new Map();
export async function balanceOf(token, address) {
  const k = `${key(token)}:${address.toLowerCase()}`;
  const c = balCache.get(k);
  if (c && Date.now() - c.t < 15_000) return c.v;
  let v = 0n;
  try {
    v = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [address] });
  } catch (e) { v = 0n; }
  balCache.set(k, { v, t: Date.now() });
  return v;
}

/**
 * Подсчёт: идеи с честной подписью автора, голоса с честной подписью и
 * ненулевым балансом. built — множество pid, которые агент уже построил
 * (их с доски убираем), building — pid в работе прямо сейчас.
 */
export async function tallyBoard(token, board, built = new Set()) {
  const props = [];
  for (const p of board.proposals) {
    if (built.has(p.pid)) continue;
    const real = await verified(`p:${p.pid}`, p.by, proposalMessage(token, p.pid, p.text), p.sig);
    if (real) props.push(p);
  }
  const byPid = new Set(props.map((p) => p.pid));
  const entries = Object.entries(board.votes || {});
  const valid = [];
  for (const [addr, v] of entries) {
    if (!v || !v.sig || !v.pid || !byPid.has(v.pid)) continue;
    const real = await verified(`v:${addr}:${v.pid}:${v.sig.slice(0, 20)}`, addr, voteMessage(token, v.pid), v.sig);
    if (real) valid.push([addr, v]);
  }
  const weights = await Promise.all(valid.map(([addr]) => balanceOf(token, addr)));
  const weight = {}, votersOf = {};
  let total = 0n, voters = 0;
  valid.forEach(([addr, v], i) => {
    const w = weights[i];
    if (w <= 0n) return;
    weight[v.pid] = (weight[v.pid] || 0n) + w;
    votersOf[v.pid] = (votersOf[v.pid] || 0) + 1;
    total += w; voters += 1;
  });
  const list = props.map((p) => ({
    ...p,
    weight: weight[p.pid] || 0n,
    voters: votersOf[p.pid] || 0,
    pct: total > 0n ? Number(((weight[p.pid] || 0n) * 1000n) / total) / 10 : 0,
  }));
  // верх — по весу, при равенстве — старшая идея
  list.sort((a, b) => (a.weight === b.weight ? (a.at || 0) - (b.at || 0) : a.weight > b.weight ? -1 : 1));
  const building = board.building && byPid.has(board.building.pid) ? board.building : null;
  return { list, total, voters, building };
}

/** Что построено — builds.json. Читаем со staging: туда агент коммитит сразу. */
let buildsCache = null;
export async function loadBuilds() {
  if (buildsCache && Date.now() - buildsCache.t < 30_000) return buildsCache.v;
  const urls = ["https://hoodandarrow.com/staging/agents/builds.json", "./agents/builds.json"];
  for (const u of urls) {
    try {
      const r = await fetch(`${u}?v=${Math.floor(Date.now() / 30_000)}`);
      if (!r.ok) continue;
      const v = await r.json();
      if (Array.isArray(v)) { buildsCache = { v, t: Date.now() }; return v; }
    } catch (e) { /* следующий источник */ }
  }
  return buildsCache?.v || [];
}

/** Пульс агента (пишет scripts/agent-run.mjs из CI): { at, state, token, pid, text, note, url }.
 *  Нет записи или база закрыта — null: сайт живёт по расписанию cron. */
export async function loadHeartbeat() {
  if (!CHAT_DB_URL) return null;
  try {
    const r = await fetch(db("workshop/agent/heartbeat"));
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j === "object" && j.at ? j : null;
  } catch (e) { return null; }
}

/** Следующее пробуждение агента по cron (каждые AGENT_PERIOD_MIN минут). */
export function nextAgentWake(now = Date.now()) {
  const p = AGENT_PERIOD_MIN * 60_000;
  return Math.ceil(now / p) * p;
}
