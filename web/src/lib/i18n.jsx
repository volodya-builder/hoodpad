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
  "Читаю блокчейн…": "Reading the chain…",
  "Аналитика протокола": "Protocol analytics",
  "Все цифры читаются напрямую из контрактов hood в Robinhood Chain.": "Every number is read directly from hood contracts on Robinhood Chain.",
  "Объём торгов": "Trading volume",
  "сделок за всё время": "trades all-time",
  "Запуски токенов": "Token launches",
  "градаций": "graduations",
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
