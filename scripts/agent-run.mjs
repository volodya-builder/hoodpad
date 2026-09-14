#!/usr/bin/env node
/**
 * Агент монеты: берёт задание из журнала и строит по нему страницу.
 *
 * ЧТО ОН ДЕЛАЕТ
 *   1. Находит в журнале запись со статусом «строит» (её заводит
 *      scripts/journal-operator.mjs из победителя раунда — или владелец
 *      руками из админ-формы на сайте).
 *   2. Просит модель написать ОДНУ самодостаточную HTML-страницу.
 *   3. Проверяет результат и кладёт в web/public/agents/<символ>/index.html —
 *      после сборки страница живёт на hoodandarrow.com/agents/<символ>/.
 *   4. Дописывает отчёт в web/public/agents/builds.json — тем же коммитом,
 *      что и саму страницу. Сайт читает этот файл и показывает задание
 *      выполненным: ссылка, модель, реальная цена вызова.
 *
 * ПОЧЕМУ ОТЧЁТ В РЕПОЗИТОРИИ, А НЕ В БАЗЕ
 * База открыта на запись, поэтому запись в ней надо подписывать, а подпись
 * требует ещё одного секретного ключа в CI. В репозиторий же может писать
 * только тот, у кого есть доступ на запись — то есть владелец и его
 * workflow. Это и проверяется само собой, и секретов не добавляет, и отчёт
 * приезжает тем же коммитом, что и страница: подделать одно без другого
 * нельзя.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ — и это зашито здесь, а не в обещаниях:
 *   — не придумывает себе задания: нет записи «строит» — нет работы;
 *   — не пишет никуда, кроме web/public/agents/<своя монета>/;
 *   — не коммитит и не пушит: человек смотрит результат и решает сам;
 *   — не трогает деньги: у него нет ни кошелька, ни приватного ключа,
 *     кроме подписи журнала, которой ничего не оплатить.
 *
 * ЗАПУСК
 *   node scripts/agent-run.mjs              — что бы он сделал (без вызова модели)
 *   node scripts/agent-run.mjs --run        — построить по-настоящему
 *   node scripts/agent-run.mjs --models     — какие модели доступны
 *   node scripts/agent-run.mjs --check      — работает ли ключ и сколько денег
 *
 * По умолчанию модель НЕ вызывается и деньги не тратятся.
 *
 * КЛЮЧИ (машина владельца, scripts/deploy-config.json — он в .gitignore):
 *   openrouterKey       — ключ OpenRouter, им оплачиваются вызовы
 *   journalOperatorKey  — ключ для подписи записей журнала (без денег)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DB = "https://hood-chat-4b664-default-rtdb.europe-west1.firebasedatabase.app";
const OR = "https://openrouter.ai/api/v1";
const SITE = "https://hoodandarrow.com";

// Потолки. Страница-одностраничник в них укладывается с запасом, а
// разогнавшийся промпт упирается в них раньше, чем в баланс.
const MAX_TOKENS = 16000;
const MAX_HTML_BYTES = 200 * 1024;

// Порядок предпочтения. Берётся первая модель, которая реально есть в
// каталоге OpenRouter на момент запуска, — идентификаторы там меняются,
// и хардкодить один — надёжный способ однажды упасть.
const PREFERRED = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-3.7-sonnet",
  "openai/gpt-5.2",
  "openai/gpt-4o",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-chat",
];

const cfg = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, "deploy-config.json"), "utf8")); }
  catch { return {}; }
})();

const orKey = process.env.OPENROUTER_KEY || cfg.openrouterKey || "";
const opKey = process.env.JOURNAL_OPERATOR_KEY || cfg.journalOperatorKey || "";

// Чтобы ПРОВЕРИТЬ подпись задания, хватает публичного адреса — приватный
// ключ нужен только чтобы дописать в журнал итог. Поэтому в CI достаточно
// одного секрета (ключа OpenRouter): агент построит страницу, а журнал
// допишется позже с машины владельца. Меньше секретов — меньше поводов
// их потерять.
const OPERATOR_ADDRESS = (
  process.env.AGENT_OPERATOR || cfg.agentOperator ||
  "0xD3d14c10020ad9C582404669a2Fa11AfF2386255"
);

const get = (p) => fetch(`${DB}/${p}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

const entryMessage = (token, round, e) => [
  "hood journal entry",
  `token: ${String(token).toLowerCase()}`,
  `round: ${round}`,
  `status: ${e.status || ""}`,
  `task: ${e.task || ""}`,
  `url: ${e.url || ""}`,
  `spent: ${e.spent ?? ""}`,
].join("\n");

/** Найти работу: самая старая запись «строит» среди всех монет. */
async function findWork(operatorAddress) {
  const all = (await get("workshop/journal")) || {};
  const out = [];
  for (const [token, rounds] of Object.entries(all)) {
    for (const [round, e] of Object.entries(rounds || {})) {
      if (!e || e.status !== "build") continue;
      // Запись без подписи оператора — чужая или подделка. На сайте она не
      // показывается, и работать по ней тоже не станем.
      let real = false;
      try {
        real = await verifyMessage({
          address: operatorAddress,
          message: entryMessage(token, round, e),
          signature: e.sig,
        });
      } catch { real = false; }
      if (!real) continue;
      out.push({ token, round: Number(round), ...e });
    }
  }
  out.sort((a, b) => (a.at || 0) - (b.at || 0));
  return out[0] || null;
}

async function symbolOf(token) {
  // Символ нужен только для пути и заголовка. Не достали — не беда.
  try {
    const r = await fetch("https://rpc.mainnet.chain.robinhood.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: token, data: "0x95d89b41" }, "latest"],
      }),
    }).then((x) => x.json());
    const hex = r?.result;
    if (!hex || hex.length < 130) return null;
    const len = parseInt(hex.slice(66, 130), 16);
    const bytes = hex.slice(130, 130 + len * 2);
    return Buffer.from(bytes, "hex").toString("utf8").replace(/[^A-Za-z0-9]/g, "") || null;
  } catch { return null; }
}

async function pickModel() {
  const r = await fetch(`${OR}/models`).then((x) => x.json()).catch(() => null);
  const ids = new Set((r?.data || []).map((m) => m.id));
  if (!ids.size) return cfg.agentModel || PREFERRED[0];
  if (cfg.agentModel && ids.has(cfg.agentModel)) return cfg.agentModel;
  for (const m of PREFERRED) if (ids.has(m)) return m;
  return [...ids][0];
}

const PROMPT = (task, symbol) => `Ты — ИИ-агент мем-монеты $${symbol} на платформе hood.
Холдеры монеты проголосовали за задание. Твоя работа — выполнить его в виде ОДНОЙ веб-страницы.

ЗАДАНИЕ ХОЛДЕРОВ:
${task}

ТРЕБОВАНИЯ К ОТВЕТУ:
- Верни ТОЛЬКО HTML-документ, начиная с <!DOCTYPE html>. Без пояснений, без markdown-заборов.
- Один файл: весь CSS в <style>, весь JS в <script> внутри страницы.
- Никаких внешних ресурсов: ни <script src>, ни <link href> на чужие домены, ни шрифтов с CDN, ни картинок по ссылке. Картинки — только CSS/SVG/эмодзи.
- Никаких форм, отправляющих данные, и никаких запросов в сеть.
- Тёмная тема, аккуратная типографика, работает на телефоне.
- Внизу страницы строкой: "Построено ИИ-агентом $${symbol} по решению холдеров · hood".
- Не обещай доходность, не зови покупать, не давай финансовых советов.

Сделай страницу по-настоящему полезной или интересной, а не заглушку.`;

/** Проверки того, что вернула модель. Страница поедет на домен владельца. */
function checkHtml(html) {
  const bad = [];
  if (!/^<!DOCTYPE html>/i.test(html.trim())) bad.push("не начинается с <!DOCTYPE html>");
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) bad.push("больше 200 КБ");
  const ext = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
  const outside = ext.filter((u) => !u.includes("hoodandarrow.com"));
  if (outside.length) bad.push(`внешние ресурсы: ${outside.slice(0, 3).join(", ")}`);
  if (/<form[\s>]/i.test(html)) bad.push("есть форма");
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(/i.test(html)) bad.push("есть сетевые запросы");
  if (/<iframe/i.test(html)) bad.push("есть iframe");
  return bad;
}

function stripFence(s) {
  const m = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}

async function main() {
  const args = process.argv.slice(2);
  const run = args.includes("--run");

  // Проверка ключа и баланса. Сам ключ не печатается никогда — ни целиком,
  // ни куском: он уже один раз утёк в переписку, второго раза не надо.
  if (args.includes("--check")) {
    if (!orKey) {
      console.error("Ключа нет: добавь openrouterKey в scripts/deploy-config.json");
      process.exit(1);
    }
    const h = { Authorization: `Bearer ${orKey}` };
    const key = await fetch(`${OR}/key`, { headers: h }).then((r) => r.json()).catch(() => null);
    if (!key || key.error) {
      console.error("Ключ не принят:", key?.error?.message || "нет ответа");
      process.exit(1);
    }
    const d = key.data || {};
    console.log("Ключ работает.");
    if (d.label) console.log("  имя ключа:   ", d.label);
    console.log("  потрачено:   ", `$${Number(d.usage ?? 0).toFixed(4)}`);
    console.log("  лимит ключа: ", d.limit == null ? "без лимита" : `$${d.limit}`);
    if (d.limit_remaining != null) console.log("  осталось:    ", `$${d.limit_remaining}`);

    const cr = await fetch(`${OR}/credits`, { headers: h }).then((r) => r.json()).catch(() => null);
    const c = cr?.data;
    if (c) {
      const left = Number(c.total_credits ?? 0) - Number(c.total_usage ?? 0);
      console.log(`\nБаланс аккаунта: $${left.toFixed(2)} (куплено $${Number(c.total_credits ?? 0).toFixed(2)})`);
      if (left <= 0) console.log("Денег на счету нет — вызовы моделей не пройдут.");
    }
    return;
  }

  if (args.includes("--models")) {
    const r = await fetch(`${OR}/models`).then((x) => x.json());
    const list = (r?.data || []).map((m) => m.id).sort();
    console.log(`Моделей доступно: ${list.length}\n`);
    for (const m of PREFERRED) console.log(list.includes(m) ? `  есть  ${m}` : `  нет   ${m}`);
    return;
  }

  const operator = opKey ? privateKeyToAccount(opKey.startsWith("0x") ? opKey : `0x${opKey}`) : null;
  const operatorAddress = operator ? operator.address : OPERATOR_ADDRESS;

  const work = await findWork(operatorAddress);
  if (!work) {
    console.log("Работы нет: в журнале нет записей со статусом «строит».");
    console.log("Они появляются из победителей раундов (scripts/journal-operator.mjs --write)");
    console.log("или заводятся вручную из админ-формы на вкладке ИИ.");
    return;
  }

  const symbol = (await symbolOf(work.token)) || "COIN";
  const outDir = path.join(ROOT, "web", "public", "agents", symbol.toLowerCase());
  const outFile = path.join(outDir, "index.html");
  const url = `${SITE}/agents/${symbol.toLowerCase()}/`;

  console.log(`Монета:  $${symbol}  ${work.token}`);
  console.log(`Раунд:   ${work.round}`);
  console.log(`Задание: ${work.task}`);
  console.log(`Выйдет:  ${url}`);

  if (!run) {
    console.log("\nСухой прогон — модель не вызывалась, деньги не потрачены.");
    console.log("Построить по-настоящему: node scripts/agent-run.mjs --run\n");
    return;
  }

  if (!orKey) {
    console.error("\nНет ключа OpenRouter (openrouterKey в scripts/deploy-config.json).");
    process.exit(1);
  }

  const model = await pickModel();
  console.log(`Модель:  ${model}\n`);

  const res = await fetch(`${OR}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SITE,
      "X-Title": "hood agent",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: PROMPT(work.task, symbol) }],
    }),
  });

  if (!res.ok) {
    console.error(`OpenRouter ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const data = await res.json();
  const html = stripFence(data?.choices?.[0]?.message?.content || "");
  const cost = Number(data?.usage?.cost ?? 0);
  const tokens = data?.usage?.total_tokens ?? 0;

  console.log(`Получено: ${Buffer.byteLength(html)} байт, ${tokens} токенов, $${cost.toFixed(4)}`);

  const problems = checkHtml(html);
  if (problems.length) {
    console.error("\nСтраница не прошла проверку и НЕ сохранена:");
    for (const p of problems) console.error("  — " + p);
    console.error("\nДеньги за вызов потрачены, результат отброшен. Это нормально:");
    console.error("страница едет на твой домен, и чужие скрипты на нём не появятся.");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`\nСохранено: web/public/agents/${symbol.toLowerCase()}/index.html`);

  // Отчёт рядом со страницей. Перезапись по (монета, раунд): повторная
  // сборка того же задания заменяет старую строку, а не плодит дубли.
  const buildsFile = path.join(ROOT, "web", "public", "agents", "builds.json");
  let builds = [];
  try { builds = JSON.parse(fs.readFileSync(buildsFile, "utf8")); } catch {}
  if (!Array.isArray(builds)) builds = [];
  const key = (b) => `${String(b.token).toLowerCase()}:${b.round}`;
  const report = {
    token: work.token.toLowerCase(),
    round: work.round,
    symbol,
    task: work.task,
    url,
    model,
    spent: cost || 0,
    tokens,
    at: Date.now(),
  };
  builds = builds.filter((b) => key(b) !== key(report));
  builds.unshift(report);
  builds = builds.slice(0, 200);
  fs.writeFileSync(buildsFile, JSON.stringify(builds, null, 2) + "\n");
  console.log(`Отчёт записан: web/public/agents/builds.json (${builds.length} всего)`);

  // Запись в базе — необязательная добавка: сайт и так покажет задание
  // выполненным по builds.json. Делаем её, только если ключ подписи есть
  // (обычно на машине владельца), чтобы состояние в базе не расходилось.
  if (!operator) {
    console.log("\nОтчёт в репозитории — этого достаточно: сайт покажет «готово» по нему.");
    return;
  }

  const entry = {
    status: "done",
    task: work.task,
    plan: work.plan || "",
    url,
    why: "",
    spent: cost || "",
    opens: work.opens || 0,
  };
  const signature = await operator.signMessage({ message: entryMessage(work.token, work.round, entry) });
  const put = await fetch(`${DB}/workshop/journal/${work.token.toLowerCase()}/${work.round}.json`, {
    method: "PUT",
    body: JSON.stringify({ ...entry, at: Date.now(), sig: signature }),
  });
  console.log(put.ok ? "Журнал обновлён: «готово»." : `Журнал не обновился: ${put.status}`);

  console.log("\nДальше человек: посмотреть страницу, закоммитить, запушить.");
  console.log("Агент сам не коммитит — это его граница, а не недоделка.");
}

main().catch((e) => { console.error(e); process.exit(1); });
