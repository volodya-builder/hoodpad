// Журнал агента: что было заказано, что построено, сколько это стоило.
//
// Витрина всей затеи. Голосование показывает намерения, журнал — результат,
// и по нему платформу будут судить. Поэтому здесь два правила, и оба важнее
// красоты страницы.
//
// ПРАВИЛО 1. Провалы публикуются наравне с удачами. Соблазн показывать
// только хорошее убивает доверие быстрее, чем сами неудачи: любой сверит
// число заданий с числом результатов и всё поймёт. К тому же провал —
// это сигнал холдерам, что заказывать дальше, и молчание его стирает.
//
// ПРАВИЛО 2. Запись подписана. База открыта на запись (как и в workshop.js),
// значит подделать запись «агент построил, потрачено $3» может кто угодно.
// Поэтому каждую запись подписывает кошелёк оператора, а сайт при чтении
// проверяет подпись и молча выбрасывает всё, что не сошлось. Число
// выброшенных показывается — врать про их отсутствие не будем.
//
// Записи пока кладёт владелец руками (scripts/journal-write.mjs). Когда
// появится агент, писать будет он — формат не изменится.

import { verifyMessage } from "viem";
import { CHAT_DB_URL, AGENT_OPERATOR } from "./config.js";

const db = (path) => `${CHAT_DB_URL}/${path}.json`;
const ok = (r) => (r.ok ? r.json() : null);

/** Статусы записи. Порядок = порядок жизни задания. */
export const STATUS = ["plan", "build", "done", "failed"];

export const STATUS_LABEL = {
  plan: "План",
  build: "Строит",
  done: "Готово",
  failed: "Не вышло",
};

/**
 * Текст, который подписывает оператор. Считается из содержимого, поэтому
 * поправить сумму или подменить ссылку в готовой записи нельзя — подпись
 * перестанет сходиться, и строка исчезнет со страницы.
 *
 * Меняешь формат — старые записи отвалятся. Тогда нужен version-префикс.
 */
export function entryMessage(token, round, e) {
  return [
    "hood journal entry",
    `token: ${String(token).toLowerCase()}`,
    `round: ${round}`,
    `status: ${e.status || ""}`,
    `task: ${e.task || ""}`,
    `url: ${e.url || ""}`,
    `spent: ${e.spent ?? ""}`,
  ].join("\n");
}

async function entryIsReal(token, round, e) {
  if (!e || !e.sig || !e.status) return false;
  if (!AGENT_OPERATOR) return false;
  try {
    return await verifyMessage({
      address: AGENT_OPERATOR,
      message: entryMessage(token, round, e),
      signature: e.sig,
    });
  } catch { return false; }
}

/**
 * Сохранить запись. Подпись делается кошельком в браузере — приватный ключ
 * никуда не уходит и здесь его никто не спрашивает.
 *
 * Ключ записи — номер раунда, поэтому повторное сохранение того же раунда
 * перезаписывает запись, а не плодит дубли: задание проходит путь
 * plan → build → done, и это одна и та же строка в разных состояниях.
 */
export async function saveEntry({ token, round, entry, signature }) {
  const body = JSON.stringify({ ...entry, at: Date.now(), sig: signature });
  const r = await fetch(db(`workshop/journal/${String(token).toLowerCase()}/${round}`), {
    method: "PUT", body,
  });
  if (!r.ok) throw new Error("не удалось сохранить запись");
}

/** Записи одной монеты, новые сверху. */
export async function loadTokenJournal(token) {
  if (!CHAT_DB_URL) return { rows: [], rejected: 0 };
  const raw = await fetch(db(`workshop/journal/${String(token).toLowerCase()}`))
    .then(ok).catch(() => null);
  const entries = Object.entries(raw || {});

  const checked = await Promise.all(
    entries.map(async ([round, e]) =>
      (await entryIsReal(token, round, e)) ? { ...e, round: Number(round), token } : null
    )
  );
  const rows = checked.filter(Boolean);
  rows.sort((a, b) => b.round - a.round);
  return { rows, rejected: entries.length - rows.length };
}

/**
 * Записи по всем монетам сразу — лента для вкладки «Мастерская».
 *
 * Читаем последовательно и понемногу, как в Queue: каждая монета это
 * запрос к базе и проверка подписей, параллелить их незачем.
 */
export async function loadJournal(tokens, limit = 40) {
  const out = [];
  let rejected = 0;
  for (const tk of (tokens || []).slice(0, 30)) {
    const addr = tk.token || tk;
    try {
      const r = await loadTokenJournal(addr);
      rejected += r.rejected;
      for (const row of r.rows) out.push({ ...row, tk: tk.token ? tk : null });
    } catch { /* одна монета не должна ронять ленту */ }
  }
  out.sort((a, b) => (b.at || 0) - (a.at || 0) || b.round - a.round);
  return { rows: out.slice(0, limit), rejected };
}

/**
 * Сводка над лентой. Считается из тех же записей, что показаны ниже, —
 * чтобы цифру в шапке можно было проверить пересчётом строк, а не верить.
 */
export function summarize(rows) {
  const s = { tasks: 0, done: 0, failed: 0, building: 0, spent: 0 };
  for (const r of rows || []) {
    s.tasks += 1;
    if (r.status === "done") s.done += 1;
    else if (r.status === "failed") s.failed += 1;
    else s.building += 1;
    const v = Number(r.spent);
    if (Number.isFinite(v)) s.spent += v;
  }
  return s;
}

/** Деньги показываем так же, как их считает OpenRouter, — в долларах. */
export const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
};
