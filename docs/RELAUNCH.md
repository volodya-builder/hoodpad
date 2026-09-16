# Перезапуск hood — план (09.2026)

Экономика после перезапуска: комиссия 1% с каждой сделки →
**70% создателю · 10% арена (выкуп-сжигание подиума) · 10% выкуп монеты hood · 10% команда.**
За создание монеты платформа ничего не берёт. Первая монета платформы — **hood**.

## Шаг 1. Деплой контрактов (Володя, у себя на компьютере)

```
node scripts/compile.js              # свежие артефакты (уже сделано 16.09)
node scripts/relaunch.js             # сухой прогон — ничего не отправляет
node scripts/relaunch.js --deploy    # боевой деплой, ~0.001 ETH газа
```

Нужно: `scripts/deploy-config.json` (privateKey, rpcUrl, teamWallet), на кошельке
≥ 0.01 ETH. Скрипт сам настраивает фабрики (`initConfig`), миграторы,
базовые валюты WETH/USDG/USDe и пишет адреса в `scripts/relaunch-output.json`.

## Шаг 2. Акции и крипта (≈150 транзакций, ~$3 газа)

```
QUOTE_FACTORY=<новая фабрика за валюту> ZAP=<новый зап> node scripts/allow-stocks.js
QUOTE_FACTORY=… ZAP=… node scripts/allow-stocks.js --send
```

Пороги считаются по живым ценам (≈$16k у всех), знаки — с контракта (cbBTC 8).

## Шаг 3. Переключить сайт и ботов (Claude)

Прислать адреса из `relaunch-output.json` в чат. Claude меняет:
`web/src/lib/config.js` (FACTORY, QUOTE_FACTORY, ZAP, FEE_SPLITTER, ARENA_TREASURY,
TREASURY), `bot/arena/arena.mjs`, `bot/dividends/dividends.mjs`, `bot/config.json`,
`subgraph/subgraph.yaml` — коммит на staging, потом main.

Владелец: GitHub → Settings → Variables → `ARENA_TREASURY` = новая казна арены;
сабграф — задеплоить новую версию на Goldsky с новыми адресами фабрик
(инструкция придёт вместе с адресами).

## Шаг 4. Первая монета — hood

Создать с кошелька владельца через сайт (за ETH). Адрес монеты hood прислать в
чат: казна выкупа hood и бот будут выкупать именно её.

## Шаг 5. После запуска

- Передать владение фабриками/миграторами/казнами на аппаратный кошелёк
  (`transferOwnership` → `acceptOwnership`, Ownable2Step); деплойный ключ —
  только с газом для ботов.
- Старая фабрика за валюту: заявка pendingConfig больше не нужна (не применять).

## Что ещё не сделано (по приоритету)

1. Бот выкупа hood — готов: `bot/buyback/buyback.mjs`, workflow
   `.github/workflows/buyback.yml` (каждый день 00:45 UTC, всё накопленное →
   выкуп hood с кривой и сжигание). Чтобы заработал: GitHub → Settings →
   Secrets and variables → Actions → Variables → `HOOD_TOKEN` = адрес монеты hood.
2. Выкуп hood после её градации (Uniswap) — казна сейчас умеет покупать только
   на кривой; добавить маршрут через Uniswap. До этого бот просто копит.
