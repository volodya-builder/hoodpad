# hood — паспорт проекта (память для Claude)

Читать целиком в начале сессии: ~4 страницы, всё актуальное на 15.09.2026.
История решений и отменённые ветки продукта — в `docs/CLAUDE-HISTORY.md`,
туда ходить только если вопрос про прошлое (коты, арена, казна выкупа,
голосование, недельная мастерская, масштабирование лета 2026).

## Что это

**hood** — лончпад мемкоинов (pump.fun-стиль) на **Robinhood Chain mainnet**,
сайт **hoodandarrow.com**, конкурент pons.family. Владелец — Володя, соло.
Говорить с ним **только по-русски**, просто, без воды; работать автономно,
спрашивать только перед необратимым (деньги, удаление, публикации от его имени).

Отличие от pump.fun: монета может торговаться за токенизированную акцию
Robinhood (71 бумага) и платить холдерам **выплаты в этой акции** с каждой
сделки; у монеты может быть **свой ИИ** (агент строит страницы по идеям
холдеров, чат холдеров с ИИ). Покупают и продают всегда за ETH — зап меняет
ETH ↔ акция по дороге.

## Продукт сейчас (что живо, что спрятано)

Живо: главная (список монет обеих фабрик), страница монеты (график, купить/
продать через зап, активность, чат, вкладка «ИИ» = чат с ИИ + бюджет агента +
доска идей), «Создать» (ETH или акция из белого списка, ставка выплат 0–3%,
модель ИИ), «ИИ» (доска по всем монетам), «Аналитика» (+ лидеры), профиль,
трейдер, политика/условия (обновлены 15.09.2026 под текущий продукт).

**Спрятано флагами `FEATURES` в `web/src/lib/config.js`, код не удалён — не
работать над этим и не «чинить»:** about, arena, cats, vote, treasury, ticker,
headerSearch, netSwitch, weeklyWorkshop, taxToken, customQuote, payInQuote,
trustScore, creatorSellBanner. Скрытые страницы грузятся лениво (`lazy()` в
App.jsx), их хуки (`useArena`, `useSupport`) выключены флагами — в сеть не ходят.

## Сеть и контракты (mainnet, chainId 4663)

- RPC `https://rpc.mainnet.chain.robinhood.com` (блок ≈0.1 с, газ копейки,
  `eth_getLogs` тянет 20М блоков одним запросом); фронт — Alchemy-ключ в
  config.js (заперт на домен). Обозреватель Blockscout
  `https://robinhoodchain.blockscout.com` (из песочницы Claude закрыт Cloudflare).
- Кошелёк владельца (owner всего) `0xD3d14c10020ad9C582404669a2Fa11AfF2386255`.
- ETH-фабрика `0x08a887196fc31b89305ae03aa991917f6b1d23ec` — `setConfig` без
  таймлока; **сборка в сети старше репозитория** (нет hardening-коммита
  `ba18f5c5`: мигратор уязвим к подставному пулу, нет лимитов метаданных).
  Состояние мейннета проверять байткодом и `eth_call`, не исходником.
- Фабрика за валюту `0xd7299e03c5e7d4f9f4c62f305a0b619359cf9a4f` — 79 валют в
  белом списке (71 акция + USDG/USDE/CBBTC/TAO/VIRTUAL…), `proposeConfig` с
  таймлоком 48 ч. **Заявка на казну = сплиттер, создателю 7000 висит, `--apply`
  с 16.09.2026 16:32 UTC** (`node scripts/deploy-agent-economy.js --apply`).
- CurveZap `0xab963a68f495097aa434fff8e183de5ab86d5099` — ETH ↔ валюта через
  Uniswap V3 (маршруты WETH→USDG→акция; вся ликвидность акций в USDG-пулах).
- FeeSplitterV4 `0x4b4ca78517a48876a4341cbbfbd96e15c9d99491` (казна обеих фабрик,
  `aiOf`/`enableAi`), AgentTreasury `0xe39e61c2e2897a59dde71d75b7b84f42ed09fd0c`.
- Старое, живо, но без интерфейса: BuybackTreasuryV2 `0xb456…a063a`, VotePower,
  чат-контракт. Тестнет 46630 — для экспериментов.
- Голдски-сабграф (ETH-фабрика): адрес в `web/src/lib/data.js`; quote-фабрику
  сайт читает RPC-фолбэком.

## Экономика (решение владельца 14.09.2026)

Комиссия сделки 1%. Новые монеты: **без ИИ 80% создателю / 20% команде; с ИИ
70% / 20% / 10% в бюджет агента**. Пул отдаёт создателю 70% (зашито в пару при
создании, навсегда), остальное — сплиттеру: 2/3 команде, 1/3 агенту если
`aiOf`, иначе создателю. Старые пулы (создатель 50%) — их 50% сплиттер делит
так же (33/17). Выплаты холдерам: у монет за валюту ставка 0–3% с каждой
сделки в валюте монеты (`DividendToken`, `pot` пока `divSupply` < 1000),
бот `bot/dividends` платит раз в час. Градация: ETH-монета 6.5 ETH; монета за
акцию — 4 × virtualQuote (≈ $16 000 в штуках по цене на момент `setQuote`).

`enableAi` — решение создателя, необратимо; первые 3 сборки агента за счёт hood.

## Карта кода

- `web/src/pages/` — Home, Token (сетка react-grid-layout: about/chart/trades/
  swap/chat; на телефоне порядок через `data-blk` + CSS order), Create, AI,
  Analytics (+Leaderboard), Profile, Trader, Chat (общий чат), Legal (RU+EN).
  Скрытые: About, Arena, Cats, CatsGuide, Treasury, Revenue, Admin.
- `web/src/components/` — Icon (линейные иконки, эмодзи в UI запрещены),
  AgentChat (чат с ИИ монеты), Board (доска идей), AgentBudget, Dividends
  (`useDividends`), TokenSidebar, CandleChart; скрытые Workshop/Queue/Journal/Ticker.
- `web/src/lib/` — config.js (адреса, FEATURES, CHAT_API_URL), data.js (сабграф+RPC,
  кэши, `cachedToken`), price.js (`moneyEth`: **все суммы на сайте — в ETH и
  долларах**, символ акции в суммах не пишем), board.js, models.mjs (живой
  каталог OpenRouter, потолок $1 за страницу), quotes.js, rwa.js (реестр 194
  бумаг с docs.robinhood.com/chain/contracts), i18n.jsx (RU-ключи → EN).
- `worker/` — Cloudflare Worker `hood-chat` на `hoodandarrow.com/api/*`: сессия
  по подписи кошелька (ecrecover через прекомпайл сети), только холдеры монет с
  `aiOf`, лимиты в Durable Object, промпт из описания монеты + сборок + доски,
  модель монеты через OpenRouter, история в RTDB `aichat/<coin>/messages`
  (запись только воркером — секрет базы). Тест: `node test/core.test.mjs`.
- `scripts/` — agent-run.mjs (агент, cron */5), allow-stocks.js (белый список
  акций + маршруты запа), deploy-agent-economy.js (`--apply`), deploy-zap.js,
  deploy-quote.js, compile.js, run-tests.mjs.
- `bot/` — dividends (автовыплаты), activity (бот фейковой торговли, см. ниже),
  treasurer (казначей старой схемы), mirror (не трогать).
- `contracts/` — 0.8.28; тесты в `test/*.test.mjs` (ganache, песочница `~/qt`).
- Спеки: CONCEPT-V3.md (разворот 13.09), CONCEPT-AI-BOARD.md, AI-AGENT.md,
  worker/README.md. Остальные .md в корне — история.

## Инфраструктура и автоматика

- Сайт: GitHub Pages из `volodya-builder/hoodpad` (**репозиторий публичный** —
  никаких секретов в коде; `scripts/deploy-config.json` в .gitignore:
  privateKey, openrouterKey, githubToken). Cloudflare перед доменом.
- Ветки: `main` = бой (deploy.yml), `staging` = hoodandarrow.com/staging/
  (deploy-staging.yml, база `/staging/`). Cloudflare кэширует — Ctrl+F5.
- Firebase RTDB `hood-chat-4b664` (europe-west1): чат, доска, `aichat`.
  Правила в консоли — источник правды; `firebase/database.rules.json` — копия
  (aichat: читать всем, писать никому — воркер ходит с секретом).
  Из песочницы Claude и с машины владельца база закрыта, из браузера и CI — открыта.
- Workflows (`.github/workflows/`): deploy, deploy-staging, agent (*/5, OPENROUTER_KEY),
  dividends (hourly, TREASURER_PRIVATE_KEY), worker (деплой чата; секреты
  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, FIREBASE_DB_SECRET), mirror
  (**никогда не редактировать**), activity (*/30, торгует реальным ETH ради
  «оживления», $10/день, 4 кошелька из ACTIVITY_PRIVATE_KEY — коммитит
  `bot/state.json`), treasurer (*/6h, казна старой схемы). Файлы workflows
  пишутся только heredoc-ом через device_bash — device_commit_files их не пропускает.
- Платные сервисы владельца: Firebase Blaze, Alchemy PAYG, Cloudflare Pro,
  Goldsky Scale, OpenRouter (пополняет только владелец).

## Как работать (правила для Claude)

1. **Все изменения сайта — сначала в `staging`, `main` пушит только владелец**
   (GitHub Desktop). Локальная ветка — `main`. Коммит из песочницы:
   ```
   export GIT_AUTHOR_NAME=Claude GIT_AUTHOR_EMAIL=noreply@anthropic.com \
          GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com \
          GIT_INDEX_FILE=$HOME/hoodpad.index
   git read-tree HEAD && git update-index --add <явные пути>
   TREE=$(git write-tree); C=$(git commit-tree $TREE -p HEAD -m "…")
   git update-ref refs/heads/main $C
   M=$(git commit-tree $TREE -p origin/staging -p $C -m "свести в staging: …")
   git push origin $M:refs/heads/staging      # push работает с машины владельца
   unset GIT_INDEX_FILE; git read-tree HEAD; git update-index --refresh
   for f in .git/*.lock; do [ -e "$f" ] && mv "$f" .git/_trash/; done
   ```
   Замки в `.git` из песочницы не удаляются — только переносятся. Добавлять в
   индекс **только явные пути** (индекс копит чужое). Сообщения коммитов —
   по-русски, с Co-Authored-By.
2. **Перед пушем — дымовая сборка**: в песочнице клон `scratchpad/hp`
   (`git fetch && git checkout -B work origin/staging`, скопировать изменённые
   файлы, `cd web && npx vite build --base=/staging/`), затем
   `node web/smoke/smoke.mjs hp/web/dist /staging/` (все страницы, вкладки
   монеты, телефон 375 px: pageerror, «Страница упала», горизонтальный скролл).
   RPC из песочницы закрыт → данные не грузятся, но падения рендера видны.
   Проверка с данными — staging во встроенном браузере (владелец не хочет
   запросов на доступ к сайтам — это настройка его приложения).
3. **Хуки**: всё, что читает `data`, — ниже `useState(data)` (14.09 уронило бой).
4. **Переводы**: каждая надпись через `t("…")` + пара в `EN` (i18n.jsx, вставка
   перед `\n};\n\nconst LangCtx`). **Эмодзи** в UI не добавлять — `Icon`.
   **Деньги** — `moneyEth` (ETH + $), символ акции в суммах не показывать.
   На телефоне проверять: горизонтальный скролл, порядок блоков, вкладки.
5. **Секреты**: никогда не просить ключи/сид-фразы; ключи из deploy-config.json
   читать только внутри device_bash и не печатать (длина/префикс — можно).
   Деплой контрактов и `--send/--apply` — владелец сам, по моей инструкции.
6. `.github/workflows/mirror.yml` не трогать. Страницу «О нас» не трогать.
7. Прятать, не удалять: любую убранную фичу — за флаг `FEATURES`.
8. Не спрашивать по мелочам; спрашивать перед необратимым.

### Песочница Claude — сеть и инструменты

- Node `fetch` не видит прокси: `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` +
  undici `ProxyAgent` (образец: `scratchpad/dry/run-dry.mjs`); так работают
  RPC-зонды и сухие прогоны скриптов против мейннета. Blockscout, Firebase,
  OpenRouter из песочницы закрыты; с машины владельца (device_bash) закрыты
  Firebase и OpenRouter, RPC и github.com — открыты.
- Контракты: песочница `~/qt` (solc 0.8.28, OZ 5.6.1, ganache):
  `node scripts/compile.js`; `GANACHE_FROM=/tmp/node_modules/ timeout 500 node
  scripts/run-tests.mjs test/<file>` (exit 124 нормален; `pkill -f run-tests`
  убивает и мою оболочку — не делать).
- Реестр акций Robinhood строится JS-ом — читать через браузер, не fetch.

## Известные долги (честно)

- Мейннет ETH-фабрики старее репозитория (уязвимый мигратор) — до первой
  градации нужен передеплой мигратора; платного аудита не было.
- База открыта на запись для доски/чата (подделать или удалить чужую строку
  можно), балансы голосов без снимка, списание бюджета агента не из CI.
- Бот `activity` — фейковый объём реальными деньгами: противоречит условиям
  (wash trading) и «честному объёму»; решение о выключении — за владельцем.
- Чат с ИИ ждёт секреты Cloudflare/Firebase у владельца; DOGE — `enableAi`.

## Критичные доступы владельца (Claude их не имеет и не просит)

Сид-фраза кошелька-владельца; GitHub; домен (Namecheap); Cloudflare; Alchemy;
Goldsky; Firebase; OpenRouter. Память проекта — этот файл и репозиторий.
