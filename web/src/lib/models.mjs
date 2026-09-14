// Модели, на которых может работать ИИ монеты.
//
// ПОЧЕМУ СПИСОК НЕ ВБИТ РУКАМИ. Первая версия этого файла была списком из
// четырнадцати моделей, набранных по памяти. На момент, когда её собрали,
// в каталоге OpenRouter не было НИ ОДНОЙ из них: версии сменились. Вбитый
// список — это обещание, которое протухает молча, и человек узнаёт об этом
// в тот день, когда его монета не собралась.
//
// Поэтому список берётся живым, прямо из каталога OpenRouter, тем же адресом,
// которым пользуется агент. Ключ для этого не нужен: /models открыт.
//
// ЧЕМ МЕРЯЕМ. В каталоге у моделей есть рейтинг design_arena по категориям.
// Нас интересует ровно одна — website: «насколько хорошо модель делает
// веб-страницу». Агент делает ровно это. Брать «самую дорогую» нельзя (самой
// дорогой у OpenAI оказывается старая o1-pro за $600 за миллион), «самую
// новую» — тоже (у Meta самой новой оказывается Llama Guard, классификатор,
// который вообще не для того). Рейтинг именно по нужной работе честнее обоих.
//
// ПОТОЛОК ЦЕНЫ. За вызов платит платформа, а модель выбирает создатель монеты.
// Считаем в том, за что платим, — в стоимости одной построенной страницы.
// Всё дороже доллара за страницу в список не попадает: ни в форму, ни агенту.
//
// Один файл на двоих: его читает форма запуска (web/src/pages/Create.jsx) и
// он же лежит в основе выбора агента (scripts/agent-run.mjs). Предложить
// человеку модель, которую агент не сможет вызвать, неоткуда.

export const OR_MODELS = "https://openrouter.ai/api/v1/models";

// Сколько токенов агент тратит на одну страницу. Отсюда же берёт свой
// потолок scripts/agent-run.mjs — чтобы цена в форме считалась ровно по
// тому, что агент делает на самом деле, а не по выдуманным цифрам.
export const MAX_OUT_TOKENS = 16000;
export const MAX_IN_TOKENS = 4000;

/**
 * Потолок — доллар за одну построенную страницу.
 *
 * Сначала я поставил потолок «$20 за миллион выходных токенов». Цифра
 * красивая и ничего не значащая: она молча выкинула весь верхний ряд у
 * каждого разработчика — Claude Fable и Opus, старшие GPT, — хотя страница
 * на Fable стоит 84 цента. Мерить надо то, за что платишь: одну сборку.
 *
 * Заодно этот же потолок отсекает то, ради чего он и нужен: o1-pro за $600
 * за миллион — это $10 за страницу, десятикратный перебор.
 */
export const COST_CAP = 1.0;

/** Во что обойдётся одна страница на этой модели, в долларах. */
export const buildCost = (m) =>
  Number(m?.pricing?.completion || 0) * MAX_OUT_TOKENS +
  Number(m?.pricing?.prompt || 0) * MAX_IN_TOKENS;

/** Цена для человека: центы не прячем, но и нулями не врём. */
export const costLabel = (c) => {
  const n = Number(c);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 0.01) return "меньше цента";
  return `$${n.toFixed(2)}`;
};

/**
 * Разработчики моделей: приставка в id → как называть и с какого сайта брать
 * значок. Приставки живут годами, а названия моделей меняются каждый месяц —
 * поэтому руками записано только это.
 */
export const MAKERS = {
  anthropic:        { name: "Anthropic", site: "claude.ai" },
  openai:           { name: "OpenAI",    site: "openai.com" },
  google:           { name: "Google",    site: "gemini.google.com" },
  "meta-llama":     { name: "Meta",      site: "llama.com" },
  meta:             { name: "Meta",      site: "meta.ai" },
  deepseek:         { name: "DeepSeek",  site: "deepseek.com" },
  "x-ai":           { name: "xAI",       site: "x.ai" },
  qwen:             { name: "Qwen",      site: "qwen.ai" },
  mistralai:        { name: "Mistral",   site: "mistral.ai" },
  moonshotai:       { name: "Moonshot",  site: "kimi.com" },
  "z-ai":           { name: "Z.ai",      site: "z.ai" },
  minimax:          { name: "MiniMax",   site: "minimax.io" },
  nvidia:           { name: "NVIDIA",    site: "nvidia.com" },
  amazon:           { name: "Amazon",    site: "aws.amazon.com" },
  microsoft:        { name: "Microsoft", site: "microsoft.com" },
  cohere:           { name: "Cohere",    site: "cohere.com" },
  perplexity:       { name: "Perplexity", site: "perplexity.ai" },
  tencent:          { name: "Tencent",   site: "tencent.com" },
  "bytedance-seed": { name: "ByteDance", site: "bytedance.com" },
  ai21:             { name: "AI21",      site: "ai21.com" },
  inception:        { name: "Inception", site: "inceptionlabs.ai" },
  xiaomi:           { name: "Xiaomi",    site: "xiaomi.com" },
  thinkingmachines: { name: "Thinking Machines", site: "thinkingmachines.ai" },
  stepfun:          { name: "StepFun",   site: "stepfun.com" },
  upstage:          { name: "Upstage",   site: "upstage.ai" },
  "arcee-ai":       { name: "Arcee AI",  site: "arcee.ai" },
};

export const makerKey = (id) => String(id || "").split("/")[0];
export const makerOf = (id) => MAKERS[makerKey(id)] || null;

/** «Anthropic: Claude Sonnet 5» → «Claude Sonnet 5». */
export const prettyName = (m) =>
  String(m?.name || m?.id || "").replace(/^[^:]+:\s*/, "") || String(m?.id || "");

/** Значок разработчика — фавиконкой с его же сайта, как логотипы акций с CDN. */
export const modelLogo = (id) => {
  const site = makerOf(id)?.site;
  return site ? `https://www.google.com/s2/favicons?domain=${site}&sz=64` : "";
};

/** Рейтинг «делает веб-страницу» — то, чем агент занимается. */
function websiteElo(m) {
  const rows = m?.benchmarks?.design_arena;
  if (!Array.isArray(rows)) return 0;
  const site = rows.find((r) => r.category === "website");
  if (site?.elo) return site.elo;
  // Нет именно website — берём среднее по остальным категориям.
  const all = rows.map((r) => Number(r.elo) || 0).filter(Boolean);
  return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0;
}

/** Годится ли модель агенту: текст на выходе, по карману, и умеет то, что надо. */
function usable(m) {
  if (!m?.id || m.id.includes(":") || m.id.startsWith("~")) return false; // batch-копии и алиасы
  if (makerKey(m.id) === "openrouter") return false;                       // роутеры, а не модели
  const outs = m.architecture?.output_modalities;
  if (Array.isArray(outs) && (outs.length !== 1 || outs[0] !== "text")) return false;
  const c = buildCost(m);
  if (!(c > 0) || c > COST_CAP) return false;
  return websiteElo(m) > 0;
}

/** Нормализованная модель — то, чем оперируют форма и агент. */
const shape = (m) => ({
  id: m.id,
  name: prettyName(m),
  by: makerOf(m.id)?.name || makerKey(m.id),
  elo: websiteElo(m),
  cost: buildCost(m),
});

/**
 * Живой список моделей, годных для агента, — от лучших к худшим.
 * Не достали каталог (нет сети, лежит OpenRouter) — вернём пустой список,
 * и тогда выбор просто не предлагаем: лучше без выбора, чем выбор из вранья.
 */
export async function loadModels() {
  try {
    const r = await fetch(OR_MODELS, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.data || []).filter(usable).map(shape).sort((a, b) => b.elo - a.elo);
  } catch { return []; }
}

/**
 * Что показать до поиска: по одной лучшей модели от каждого разработчика,
 * разработчики — в порядке силы их лучшей модели. Двенадцать чипов, как у
 * акций; остальное достаётся поиском.
 */
export function featured(models, limit = 12) {
  const best = new Map();
  for (const m of models) if (!best.has(m.by)) best.set(m.by, m);
  return [...best.values()].slice(0, limit);
}

/** Поиск по чипам: ищем и по названию, и по разработчику, и по id. */
export const matchModel = (m, q) => {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  return `${m.name} ${m.by} ${m.id}`.toLowerCase().includes(s);
};

/** Пусто = «решит агент»: возьмёт лучшую доступную. */
export const AI_AUTO = "";
