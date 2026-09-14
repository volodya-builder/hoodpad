// Модели, на которых может работать ИИ монеты.
//
// Один список на двоих: его показывает форма запуска (web/src/pages/Create.jsx)
// и его же читает агент (scripts/agent-run.mjs). Это не красота, а защита от
// вранья: предложить создателю модель, которую агент не умеет вызвать, — это
// обещание, которое некому выполнить. Пока файл один, такое расхождение
// невозможно физически.
//
// Выбор создателя уезжает в метадату токена (поле ai) тем же data-URI, что и
// картинка, — то есть в сам контракт, навсегда. Ни базы, ни ещё одного ключа.
//
// Если выбранной модели в каталоге OpenRouter в момент сборки не окажется
// (модели снимают с обслуживания), агент возьмёт ближайшую из своего списка
// и НАПИШЕТ В ЖУРНАЛЕ, на чём собрал на самом деле. Молча подменять нельзя:
// на витрине тогда будет не отчёт, а реклама.

export const AI_MODELS = [
  { id: "anthropic/claude-sonnet-4.5",        name: "Claude Sonnet 4.5", by: "Anthropic", site: "claude.ai" },
  { id: "anthropic/claude-opus-4.1",          name: "Claude Opus 4.1",   by: "Anthropic", site: "claude.ai" },
  { id: "openai/gpt-5.2",                     name: "GPT-5.2",           by: "OpenAI",    site: "openai.com" },
  { id: "openai/gpt-4o",                      name: "GPT-4o",            by: "OpenAI",    site: "openai.com" },
  { id: "google/gemini-2.5-pro",              name: "Gemini 2.5 Pro",    by: "Google",    site: "gemini.google.com" },
  { id: "google/gemini-2.5-flash",            name: "Gemini 2.5 Flash",  by: "Google",    site: "gemini.google.com" },
  { id: "deepseek/deepseek-chat",             name: "DeepSeek V3",       by: "DeepSeek",  site: "deepseek.com" },
  { id: "deepseek/deepseek-r1",               name: "DeepSeek R1",       by: "DeepSeek",  site: "deepseek.com" },
  { id: "x-ai/grok-4",                        name: "Grok 4",            by: "xAI",       site: "x.ai" },
  { id: "meta-llama/llama-3.3-70b-instruct",  name: "Llama 3.3 70B",     by: "Meta",      site: "llama.com" },
  { id: "mistralai/mistral-large",            name: "Mistral Large",     by: "Mistral",   site: "mistral.ai" },
  { id: "qwen/qwen3-235b-a22b",               name: "Qwen3 235B",        by: "Qwen",      site: "qwen.ai" },
  { id: "moonshotai/kimi-k2",                 name: "Kimi K2",           by: "Moonshot",  site: "kimi.com" },
  { id: "z-ai/glm-4.6",                       name: "GLM-4.6",           by: "Z.ai",      site: "z.ai" },
];

// Показываются в форме до поиска — как популярные тикеры у акций.
export const AI_POPULAR = [
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.2",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-chat",
  "x-ai/grok-4",
  "meta-llama/llama-3.3-70b-instruct",
  "openai/gpt-4o",
  "anthropic/claude-opus-4.1",
  "qwen/qwen3-235b-a22b",
  "mistralai/mistral-large",
  "moonshotai/kimi-k2",
  "z-ai/glm-4.6",
];

// Пустая строка = «пусть решает агент»: он возьмёт лучшую доступную.
// Это же значение стоит по умолчанию, чтобы выбор был правом, а не оброком:
// человек пришёл запустить монету, а не выбирать модель.
export const AI_AUTO = "";

export const modelById = (id) => AI_MODELS.find((m) => m.id === id) || null;

// Значки берём фавиконками с сайтов самих разработчиков моделей — по той же
// логике, что логотипы акций тянутся с логотип-CDN: это опознавательный знак
// рядом с названием, а не наша картинка. Не отдалось — картинка прячется
// (см. Logo в Create.jsx), название остаётся, чип работает.
export const modelLogo = (site) =>
  `https://www.google.com/s2/favicons?domain=${site}&sz=64`;

/** Поиск по чипам: тикером здесь служит и название, и разработчик, и id. */
export const matchModel = (m, q) => {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  return (
    m.name.toLowerCase().includes(s) ||
    m.by.toLowerCase().includes(s) ||
    m.id.toLowerCase().includes(s)
  );
};
