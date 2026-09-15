# worker — чат холдеров с ИИ монеты

Единственная серверная часть hood: Cloudflare Worker на `hoodandarrow.com/api/*`.
Сайт статический, а ключ модели показывать в браузере нельзя — воркер держит
ключ, пускает только холдеров и пишет разговор в базу (RTDB), откуда сайт его читает.

## Как это работает

1. Холдер один раз подписывает кошельком текст `hood ai chat / address / ts`
   → `POST /api/chat/session` → воркер проверяет подпись (ecrecover через
   прекомпайл сети, смарт-кошельки — EIP-1271) и выдаёт сессию на неделю (HMAC).
2. `POST /api/chat/send { session, coin, text }` → воркер проверяет: ИИ у монеты
   включён (`FeeSplitterV4.aiOf`), баланс монеты у кошелька > 0, лимиты; собирает
   промпт (описание монеты, что построил агент, идеи с доски, правила) и зовёт
   модель монеты через OpenRouter (не вышло — `FALLBACK_MODEL`); пишет вопрос и
   ответ в `aichat/<coin>/messages`, расход — в `aichat/<coin>/stats/<день>`.
3. Лимиты (`LIMITS` в wrangler.toml) считает Durable Object — снаружи не сбросить.

## Деплой

Автоматически: `.github/workflows/worker.yml` при пуше `worker/**` в `main`.
Нужны секреты репозитория: `CLOUDFLARE_API_TOKEN` (шаблон «Edit Cloudflare
Workers»), `CLOUDFLARE_ACCOUNT_ID`, `OPENROUTER_KEY` (уже есть у агента),
необязательно `CHAT_SECRET`.

Руками: `cd worker && npm ci && npx wrangler login && npx wrangler deploy`,
затем `npx wrangler secret put OPENROUTER_KEY`.

Проверка: `curl https://hoodandarrow.com/api/chat/health`.

## Тест ядра

`node test/core.test.mjs` — подпись, сессия, промпт, чтение монеты из цепи.
