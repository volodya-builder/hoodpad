import React from "react";
import { useSplit } from "../lib/data.js";
import { useLang } from "../lib/i18n.jsx";
import { TREASURY_ADDRESS, EXPLORER } from "../lib/config.js";

export default function About() {
  const { t } = useLang();
  const split = useSplit();

  const steps = [
    [t("Запуск за секунды"), t("Имя, тикер, картинка — и токен уже в блокчейне.")],
    [t("Честная кривая"), t("Цена растёт по кривой. Без предпродаж и инсайдеров.")],
    [t("Градация на DEX"), t("6.5 ETH — и токен на DEX с запертой ликвидностью.")],
    [t("Комиссии работают"), t("1% с трейда: создателю, команде, в казну выкупа.")],
  ];

  const facts = [
    t("Функции вывода не существует"),
    t("ETH уходит только в пулы hood"),
    t("Купленное — только держать или сжечь"),
    t("Код заморожен навсегда"),
  ];

  return (
    <div className="about-page">
      <div className="page-title">{t("О нас")}</div>
      <div className="page-sub" style={{ maxWidth: 640 }}>
        {t("Жадные копят — hood возвращает. Треть торговых комиссий уходит в казну, которая умеет только одно: выкупать токены платформы.")}
      </div>

      <div className="hero-chips">
        <span className="chip">{t("Комиссия запуска")} <b>0 ETH</b></span>
        <span className="chip">{t("Комиссия трейда")} <b>1%</b></span>
        <span className="chip">{t("Градация")} <b>6.5 ETH</b></span>
        <span className="chip">{t("Ликвидность")} <b>{t("Заперта навсегда")}</b></span>
      </div>

      <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Как работает hood")}</h2>
      <div className="ana-grid" style={{ margin: "18px 0 8px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {steps.map(([title, text], i) => (
          <div className="ana-card step-card" key={i}>
            <div className="step-num">{i + 1}</div>
            <div className="fact-title">{title}</div>
            <div className="s" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</div>
          </div>
        ))}
      </div>

      <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Куда идут комиссии")}</h2>
      <div className="page-sub" style={{ margin: "7px 0 0" }}>
        {t("Каждая сделка на кривой платит комиссию 1%. Смарт-контракт делит её автоматически:")}
      </div>
      <div className="split-bar">
        <div className="seg creator" style={{ width: `${split.creator}%` }}>{split.creator}%</div>
        <div className="seg buyback" style={{ width: `${split.buyback}%` }}>{split.buyback}%</div>
        <div className="seg team" style={{ width: `${split.team}%` }}>{split.team}%</div>
      </div>
      <div className="split-legend">
        <span><i className="dot creator" />{t("создателю токена")}</span>
        <span><i className="dot buyback" />{t("в казну выкупа")}</span>
        <span><i className="dot team" />{t("команде")}</span>
      </div>

      <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Казна, из которой нельзя вывести")}</h2>
      <div className="check-list">
        {facts.map((title, i) => (
          <div className="check-item" key={i}>
            <span className="fact-check" style={{ position: "static" }}>✓</span>
            <span>{title}</span>
          </div>
        ))}
      </div>
      <div className="verify-note" style={{ marginTop: 14 }}>
        <b style={{ color: "var(--leaf)" }}>✓ {t("Код верифицирован")}</b> · {t("Проверьте сами — откройте контракт казны в эксплорере:")}{" "}
        <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer">
          {t("Контракт казны")} →
        </a>
      </div>

      <h2 className="sec-h2" style={{ marginTop: 40 }}>{t("Голосование направляет казну")}</h2>
      <div className="page-sub" style={{ margin: "7px 0 0", maxWidth: 680, lineHeight: 1.65 }}>
        {t("Каждую неделю комьюнити голосует, какие токены поддержать выкупом. Итоги видны в блокчейне, а сами выкупы — на вкладке «Казна» и на графиках токенов.")}
      </div>

      <div className="cta-row">
        <a className="btn btn-primary" href="#/create">{t("Запустить токен")}</a>
        <a className="btn" href="#/vote">{t("Смотреть голосование")}</a>
        <a className="btn" href="#/analytics">{t("Аналитика казны")}</a>
      </div>
    </div>
  );
}
