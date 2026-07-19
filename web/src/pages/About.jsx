import React from "react";
import { useSplit } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";

export default function About() {
  const { t } = useLang();
  const split = useSplit();

  const facts = [
    [
      t("Функции вывода не существует"),
      t("В контракте казны нет ни withdraw, ни transfer. Даже владелец платформы физически не может отправить ETH из казны себе на кошелёк — такого кода просто нет."),
    ],
    [
      t("ETH уходит только в пулы hood"),
      t("Единственная функция, тратящая ETH — buyback(). Контракт проверяет через фабрику, что покупка идёт в настоящий пул платформы, а не на произвольный адрес."),
    ],
    [
      t("Купленное — только держать или сжечь"),
      t("Выкупленные токены казна может держать или отправить на dead-адрес навсегда. Продать их или перевести кому-то невозможно — таких функций нет."),
    ],
    [
      t("Код заморожен навсегда"),
      t("Контракт не обновляемый: это не прокси, правила нельзя переписать после деплоя. Что вы читаете в эксплорере — то и исполняется."),
    ],
  ];

  return (
    <div className="about-page">
      <div className="page-title">{t("О нас")}</div>
      <div className="page-sub" style={{ maxWidth: 720 }}>
        {t("hood — лаунчпад токенов на Robinhood Chain с революционной экономикой: треть всех торговых комиссий уходит в казну выкупа, из которой их невозможно вывести — только выкупать токены платформы. Мы зарабатываем вместе с комьюнити, а не на нём.")}
      </div>

      <h2 className="sec-h2" style={{ marginTop: 34 }}>{t("Как работает hood")}</h2>
      <div className="ana-grid" style={{ margin: "18px 0 8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {[
          [t("Запуск за секунды"), t("Имя, тикер, картинка — и токен живёт в блокчейне. Без кода и без предпродаж.")],
          [t("Честная кривая"), t("Цена растёт по математической кривой. Ранние покупатели платят меньше — всё прозрачно.")],
          [t("Градация на DEX"), t("Собрав 6.5 ETH, токен уходит на DEX с навсегда запертой ликвидностью.")],
          [t("Комиссии работают"), t("1% с каждой сделки делится между создателем, командой и казной выкупа.")],
        ].map(([title, text], i) => (
          <div className="ana-card step-card" key={i}>
            <div className="step-num">{i + 1}</div>
            <div className="fact-title">{title}</div>
            <div className="s" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</div>
          </div>
        ))}
      </div>

      <h2 className="sec-h2" style={{ marginTop: 34 }}>{t("Куда идут комиссии")}</h2>
      <div className="page-sub" style={{ margin: "7px 0 0" }}>
        {t("Каждая сделка на кривой платит комиссию 1%. Смарт-контракт делит её автоматически:")}
      </div>
      <div className="ana-grid" style={{ margin: "18px 0 8px" }}>
        <div className="ana-card">
          <div className="v" style={{ color: "var(--gold)", fontSize: 40 }}>{split.creator}%</div>
          <div className="k" style={{ marginTop: 8 }}>{t("создателю токена")}</div>
          <div className="s" style={{ marginTop: 6 }}>
            {t("Пассивный доход с первой же сделки — стимул строить долгосрочные проекты, а не бросать их.")}
          </div>
        </div>
        <div className="ana-card">
          <div className="v" style={{ fontSize: 40 }}>{split.team}%</div>
          <div className="k" style={{ marginTop: 8 }}>{t("команде")}</div>
          <div className="s" style={{ marginTop: 6 }}>
            {t("Разработка, инфраструктура и развитие платформы.")}
          </div>
        </div>
        <div className="ana-card">
          <div className="v" style={{ color: "var(--gold)", fontSize: 40 }}>{split.buyback}%</div>
          <div className="k" style={{ marginTop: 8 }}>{t("в казну выкупа")}</div>
          <div className="s" style={{ marginTop: 6 }}>
            {t("Возвращаются в рынок выкупами токенов платформы. Другого пути у этих денег нет.")}
          </div>
        </div>
      </div>

      <h2 className="sec-h2" style={{ marginTop: 34 }}>{t("Казна, из которой нельзя вывести")}</h2>
      <div className="page-sub" style={{ margin: "7px 0 0", maxWidth: 720 }}>
        {t("Мы не просим верить на слово — это гарантирует код. Вот что жёстко зашито в контракте казны:")}
      </div>
      <div className="ana-grid" style={{ margin: "18px 0 8px", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        {facts.map(([title, text], i) => (
          <div className="ana-card fact-card" key={i}>
            <div className="fact-check">✓</div>
            <div className="fact-title">{title}</div>
            <div className="s" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</div>
          </div>
        ))}
      </div>
      <div className="verify-note">
        <b style={{ color: "var(--leaf)" }}>✓ {t("Код верифицирован")}</b> · {t("Проверьте сами — откройте контракт казны в эксплорере:")}{" "}
        <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer">
          {t("Контракт казны")} →
        </a>
      </div>

      <h2 className="sec-h2" style={{ marginTop: 34 }}>{t("Голосование направляет казну")}</h2>
      <div className="page-sub" style={{ margin: "7px 0 0", maxWidth: 720, lineHeight: 1.65 }}>
        {t("Ваш голос напрямую влияет на то, куда пойдут деньги казны: каждую неделю комьюнити выбирает, какие токены поддержать выкупом. Один кошелёк — один голос, всё записано в блокчейне.")}
      </div>
      <div className="ana-grid" style={{ margin: "18px 0 8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {[
          [t("Вы голосуете"), t("Раз в неделю выбираете токен, который казна должна поддержать. Голос — маленькая транзакция в сети.")],
          [t("Казна слышит"), t("Итоги раунда видны всем в блокчейне — это главный ориентир, куда направить выкупы.")],
          [t("Команда исполняет"), t("Итоговое решение о выкупе принимает команда — это защита от накруток и манипуляций голосованием.")],
        ].map(([title, text], i) => (
          <div className="ana-card step-card" key={i}>
            <div className="step-num">{i + 1}</div>
            <div className="fact-title">{title}</div>
            <div className="s" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</div>
          </div>
        ))}
      </div>
      <div className="page-sub" style={{ margin: "4px 0 0", maxWidth: 720, lineHeight: 1.65 }}>
        {t("Каждый выкуп и сжигание видны на вкладке «Казна» и отмечаются прямо на графиках токенов — вы всегда можете проверить, что голоса не ушли в пустоту.")}
      </div>

      <div className="cta-row">
        <a className="btn btn-primary" href="#/create">{t("Запустить токен")}</a>
        <a className="btn" href="#/vote">{t("Смотреть голосование")}</a>
        <a className="btn" href="#/analytics">{t("Аналитика казны")}</a>
      </div>
    </div>
  );
}
