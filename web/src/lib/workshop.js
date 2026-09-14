// Мастерская: холдеры решают, что ИИ монеты строит следующим.
//
// Раунды недельные и вычисляются из времени, без сервера: никто их не
// «открывает», они существуют сами. Предложения и голоса лежат в Firebase.
//
// ЧЕСТНО ПРО ЗАЩИТУ. База открыта на запись, поэтому подделать строку
// голоса может кто угодно. Поэтому каждый голос подписывается кошельком,
// а при подсчёте подпись проверяется: строка, подпись которой не сходится
// с адресом, просто не считается. Подделка возможна, влияние — нет.
//
// Вес голоса — баланс токена, читается из блокчейна в момент подсчёта.
// Это v1: баланс можно занять на время голосования. Снимок в случайном
// блоке прошедшей недели — следующий шаг, он требует архивных запросов.

import { verifyMessage } from "viem";
import { CHAT_DB_URL } from "./config.js";
import { publicClient } from "./web3.js";
import { tokenAbi } from "./abi.js";

const WEEK = 7 * 24 * 3600 * 1000;

/** Порог на предложение: 0.1% от выпуска (1B) — чтобы не спамили. */
export const PROPOSE_MIN = 1_000_000n * 10n ** 18n;

export const roundId = (ts = Date.now()) => Math.floor(ts / WEEK);
export const roundStart = (id) => id * WEEK;
export const roundEnd = (id) => (id + 1) * WEEK;

export function roundPhase(id, now = Date.now()) {
  const passed = now - roundStart(id);
  if (passed < 2 * 24 * 3600 * 1000) return "propose"; // пн–ср: предлагают
  if (now < roundEnd(id)) return "vote";               // чт–вс: голосуют
  return "done";
}

const db = (path) => `${CHAT_DB_URL}/${path}.json`;
const ok = (r) => (r.ok ? r.json() : null);

/** Текст, который подписывает кошелёк. Меняешь формат — ломаешь старые голоса. */
export const voteMessage = (token, id, propId) =>
  `hood workshop vote\ntoken: ${token.toLowerCase()}\nround: ${id}\nproposal: ${propId}`;

export const proposeMessage = (token, id, text) =>
  `hood workshop proposal\ntoken: ${token.toLowerCase()}\nround: ${id}\ntext: ${text}`;

export async function loadRound(token, id) {
  if (!CHAT_DB_URL) return { proposals: [], votes: {} };
  const key = `${token.toLowerCase()}/${id}`;
  const [p, v] = await Promise.all([
    fetch(db(`workshop/proposals/${key}`)).then(ok).catch(() => null),
    fetch(db(`workshop/votes/${key}`)).then(ok).catch(() => null),
  ]);
  const proposals = Object.entries(p || {}).map(([pid, x]) => ({ pid, ...x }));
  proposals.sort((a, b) => (a.at || 0) - (b.at || 0));
  return { proposals, votes: v || {} };
}

export async function submitProposal({ token, id, text, address, signature }) {
  const pid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const body = JSON.stringify({ text, by: address.toLowerCase(), at: Date.now(), sig: signature });
  const r = await fetch(db(`workshop/proposals/${token.toLowerCase()}/${id}/${pid}`), {
    method: "PUT", body,
  });
  if (!r.ok) throw new Error("не удалось сохранить предложение");
  return pid;
}

export async function submitVote({ token, id, pid, address, signature }) {
  const body = JSON.stringify({ pid, at: Date.now(), sig: signature });
  const r = await fetch(db(`workshop/votes/${token.toLowerCase()}/${id}/${address.toLowerCase()}`), {
    method: "PUT", body,
  });
  if (!r.ok) throw new Error("не удалось сохранить голос");
}

/** Подпись сходится с адресом-ключом? Иначе строка мусорная и не считается. */
async function voteIsReal(token, id, addr, v) {
  if (!v || !v.sig || !v.pid) return false;
  try {
    return await verifyMessage({
      address: addr,
      message: voteMessage(token, id, v.pid),
      signature: v.sig,
    });
  } catch { return false; }
}

/**
 * Подсчёт: отбрасываем неподписанные строки, остальным берём баланс
 * из блокчейна и складываем по предложениям.
 */
export async function tally(token, id, votes) {
  const entries = Object.entries(votes || {});
  const checked = await Promise.all(
    entries.map(async ([addr, v]) => ((await voteIsReal(token, id, addr, v)) ? [addr, v] : null))
  );
  const valid = checked.filter(Boolean);

  const weights = await Promise.all(
    valid.map(async ([addr]) => {
      try {
        return await publicClient.readContract({
          address: token, abi: tokenAbi, functionName: "balanceOf", args: [addr],
        });
      } catch { return 0n; }
    })
  );

  const byProp = {};
  let total = 0n, voters = 0;
  valid.forEach(([, v], i) => {
    const w = weights[i];
    if (w <= 0n) return;            // нулевой баланс — голоса нет
    byProp[v.pid] = (byProp[v.pid] || 0n) + w;
    total += w; voters += 1;
  });

  const rejected = entries.length - valid.length;
  return { byProp, total, voters, rejected };
}

export async function balanceOf(token, address) {
  try {
    return await publicClient.readContract({
      address: token, abi: tokenAbi, functionName: "balanceOf", args: [address],
    });
  } catch { return 0n; }
}
