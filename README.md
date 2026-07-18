# HoodPad — токен-лаунчпад для Robinhood Chain

MVP платформы запуска токенов в стиле pump.fun: бондинг-кривая, честный запуск
в одну транзакцию, автоматическая миграция ликвидности на DEX с вечной
блокировкой.

## Экономика

| Параметр | Значение |
|---|---|
| Общий сапплай | 1 000 000 000 (фиксированный, минт один раз) |
| Продаётся на кривой | 800 000 000 (80%) |
| Резерв для DEX | 200 000 000 (20%) |
| Виртуальный резерв ETH | 1.625 ETH |
| Градация (сбор) | ровно 6.5 ETH |
| Комиссия с трейда | 1% (настраивается до 5%) |
| Доля создателя в комиссии | **70%** — создатель зарабатывает с первого трейда |

Кривая — constant product с виртуальными резервами:
`x = 1.625 ETH + собранный ETH`, `y = 1e9 - проданные токены`.
При достижении 800M проданных токенов собрано ровно 6.5 ETH, торговля на
кривой замораживается, `migrate()` (может вызвать кто угодно) отправляет
200M токенов + 6.5 ETH в миграционный контракт, который создаёт full-range
позицию Uniswap V3 и **навсегда запирает LP NFT в себе** — функции вывода
не существует.

## Отличия от конкурентов

- **Создатель зарабатывает 70% комиссий** — на уровне Pons (70/30), у hood.fun 80%, но только curve-fees;
- **Первая покупка создателя в той же транзакции, что и запуск** — защита от снайперов;
- Полностью некастодиально, токен без владельца, минта и блэклистов;
- Миграция permissionless — никакой зависимости от бэкенда платформы.

## Структура

```
contracts/
  LaunchpadFactory.sol    — запуск в 1 транзакцию, реестр, конфиг
  BondingCurvePool.sol    — кривая, комиссии, градация
  LaunchToken.sol         — фикс-сапплай ERC20
  UniswapV3Migrator.sol   — вечный лок ликвидности на Uniswap V3
  interfaces/…            — ILiquidityMigrator (мигратор заменяем)
  test/MockMigrator.sol   — для тестов/тестнета
scripts/
  compile.js              — компиляция solc-js (без внешних загрузок)
  deploy.js               — деплой через viem
  run-tests.sh            — локальная нода + тесты
test/
  launchpad.test.mjs      — 9 e2e-тестов (node:test + viem)
web/                      — фронтенд (Vite + React + viem)
```

## Быстрый старт

```bash
npm install                # корень: solc, hardhat, viem
npm test                   # компиляция + локальная нода + 9 тестов

# деплой в тестнет Robinhood Chain (нужен тестовый ETH из крана)
PRIVATE_KEY=0x... RPC_URL=https://rpc.testnet.chain.robinhood.com \
  node scripts/deploy.js

# фронтенд
cd web
echo 'VITE_FACTORY_ADDRESS=0x<адрес из деплоя>' > .env
echo 'VITE_NETWORK=testnet' >> .env
npm install && npm run dev
```

### Сеть

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | rpc.mainnet.chain.robinhood.com | rpc.testnet.chain.robinhood.com |
| Explorer | robinhoodchain.blockscout.com | explorer.testnet.chain.robinhood.com |
| Газ | ETH | ETH (кран в доках) |

## Продакшен-чеклист (до мейннета)

1. **Аудит контрактов** — обязательно; код не аудирован.
2. Найти адреса Uniswap V3 `NonfungiblePositionManager` и `WETH9` на
   Robinhood Chain, задеплоить `UniswapV3Migrator` и указать его в фабрике
   (`setConfig`).
3. Проверить весь цикл на тестнете: запуск → торговля → градация → миграция →
   торговля на DEX.
4. Мультисиг вместо EOA как owner фабрики и treasury.
5. Индексер (The Graph поддерживает Robinhood Chain) для истории трейдов,
   графиков и ленты активности.
```
