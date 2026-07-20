# hood — паспорт проекта (память для Claude)

Этот файл — постоянная память проекта. Новая сессия Claude: прочитай его целиком перед работой.

## Что это

**hood** — токен-лончпад (pump.fun-стиль) на **Robinhood Chain mainnet**, живёт на **hoodandarrow.com**. Конкурент pons.family. Владелец — Володя (говорить с ним **только по-русски**).

Позиционирование: «Робин Гуд для мемкоинов» — жадные лончпады оставляют комиссии себе, hood возвращает народу. Слоган: *The greedy hoard. hood gives back.* Бренд пишется строчными: `hood`. Палитра: изумруд + золото.

## Сеть и контракты (mainnet, chainId 4663)

- RPC: `https://rpc.mainnet.chain.robinhood.com`; выделенный Alchemy: `https://robinhood-mainnet.g.alchemy.com/v2/Vs1nO3DOTOw64ThcZAuNf` (фронтенд-ключ, публичный)
- Explorer: `https://robinhoodchain.blockscout.com`
- **LaunchpadFactory:** `0xb09683cdd8e1dae93e37163eb4e6dd925d4104f9`
- **BuybackTreasury:** `0xe5544c837f8dfd6b7e082435f7a1d646692239d3`
- **Chat (on-chain, legacy):** `0xbaf4de9b8f35c384058d31e2730a3146c0d1af3c`
- **BuybackVote:** `0xf663b704929b8c0562f6e1ae5c0387ad264d4ef3`
- Все контракты верифицированы в Blockscout. Тестнет (chainId 46630) остаётся для экспериментов.

## Экономика

- Supply токена: 1B; на кривой продаётся 800M; 200M + собранный ETH уходят в **заблокированную** ликвидность Uniswap V3 при градации.
- **Градация: ровно 6.5 ETH** на кривой (VIRTUAL_ETH = 1.625).
- Комиссия трейда 1%, делится: **50% создателю токена / 20% команде / 30% казна выкупа** (creatorFeeShareBps=5000; в FeeSplitter teamBps=4000 от оставшегося).
- Казна тратится только на выкуп токенов; голосование комьюнити — совещательное.

## Инфраструктура

- Фронтенд: React + Vite, статика на **GitHub Pages**, репозиторий `volodya-builder/hoodpad`, ветка `main`, домен hoodandarrow.com (CNAME).
- **Автодеплой:** `.github/workflows/deploy.yml` — любой пуш в `main` с изменениями в `web/**` собирает и публикует сайт в `gh-pages`. Руками деплоить не нужно.
- Индексер: Goldsky subgraph `https://api.goldsky.com/api/public/project_cmrrkubk3ngb401u42u3bggz1/subgraphs/hood-mainnet/1.0.0/gn` + RPC-фолбэк (см. `web/src/lib/data.js`, бейдж источника — в админке).
- Чат/онлайн/баны: Firebase RTDB `https://hood-chat-4b664-default-rtdb.europe-west1.firebasedatabase.app` (REST).
- **Бот-миррор** Pons-токенов: `.github/workflows/mirror.yml` + `bot/` — GitHub Actions cron, следит за двумя фабриками Pons. **НИКОГДА не редактируй mirror.yml.**

## Карта кода

- `contracts/` — Solidity 0.8.28 (LaunchpadFactory, BondingCurvePool, FeeSplitter, BuybackTreasury, UniswapV3Migrator, Vote). Компиляция: `scripts/compile.js` (solc-js, optimizer 200, evmVersion paris).
- `web/src/pages/` — Home, Token, Create, Profile, Vote, Treasury, Analytics, Leaderboard, Chat, Admin, About, Legal (Privacy/Terms EN+RU).
- `web/src/lib/` — config.js (адреса/сети/RPC), data.js (Goldsky+RPC, кэши в localStorage), web3.js, price.js (3 источника ETH/USD), i18n.jsx.
- Документация: `MAINNET-DEPLOY.md`, `LAUNCH-RUNBOOK.md`, `SLITHER-REPORT.md`.

## Правила работы (для Claude)

1. Отвечать по-русски. Работать автономно, не дёргать по мелочам.
2. Деплой сайта = коммит в `main` + пуш. Пуш делает владелец кнопкой Push origin в GitHub Desktop (git в песочнице не авторизован — это нормально, не чинить).
3. **Никогда** не запрашивать приватные ключи/сид-фразы. Деплой контрактов владелец делает сам локально (`scripts/deploy-mainnet.js`, deploy-kit).
4. Не трогать `.github/workflows/mirror.yml`.
5. Слить/спросить только при необратимом: деньги, удаление, публикации от имени владельца.
6. Юридические тексты (Legal.jsx) — mainnet-версия, аудита контрактов не было (Slither прогнан, критики исправлены); владелец осознанно принял риск без платного аудита.

## Состояние и бэклог (на 20.07.2026)

Сделано: mainnet-деплой + верификация, Goldsky mainnet, типографика под Pons (Inter 500 + antialiasing), мобильная вёрстка, админка (онлайн, баны, авто-клейм комиссий), юр.тексты, маркетинг-пакет (постеры в marketing/, видео-брифы HOOD-VIDEO-*.md — локально, в git не входят).
Бэклог: первый флагманский токен до градации; ролик-сказка (бриф готов); launch-тред для X (@hoodandarrow); заявка в GMGN (t.me/gmgnai) после появления градуированных токенов; решить судьбу бота-миррора на mainnet (тратит реальный ETH); платный аудит — отложен владельцем.

## Критичные доступы владельца (Claude их не имеет и не просит)

Сид-фраза кошелька-владельца контрактов; аккаунт GitHub; домен hoodandarrow.com (регистратор); Alchemy; Goldsky; Firebase. Потеря любого из них — реальная угроза проекту, потеря чатов Claude — нет: вся память в этом файле и в репозитории.
