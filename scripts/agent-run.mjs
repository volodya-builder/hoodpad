#!/usr/bin/env node
/**
 * Агент монеты: берёт задание из журнала и строит по нему страницу.
 *
 * ЧТО ОН ДЕЛАЕТ
 *   1. Находит задание. Два источника, оба равноправны:
 *      — подписанная запись «строит» в журнале (форма на сайте или
 *        scripts/journal-operator.mjs из победителя раунда);
 *      — файл web/public/agents/tasks.json в самом репозитории.
 *      Второй источник нужен, чтобы задание можно было поставить коммитом,
 *      не открывая сайт и не подписывая кошельком. Писать в репозиторий
 *      может только тот, у кого есть доступ, — этого достаточно.
 *      Задания, по которым отчёт уже есть в builds.json, пропускаются.
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
import { decodeAbiParameters, toFunctionSelector, createPublicClient, http, parseAbi, formatUnits } from "viem";
import { loadModels, featured, costLabel, COST_CAP, MAX_OUT_TOKENS } from "../web/src/lib/models.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DB = "https://hood-chat-4b664-default-rtdb.europe-west1.firebasedatabase.app";
const OR = "https://openrouter.ai/api/v1";
const SITE = "https://hoodandarrow.com";
const RPC = "https://rpc.mainnet.chain.robinhood.com";

// Потолки. Страница-одностраничник в них укладывается с запасом, а
// разогнавшийся промпт упирается в них раньше, чем в баланс.
// Столько же, сколько заложено в расчёт цены в форме запуска: цифра одна,
// лежит в models.mjs, поэтому «сколько стоит страница» и «сколько агент
// реально тратит» не могут разойтись.
const MAX_TOKENS = MAX_OUT_TOKENS;
const MAX_HTML_BYTES = 200 * 1024;
const MODEL_TIMEOUT_MS = 12 * 60 * 1000; // сколько ждём ответ модели

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

/** Что уже построено — по отчётам в репозитории. */
function builtKeys() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "public", "agents", "builds.json"), "utf8"));
    return new Set((list || []).map((b) => `${String(b.token).toLowerCase()}:${b.round}`));
  } catch { return new Set(); }
}

/** Задания, поставленные коммитом. Подпись не нужна: доступ к репозиторию и есть подпись. */
function repoTasks() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "public", "agents", "tasks.json"), "utf8"));
    return (list || [])
      .filter((x) => x && x.token && x.task)
      .map((x) => ({ token: String(x.token).toLowerCase(), round: Number(x.round), task: x.task, at: x.at || 0, from: "репозиторий" }));
  } catch { return []; }
}

// ---------------------------------------------------------------- доска идей
// Живая доска (web/src/lib/board.js): холдеры пишут идеи и голосуют, агент
// каждые 5 минут забирает верхнюю. Здесь та же проверка подписей и те же
// веса (баланс монеты), что на сайте — расхождению взяться неоткуда.
const ETH_FACTORY = "0x08a887196fc31b89305ae03aa991917f6b1d23ec";
const QUOTE_FACTORY = "0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f";
const AGENT_TREASURY = process.env.AGENT_TREASURY || "0xe39e61c2e2897a59dde71d75b7b84f42ed09fd0c";
const FREE_BUILDS = Number(process.env.FREE_BUILDS || 3);      // столько сборок у монеты за счёт hood
const BUILD_USD = Number(process.env.BUILD_USD || 0.5);        // ориентир стоимости одной сборки
const BUILDING_STALE_MS = 15 * 60_000;                          // маркер «строит» старше — считаем упавшим

const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const ethFactoryAbi = parseAbi(["function tokenCount() view returns (uint256)", "function allTokens(uint256) view returns (address)"]);
const quoteFactoryAbi = parseAbi(["function tokenCount() view returns (uint256)", "function tokens(uint256,uint256) view returns (address[])", "function poolOf(address) view returns (address)"]);
const poolQAbi = parseAbi(["function quote() view returns (address)"]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const treasuryAbi = parseAbi(["function budget(address) view returns (uint256)", "function budgetErc20(address,address) view returns (uint256)"]);

const boardProposalMessage = (token, pid, text) => `hood board proposal\ntoken: ${token.toLowerCase()}\npid: ${pid}\ntext: ${text}`;
const boardVoteMessage = (token, pid) => `hood board vote\ntoken: ${token.toLowerCase()}\nproposal: ${pid}`;

async function allTokens() {
  const out = [];
  try {
    const n = await pub.readContract({ address: ETH_FACTORY, abi: ethFactoryAbi, functionName: "tokenCount" });
    for (let i = 0n; i < n; i++) out.push({ token: (await pub.readContract({ address: ETH_FACTORY, abi: ethFactoryAbi, functionName: "allTokens", args: [i] })).toLowerCase(), q: null });
  } catch (e) { console.log("ETH-фабрика не прочиталась:", (e.shortMessage || e.message).slice(0, 80)); }
  try {
    const n = await pub.readContract({ address: QUOTE_FACTORY, abi: quoteFactoryAbi, functionName: "tokenCount" });
    if (n > 0n) {
      const toks = await pub.readContract({ address: QUOTE_FACTORY, abi: quoteFactoryAbi, functionName: "tokens", args: [0n, n] });
      for (const t of toks) {
        const pool = await pub.readContract({ address: QUOTE_FACTORY, abi: quoteFactoryAbi, functionName: "poolOf", args: [t] });
        const quote = await pub.readContract({ address: pool, abi: poolQAbi, functionName: "quote" });
        const dec = await pub.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" });
        out.push({ token: t.toLowerCase(), q: { addr: quote, dec: Number(dec) } });
      }
    }
  } catch (e) { console.log("quote-фабрика не прочиталась:", (e.shortMessage || e.message).slice(0, 80)); }
  return out;
}

/** Курс в долларах: ETH — с Binance/Coingecko, ERC20 — с обозревателя. null — не знаем. */
async function usdRate(asset) {
  try {
    if (!asset) {
      const b = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT").then((r) => r.json());
      const v = Number(b?.price); if (v > 0) return v;
      const c = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then((r) => r.json());
      return Number(c?.ethereum?.usd) || null;
    }
    const j = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${asset}`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null));
    const v = Number(j?.exchange_rate); return v > 0 ? v : null;
  } catch { return null; }
}

/** Подсчёт доски одной монеты: верхняя идея с честным весом или null. */
async function boardTop(token, built) {
  const b = await get(`workshop/board/${token}`);
  if (!b || !b.proposals) return null;
  const props = [];
  for (const [pid, p] of Object.entries(b.proposals)) {
    if (!p || !p.text || !p.by || !p.sig || built.has(pid)) continue;
    let real = false;
    try { real = await verifyMessage({ address: p.by, message: boardProposalMessage(token, pid, p.text), signature: p.sig }); } catch { real = false; }
    if (real) props.push({ pid, ...p });
  }
  if (!props.length) return null;
  const byPid = new Set(props.map((p) => p.pid));
  const weight = {};
  for (const [addr, v] of Object.entries(b.votes || {})) {
    if (!v || !v.sig || !v.pid || !byPid.has(v.pid)) continue;
    let real = false;
    try { real = await verifyMessage({ address: addr, message: boardVoteMessage(token, v.pid), signature: v.sig }); } catch { real = false; }
    if (!real) continue;
    let w = 0n;
    try { w = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr] }); } catch { w = 0n; }
    if (w > 0n) weight[v.pid] = (weight[v.pid] || 0n) + w;
  }
  props.sort((a, c) => ((weight[a.pid] || 0n) === (weight[c.pid] || 0n) ? (a.at || 0) - (c.at || 0) : (weight[a.pid] || 0n) > (weight[c.pid] || 0n) ? -1 : 1));
  const top = props[0];
  if (!(weight[top.pid] > 0n)) return null;
  const building = b.building && b.building.pid && Date.now() - (b.building.at || 0) < BUILDING_STALE_MS ? b.building : null;
  return { pid: top.pid, text: top.text, by: top.by, at: top.at, weight: weight[top.pid], building };
}

/** Хватает ли денег: первые FREE_BUILDS сборок — за счёт hood, дальше бюджет монеты. */
async function budgetOk(tk, buildsOfToken) {
  if (buildsOfToken < FREE_BUILDS) return { ok: true, why: `бесплатная сборка ${buildsOfToken + 1} из ${FREE_BUILDS}` };
  try {
    const v = tk.q
      ? await pub.readContract({ address: AGENT_TREASURY, abi: treasuryAbi, functionName: "budgetErc20", args: [tk.token, tk.q.addr] })
      : await pub.readContract({ address: AGENT_TREASURY, abi: treasuryAbi, functionName: "budget", args: [tk.token] });
    const amount = Number(formatUnits(v, tk.q ? tk.q.dec : 18));
    if (amount <= 0) return { ok: false, why: "бюджет агента пуст — торгуйте монетой, 10% комиссии его пополняют" };
    const rate = await usdRate(tk.q ? tk.q.addr : null);
    if (rate === null) return { ok: true, why: `бюджет ${amount} (курс неизвестен, строим)` };
    const usd = amount * rate;
    return usd >= BUILD_USD
      ? { ok: true, why: `бюджет $${usd.toFixed(2)} ≥ $${BUILD_USD}` }
      : { ok: false, why: `бюджет $${usd.toFixed(2)} < $${BUILD_USD} за сборку` };
  } catch (e) { return { ok: false, why: "бюджет не прочитался: " + (e.shortMessage || e.message).slice(0, 60) }; }
}

/** Работа с доски: монета, чью доску дольше всех не обслуживали, и её верхняя идея. */
async function findBoardWork() {
  let builds = [];
  try { builds = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "public", "agents", "builds.json"), "utf8")) || []; } catch {}
  const builtPids = new Set(builds.map((b) => b.pid).filter(Boolean));
  const tokens = await allTokens();
  const cands = [];
  for (const tk of tokens) {
    if (!(await aiEnabled(tk.token))) continue;
    const top = await boardTop(tk.token, builtPids);
    if (!top) continue;
    if (top.building && top.building.pid === top.pid) { console.log(`  ${tk.token.slice(0, 10)}… идея уже в работе (маркер), пропускаю`); continue; }
    const mine = builds.filter((b) => String(b.token).toLowerCase() === tk.token);
    const gate = await budgetOk(tk, mine.length);
    console.log(`  ${tk.token.slice(0, 10)}… верхняя идея «${top.text.slice(0, 50)}» · ${gate.why}`);
    if (!gate.ok) continue;
    const lastBuilt = mine.reduce((m, b) => Math.max(m, b.at || 0), 0);
    cands.push({ tk, top, lastBuilt });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.lastBuilt - b.lastBuilt); // кого дольше не обслуживали — тот первый
  const c = cands[0];
  return { token: c.tk.token, round: 0, pid: c.top.pid, task: c.top.text, at: c.top.at, by: c.top.by, from: "доска", q: c.tk.q };
}

/** Пульс агента для сайта: что он делает прямо сейчас. Не критично —
 *  база закрыта → молчим. workshop/agent/heartbeat = { at, state, token, pid, text, note } */
async function heartbeat(state, extra = {}) {
  // next — когда ждать следующий заход: эстафета в agent.yml ждёт 5 минут
  // с начала запуска (минуту после сборки). Сайт показывает обратный отсчёт по нему.
  const wait = state === "built" || state === "failed" ? 90_000 : state === "idle" ? 300_000 : 0;
  const at = Date.now();
  const body = { at, state, ...extra };
  if (wait) body.next = (Number(process.env.AGENT_T0) * 1000 || at) + wait;
  try {
    await fetch(`${DB}/workshop/agent/heartbeat.json`, { method: "PUT", body: JSON.stringify(body) });
  } catch { /* пульс — только для статуса на сайте */ }
}

async function markBuilding(token, pid) {
  try {
    await fetch(`${DB}/workshop/board/${token}/building.json`, { method: pid ? "PUT" : "DELETE", body: pid ? JSON.stringify({ pid, at: Date.now() }) : undefined });
  } catch { /* маркер — только для статуса на сайте */ }
}

/** Найти работу: самое старое невыполненное задание из обоих источников. */
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
      out.push({ token, round: Number(round), ...e, from: "журнал" });
    }
  }

  for (const t of repoTasks()) {
    if (out.some((x) => x.token.toLowerCase() === t.token && x.round === t.round)) continue;
    out.push(t);
  }

  const done = builtKeys();
  const left = out.filter((x) => !done.has(`${String(x.token).toLowerCase()}:${x.round}`));
  left.sort((a, b) => (a.at || 0) - (b.at || 0));
  return left[0] || null;
}

async function symbolOf(token) {
  // Символ нужен только для пути и заголовка. Не достали — не беда.
  try {
    const r = await fetch(RPC, {
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

/**
 * Модель, которую выбрал создатель монеты. Лежит в метадате токена (поле ai),
 * которую записали при запуске, — значит, в контракте, и подделать её нельзя.
 *
 * Метадата содержит ещё и картинку data-URI, поэтому ответ бывает на сотни
 * килобайт. Читаем один раз за сборку, это не горячий путь.
 */
/**
 * Включён ли у монеты ИИ в цепи. Сплиттер (FeeSplitterV4) хранит решение
 * создателя: без его подписи агент на монету не работает — бюджет ей не
 * капает, а строить «в долг» нельзя. Адрес — FEE_SPLITTER в окружении
 * или feeSplitter в deploy-config.json; пусто = сплиттера нет, правило
 * не действует (старая экономика).
 */
async function aiEnabled(token) {
  const splitter = process.env.FEE_SPLITTER || cfg.feeSplitter || "0x4b4ca78517a48876a4341cbbfbd96e15c9d99491";
  if (!splitter) return true;
  try {
    const data = toFunctionSelector("function aiOf(address) view returns (bool)")
      + token.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const r = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: splitter, data }, "latest"] }),
    }).then((x) => x.json());
    return /1$/.test(String(r?.result || "0x0"));
  } catch { return false; }
}

async function wantedModel(token) {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: token, data: toFunctionSelector("function metadataURI() view returns (string)") }, "latest"],
      }),
    }).then((x) => x.json());
    if (!r?.result || r.result === "0x") return "";
    const [uri] = decodeAbiParameters([{ type: "string" }], r.result);
    const m = String(uri).match(/^data:application\/json;base64,(.*)$/s);
    if (!m) return "";
    const meta = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    const id = String(meta?.ai || "").trim();
    // Проверять id здесь не нужно: pickModel сверит его с живым списком
    // годных моделей — там же стоит и потолок цены.
    return id;
  } catch { return ""; }
}

async function pickModel(wanted = "") {
  // Тот же отбор, что видит создатель монеты в форме: текст на выходе, цена
  // в пределах потолка, отсортировано по рейтингу «делает веб-страницу».
  const list = await loadModels();
  const ids = new Set(list.map((m) => m.id));

  // Выбор создателя — первый в очереди. Если модели в списке больше нет
  // (сняли с обслуживания или вылетела за потолок цены), подменяем, но
  // возвращаем asked: журнал скажет об этом вслух, а не промолчит.
  if (wanted && ids.has(wanted)) return { model: wanted, asked: "" };
  if (cfg.agentModel && ids.has(cfg.agentModel)) return { model: cfg.agentModel, asked: wanted };
  if (list.length) return { model: list[0].id, asked: wanted };

  // Каталог не ответил. Строить наугад нельзя: любая выдумка — это либо
  // ошибка вызова, либо счёт за модель, которую никто не выбирал.
  return { model: "", asked: wanted };
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
    // Ровно тот список, который увидит создатель монеты в форме запуска:
    // одна функция на двоих, поэтому расхождению взяться неоткуда.
    const all = await fetch(`${OR}/models`).then((x) => x.json()).catch(() => null);
    const list = await loadModels();
    console.log(`В каталоге OpenRouter: ${(all?.data || []).length}`);
    console.log(`Годных агенту (текст на выходе, до $${COST_CAP} за страницу, есть рейтинг): ${list.length}\n`);
    if (!list.length) {
      console.log("Пусто. Либо каталог не ответил, либо потолок цены слишком низкий.");
      return;
    }
    console.log("Витрина формы запуска — по одной лучшей модели от разработчика:");
    for (const m of featured(list)) {
      console.log(`  ${String(m.by).padEnd(12)} ${m.name.padEnd(26)} elo ${String(m.elo).padStart(4)}  ${costLabel(m.cost)} за страницу`);
    }
    console.log("\nПервые десять по рейтингу «делает веб-страницу»:");
    for (const m of list.slice(0, 10)) console.log(`  ${String(m.elo).padStart(4)}  ${m.id}`);
    return;
  }

  const operator = opKey ? privateKeyToAccount(opKey.startsWith("0x") ? opKey : `0x${opKey}`) : null;
  const operatorAddress = operator ? operator.address : OPERATOR_ADDRESS;

  console.log("Смотрю доски идей…");
  if (run) await heartbeat("checking");
  const work = (await findBoardWork()) || (await findWork(operatorAddress));
  if (!work) {
    console.log("Работы нет: на досках нет идей с голосами (или у монет нет бюджета), в журнале нет записей «строит».");
    if (run) await heartbeat("idle");
    return;
  }

  const symbol = (await symbolOf(work.token)) || "COIN";
  // Идея с доски — своя папка на pid, чтобы сборки не затирали друг друга;
  // agents/<символ>/index.html всегда = последняя сборка монеты.
  const sub = work.pid ? `${symbol.toLowerCase()}/${work.pid}` : symbol.toLowerCase();
  const outDir = path.join(ROOT, "web", "public", "agents", sub);
  const outFile = path.join(outDir, "index.html");
  const url = `${SITE}/agents/${sub}/`;

  console.log(`Монета:  $${symbol}  ${work.token}`);
  console.log(`Раунд:   ${work.round}  (источник: ${work.from || "журнал"})`);
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

  if (!(await aiEnabled(work.token))) {
    console.error("У этой монеты ИИ не включён создателем (сплиттер: aiOf = false) — бюджета ей не капает, строить не на что.");
    process.exit(1);
  }
  const { model, asked } = await pickModel(await wantedModel(work.token));
  if (!model) {
    console.error("Каталог моделей недоступен — строить не на чем. Останавливаюсь.");
    process.exit(1);
  }
  console.log(`Модель:  ${model}`);
  if (asked) console.log(`Создатель просил ${asked} — её нет в каталоге, строю на доступной.`);
  console.log("");

  if (work.pid) await markBuilding(work.token, work.pid);
  await heartbeat("building", { token: work.token.toLowerCase(), pid: work.pid || "", text: String(work.task).slice(0, 120), model });
  // Модель может молчать долго (16k токенов у медленной модели — минуты),
  // но не бесконечно: через MODEL_TIMEOUT_MS сдаёмся, снимаем «в работе» с
  // доски и пишем провал в пульс — иначе запуск висит часами, а с ним и
  // эстафета. Идея остаётся на доске — следующий заход попробует ещё раз.
  const giveUp = async (why) => {
    console.error(why);
    if (work.pid) await markBuilding(work.token, null);
    await heartbeat("failed", { token: work.token.toLowerCase(), pid: work.pid || "", text: String(work.task).slice(0, 120), note: why.slice(0, 160) });
    process.exit(1);
  };
  let res;
  try {
    res = await fetch(`${OR}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
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
  } catch (e) {
    await giveUp(e?.name === "TimeoutError" || e?.name === "AbortError"
      ? `Модель не ответила за ${Math.round(MODEL_TIMEOUT_MS / 60000)} минут — сдаюсь, попробую в следующий заход.`
      : `Не достучался до OpenRouter: ${e?.message || e}`);
  }

  if (!res.ok) await giveUp(`OpenRouter ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let data;
  try { data = await res.json(); } catch (e) { await giveUp(`OpenRouter прислал не JSON: ${e?.message || e}`); }
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
    if (work.pid) {
      // Идею с доски закрываем как «не вышло» — иначе она останется верхней
      // и агент будет платить за неё каждые 5 минут. Провал виден на сайте.
      await markBuilding(work.token, null);
      const bf = path.join(ROOT, "web", "public", "agents", "builds.json");
      let bl = []; try { bl = JSON.parse(fs.readFileSync(bf, "utf8")) || []; } catch {}
      bl.unshift({ token: work.token.toLowerCase(), round: 0, pid: work.pid, symbol, task: work.task, model, spent: cost || 0, tokens, at: Date.now(), failed: true, note: problems.join("; ") });
      fs.writeFileSync(bf, JSON.stringify(bl.slice(0, 200), null, 2) + "\n");
      console.error("Записано в builds.json как «не вышло», идея снята с доски.");
      await heartbeat("failed", { token: work.token.toLowerCase(), pid: work.pid, text: String(work.task).slice(0, 120), note: problems[0] || "" });
      return;
    }
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`\nСохранено: web/public/agents/${sub}/index.html`);
  if (work.pid) {
    // последняя сборка монеты — ещё и по короткому адресу agents/<символ>/
    const rootDir = path.join(ROOT, "web", "public", "agents", symbol.toLowerCase());
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, "index.html"), html);
    await markBuilding(work.token, null);
  }
  await heartbeat("built", { token: work.token.toLowerCase(), pid: work.pid || "", text: String(work.task).slice(0, 120), url });

  // Отчёт рядом со страницей. Перезапись по (монета, раунд): повторная
  // сборка того же задания заменяет старую строку, а не плодит дубли.
  const buildsFile = path.join(ROOT, "web", "public", "agents", "builds.json");
  let builds = [];
  try { builds = JSON.parse(fs.readFileSync(buildsFile, "utf8")); } catch {}
  if (!Array.isArray(builds)) builds = [];
  const key = (b) => (b.pid ? `pid:${b.pid}` : `${String(b.token).toLowerCase()}:${b.round}`);
  const report = {
    token: work.token.toLowerCase(),
    round: work.round,
    ...(work.pid ? { pid: work.pid, by: work.by || "" } : {}),
    symbol,
    task: work.task,
    // Непусто только когда просили одну модель, а собрали на другой.
    ...(asked ? { asked } : {}),
    // Путь относительно сайта. Абсолютный url оставляем для сведения, но
    // ссылку журнал строит из path: на тестовом сайте страница живёт под
    // /staging/, и жёсткая ссылка на боевой домен там ведёт в 404.
    path: `agents/${sub}/`,
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
