# Выход hood в мейннет Robinhood Chain

Пошаговый план. Ничего не деплой, пока не пройден **аудит контрактов** — в
кривой лежат реальные деньги пользователей.

## Что уже готово
- `scripts/deploy-mainnet.js` — боевой деплой со схемой 50/20/30 и реальным
  Uniswap V3 (адреса вшиты).
- `contracts/UniswapV3Migrator.sol` — создаёт настоящий пул Uniswap V3 и
  запирает LP-NFT навсегда. Именно по этому пулу токен видит GMGN.

## Подтверждённые адреса мейннета (Robinhood Chain, chainId 4663)
- Uniswap V3 NonfungiblePositionManager: `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Uniswap V3 Factory (справочно): `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`

## Шаги

### 0. Аудит (обязательно)
Профессиональный или как минимум серьёзный community-ревью. Верификация ≠ аудит.

### 1. Кошелёк-деплойер и газ
Отдельный кошелёк с реальным ETH в мейннете Robinhood на газ деплоя.
Команда (получатель 20%) — по возможности мультисиг: переменная `TEAM_WALLET`.

### 2. Деплой
```
PRIVATE_KEY=0xКЛЮЧ_ДЕПЛОЙЕРА \
RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/ВАШ_КЛЮЧ \
TEAM_WALLET=0xкошелёк_команды \
node scripts/deploy-mainnet.js
```
Адреса сохранятся в `mainnet-addresses.txt`.

### 3. Верификация контрактов
Тем же стандартным JSON-инпутом, что и в тестнете, но в мейннет-эксплорере
`https://robinhoodchain.blockscout.com`.

### 4. Сайт на мейннет
В `web/.env` прописать из `mainnet-addresses.txt`:
```
VITE_NETWORK=mainnet
VITE_FACTORY_ADDRESS=0x...
VITE_TREASURY_ADDRESS=0x...   # BuybackTreasury
VITE_VOTE_ADDRESS=0x...
```
Плюс в `web/src/lib/config.js` задать мейннет-RPC Alchemy в `ALCHEMY_RPC.mainnet`.
Пересобрать и задеплоить.

### 5. Субграф под мейннет
Новый Goldsky-субграф: network `robinhood-mainnet` (или как он называется у
Goldsky), factory-адрес и startBlock из деплоя. Endpoint прописать в
`web/src/lib/data.js` (SUBGRAPH_URL) — можно через env для переключения.

### 6. Бот на мейннет (по желанию)
Зеркало Pons и авто-сбор комиссий — перевести `bot/config.json` на мейннет:
`ponsSide`/`hoodFactory` уже мейннет-совместимы; дать боту реальный ETH на газ.
На мейннете включить `initialBuyEth` осторожно и снизить `maxPerHour`.

## Проверка попадания в GMGN
После первой градации токена (сбор 6.5 ETH → миграция) в мейннете:
пул Uniswap V3 создаётся автоматически, и GMGN индексирует токен за минуты.
Проверить: gmgn.ai → сеть Robinhood → поиск по адресу токена.

## Мелочи к redeploy
- Устаревший NatSpec в `FeeSplitter.sol` (пишет «40% creator» — фактически
  задаём 50%). Косметика, на логику не влияет.
