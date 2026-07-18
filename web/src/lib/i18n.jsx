import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

// RU — базовый язык интерфейса; словарь переводит на EN.
const EN = {
  "Обзор": "Explore",
  "Поиск токенов": "Search tokens",
  "+ Создать": "+ Create",
  "Аналитика": "Analytics",
  "Голосование": "Vote",
  "+ Запустить токен": "+ Launch token",
  "Подключить кошелёк": "Connect wallet",
  "Поиск токена по имени или тикеру…": "Search by name or ticker…",
  "Ничего не найдено": "Nothing found",
  "Загружаю…": "Loading…",
  "Токены с фиксированным сапплаем на Robinhood Chain": "Fixed-supply tokens on Robinhood Chain",
  "запуск в одну транзакцию": "one-transaction launch",
  "создателю": "to creator",
  "команде": "to team",
  "в казну выкупа": "to buyback treasury",
  "ликвидность запирается навсегда": "liquidity locks forever",
  "Градуировали": "Graduated",
  "Прошли порог градации — ликвидность заперта на DEX.": "Cleared the graduation threshold — liquidity locked on the DEX.",
  "На кривой": "On the curve",
  "Летят к градации — сбор 6.5 ETH.": "Climbing toward graduation — 6.5 ETH raise.",
  "Новые": "Newest",
  "Недавние покупки": "Recent buys",
  "Капитализация": "Market cap",
  "Токенов пока нет — станьте первым.": "No tokens yet — be the first.",
  "Запустить токен →": "Launch a token →",
  "Загружаю токены из блокчейна…": "Loading tokens from the chain…",
  "Градуировал": "Graduated",
  "Цена": "Price",
  "Собрано": "Raised",
  "До градации": "To graduation",
  "Комиссии создателя": "Creator fees",
  "Сожжено казной": "Burned by treasury",
  "Забрать комиссии создателя": "Claim creator fees",
  "Токен:": "Token:",
  "Пул:": "Pool:",
  "Создатель:": "Creator:",
  "Запущен": "Launched",
  "Капитализация по сделкам": "Market cap by trades",
  "График появится после первых сделок.": "The chart appears after the first trades.",
  "Сделки из блокчейна": "Trades from the chain",
  "Читаю события…": "Reading events…",
  "Пока нет сделок.": "No trades yet.",
  "Купил": "Bought",
  "Продал": "Sold",
  "блок": "block",
  "Купить": "Buy",
  "Продать": "Sell",
  "Вы платите (ETH)": "You pay (ETH)",
  "Вы продаёте": "You sell",
  "Баланс:": "Balance:",
  "макс": "max",
  "Вы получите (оценка)": "You receive (est.)",
  "Подтверждаю…": "Confirming…",
  "Комиссия 1%": "1% fee",
  "слиппедж 3%": "3% slippage",
  "на выкуп": "to buyback",
  "Токен градуировал — торговля на DEX. Кривая закрыта.": "This token graduated — trading moved to the DEX. The curve is closed.",
  "Кривая заполнена! Кто угодно может запустить миграцию.": "The curve is full! Anyone can trigger the migration.",
  "Мигрирую…": "Migrating…",
  "Мигрировать на DEX": "Migrate to DEX",
  "Выкуп из казны": "Treasury buyback",
  "Режим владельца платформы: казна купит этот токен с рынка.": "Platform-owner mode: the treasury buys this token from the market.",
  "Выкупить": "Buy back",
  "В казне:": "Treasury holds:",
  "Сжечь 🔥": "Burn 🔥",
  "ETH доступно": "ETH available",
  "Чат": "Chat",
  "Писать могут все — кошелёк не обязателен.": "Anyone can post — no wallet required.",
  "Пока тихо — напишите первым.": "Quiet so far — be the first to write.",
  "Сообщение…": "Message…",
  "Скоро: подключаем хранилище сообщений.": "Coming soon: wiring up message storage.",
  "Голосование за выкуп": "Buyback vote",
  "Каждую неделю комьюнити подсказывает казне, какой токен поддержать выкупом: один кошелёк — один голос за раунд, всё в блокчейне. Итоговое решение о выкупе принимает платформа — голосование совещательное.":
    "Every week the community signals which token the treasury should support: one wallet — one vote per round, all on-chain. The final buyback call is made by the platform — the vote is advisory.",
  "Голосов в раунде": "Votes this round",
  "До конца раунда": "Round ends in",
  "Ваш голос": "Your vote",
  "Нет токенов на кривой — голосовать пока не за кого.": "No tokens on the curve — nothing to vote for yet.",
  "Голосовать": "Vote",
  "ваш голос": "your vote",
  "Вы уже голосовали в этом раунде": "You already voted this round",
  "Голос — маленькая транзакция в сети (газ — доли цента). Новый раунд начинается автоматически каждые 7 дней.":
    "A vote is a tiny on-chain transaction (gas costs a fraction of a cent). A new round starts automatically every 7 days.",
  "Голосование скоро появится — контракт готовится к деплою.": "Voting is coming soon — the contract is being deployed.",
  "Нажмите на строку, чтобы увидеть, кто голосовал.": "Click a row to see who voted.",
  "О нас": "About",
  "hood — лаунчпад токенов на Robinhood Chain с революционной экономикой: треть всех торговых комиссий уходит в казну выкупа, из которой их невозможно вывести — только выкупать токены платформы. Мы зарабатываем вместе с комьюнити, а не на нём.":
    "hood is a token launchpad on Robinhood Chain with revolutionary economics: a third of all trading fees flows into a buyback treasury that cannot be withdrawn from — it can only buy back platform tokens. We earn with the community, not off it.",
  "Куда идут комиссии": "Where the fees go",
  "Каждая сделка на кривой платит комиссию 1%. Смарт-контракт делит её автоматически:":
    "Every trade on the curve pays a 1% fee. The smart contract splits it automatically:",
  "создателю токена": "to the token creator",
  "Пассивный доход с первой же сделки — стимул строить долгосрочные проекты, а не бросать их.":
    "Passive income from the very first trade — an incentive to build long-term projects, not abandon them.",
  "Разработка, инфраструктура и развитие платформы.":
    "Development, infrastructure and growth of the platform.",
  "Возвращаются в рынок выкупами токенов платформы. Другого пути у этих денег нет.":
    "Returned to the market through buybacks of platform tokens. This money has no other way out.",
  "Казна, из которой нельзя вывести": "A treasury with no exit door",
  "Мы не просим верить на слово — это гарантирует код. Вот что жёстко зашито в контракте казны:":
    "We don't ask you to take our word — the code guarantees it. Here is what is hard-wired into the treasury contract:",
  "Функции вывода не существует": "No withdraw function exists",
  "В контракте казны нет ни withdraw, ни transfer. Даже владелец платформы физически не может отправить ETH из казны себе на кошелёк — такого кода просто нет.":
    "The treasury contract has no withdraw and no transfer. Even the platform owner physically cannot send treasury ETH to their own wallet — that code simply does not exist.",
  "ETH уходит только в пулы hood": "ETH can only go into hood pools",
  "Единственная функция, тратящая ETH — buyback(). Контракт проверяет через фабрику, что покупка идёт в настоящий пул платформы, а не на произвольный адрес.":
    "The only ETH-spending function is buyback(). The contract verifies through the factory that the purchase goes into a genuine platform pool, not an arbitrary address.",
  "Купленное — только держать или сжечь": "Bought tokens: hold or burn only",
  "Выкупленные токены казна может держать или отправить на dead-адрес навсегда. Продать их или перевести кому-то невозможно — таких функций нет.":
    "Bought-back tokens can only be held by the treasury or sent to the dead address forever. Selling or transferring them is impossible — those functions don't exist.",
  "Код заморожен навсегда": "The code is frozen forever",
  "Контракт не обновляемый: это не прокси, правила нельзя переписать после деплоя. Что вы читаете в эксплорере — то и исполняется.":
    "The contract is not upgradeable: it is not a proxy, the rules cannot be rewritten after deployment. What you read in the explorer is what executes.",
  "Проверьте сами — откройте контракт казны в эксплорере:":
    "Verify it yourself — open the treasury contract in the explorer:",
  "Контракт казны": "Treasury contract",
  "Голосование — компас, а не руль": "Voting is a compass, not a steering wheel",
  "Каждую неделю держатели голосуют, какой токен казне поддержать выкупом: один кошелёк — один голос, всё в блокчейне. Голосование совещательное: итоговое решение всегда принимает команда, а результаты раунда служат рекомендацией и честным ориентиром настроений аудитории. Так казна тратится осмысленно, а комьюнити видит, что его слышат.":
    "Every week holders vote on which token the treasury should support with a buyback: one wallet — one vote, all on-chain. The vote is advisory: the final decision is always made by the team, and round results serve as a recommendation and an honest gauge of community sentiment. The treasury is spent thoughtfully, and the community sees it is heard.",
  "Смотреть голосование": "View voting",
  "Аналитика казны": "Treasury analytics",
  "Пока никто не голосовал за этот токен.": "No one has voted for this token yet.",
  "Кошельки раунда": "Voters this round",
  "Поиск: адрес или тикер…": "Search: address or ticker…",
  "Все токены": "All tokens",
  "Читаю блокчейн…": "Reading the chain…",
  "Аналитика протокола": "Protocol analytics",
  "Все цифры читаются напрямую из контрактов hood в Robinhood Chain.": "Every number is read directly from hood contracts on Robinhood Chain.",
  "Объём торгов": "Trading volume",
  "сделок за всё время": "trades all-time",
  "Сделки": "Trades",
  "сделок": "trades",
  "24ч": "24h",
  "Неделя": "Week",
  "Месяц": "Month",
  "Всё время": "All time",
  "за 24 часа": "last 24 hours",
  "за неделю": "last week",
  "за месяц": "last month",
  "за всё время": "all time",
  "Запуски токенов": "Token launches",
  "градаций": "graduations",
  "доля градаций": "graduation rate",
  "всех комиссий — с первого трейда": "of all fees — from the very first trade",
  "Выкуплено и сожжено": "Bought back & burned",
  "токенов сожжено навсегда": "tokens destroyed forever",
  "куплено казной": "bought by treasury",
  "выкупов": "buybacks",
  "Выплачено создателям": "Paid to creators",
  "доля создателя каждого пула — с первого трейда": "each pool's creator share — from the very first trade",
  "Казна выкупа": "Buyback treasury",
  "получено": "received",
  "выкуплено на": "spent on buybacks",
  "контракт": "contract",
  "Примечание: комиссии попадают в казну после вызова claimProtocolFees у пула — до этого они накапливаются в самом пуле.":
    "Note: fees reach the treasury after claimProtocolFees is called on a pool — until then they accrue inside the pool.",
  "Профиль": "Profile",
  "баланс": "balance",
  "Общий PnL": "Total PnL",
  "позиции": "positions",
  "вложено": "invested",
  "реализовано": "realized",
  "Мои позиции": "My positions",
  "Мои запуски": "My launches",
  "Комиссии к выплате": "Claimable fees",
  "Забрать": "Claim",
  "Стоимость позиций": "Positions value",
  "позиций": "positions",
  "Скопировать адрес": "Copy address",
  "Открыть в эксплорере": "Open in explorer",
  "Пока нет позиций.": "No positions yet.",
  "Токен": "Token",
  "Баланс": "Balance",
  "Стоимость": "Value",
  "Вложено": "Invested",
  "Кривая": "Curve",
  "Мои сделки": "My trades",
  "Сделок пока нет.": "No trades yet.",
  "Тип": "Type",
  "Токены": "Tokens",
  "Блок": "Block",
  "Подключите кошелёк, чтобы увидеть профиль.": "Connect a wallet to see your profile.",
  "Подключить →": "Connect →",
  "Запустить токен": "Launch token",
  "Название": "Name",
  "Тикер": "Ticker",
  "Описание": "Description",
  "Картинка токена": "Token image",
  "Покупка создателя": "Developer buy",
  "Дополнительно": "Advanced",
  "Кошелёк создателя": "Creator wallet",
  "Сайт": "Website",
  "Назад": "Back",
  "Пока никто не градуировал — первым здесь станет токен, собравший 6.5 ETH.":
    "No graduations yet — the first token to raise 6.5 ETH lands here.",
  "запущено": "launched",
  "Токены, летящие к градации на Robinhood Chain.": "Tokens climbing toward graduation on Robinhood Chain.",
  "Отключить": "Disconnect",
  "Продукт": "Product",
  "Правовое": "Legal",
  "Создать": "Create",
  "Политика конфиденциальности": "Privacy Policy",
  "Условия использования": "Terms of Use",
  "Риск-нотис": "Risk notice",
  "Запускайте и исследуйте токены с фиксированным сапплаем на Robinhood Chain. Каждую транзакцию подписывает ваш кошелёк — hood не хранит активы.":
    "Launch and explore fixed-supply tokens on Robinhood Chain. Every transaction is signed by your wallet — hood does not custody assets.",
  "Транзакции отправляются вашим кошельком и необратимы. Токены волатильны и могут полностью обесцениться. hood не хранит активы, не даёт гарантий и финансовых советов.":
    "Transactions are submitted by your wallet and are irreversible. Tokens are volatile and can lose all value. hood does not provide custody, warranties, or financial advice.",
  "только что": "just now",
  "назад": "ago",
};

const LangCtx = createContext({ lang: "ru", t: (s) => s, setLang: () => {} });

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("hood_lang") || "ru"; } catch (e) { return "ru"; }
  });
  useEffect(() => {
    try { localStorage.setItem("hood_lang", lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);
  const t = useCallback((s) => (lang === "en" ? (EN[s] ?? s) : s), [lang]);
  useEffect(() => { window.__hoodT = t; }, [t]);
  return <LangCtx.Provider value={{ lang, t, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

/** Для не-React кода (например, форматтеры): текущий язык из localStorage. */
export function currentLang() {
  try { return localStorage.getItem("hood_lang") || "ru"; } catch (e) { return "ru"; }
}
