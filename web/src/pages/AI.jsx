import React from "react";
import { useLang } from "../lib/i18n.jsx";
import Workshop from "../components/Workshop.jsx";
import Queue from "../components/Queue.jsx";
import Journal from "../components/Journal.jsx";

/** Вкладка «ИИ» — дом для всего, что мы строим в этом направлении.
 *
 *  Страница показывает то, ЧТО ЗДЕСЬ ДЕЛАЮТ: предлагают, голосуют, смотрят
 *  журнал. Объяснения, манифесты и оговорки сюда не возвращаем — они были,
 *  и из-за них живые блоки уезжали на третий экран, где их никто не видел.
 *
 *  Одно правило остаётся: не обещать того, чего нет. Пока агентов нет, это
 *  сказано прямо в шапке, а не спрятано между абзацев.
 */
export default function AI({ wallet, onConnect }) {
  const { t } = useLang();

  const cycle = [
    [t("Пн — Ср"), t("Холдеры предлагают, что строить. Порог — 1M токенов, чтобы не спамили.")],
    [t("Чт — Вс"), t("Голосование. Вес голоса — доля в монете.")],
    [t("Понедельник"), t("Победитель уходит в очередь. Агент берёт его в работу.")],
    [t("Всю неделю"), t("Агент строит и выкатывает. Результат и расход — в журнале.")],
  ];

  const never = [
    t("трогать деньги — переводы, торговлю, кошельки"),
    t("обещать доходность и звать покупать"),
    t("просить ключи, сид-фразы и платёжные данные"),
    t("выкатывать что-либо за пределы своего поддомена"),
  ];

  return (
    <div className="about-page ai-page">
      <div className="page-title">{t("ИИ монет")}</div>
      <div className="page-sub" style={{ maxWidth: 660 }}>
        {t("У каждой монеты свой ИИ. Холдеры решают, что он строит следующим. Он строит и выкатывает — публично, каждую неделю.")}
      </div>

      <div className="ai-note">
        {t("Агентов ещё нет. Но голосование уже идёт: решения копятся с первого дня, и к моменту, когда агент появится, у монеты будет готовая очередь задач.")}
      </div>

      <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Недельный круг")}</h2>
      <div className="ana-grid" style={{ margin: "18px 0 0", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {cycle.map(([title, text], i) => (
          <div className="ana-card step-card" key={i}>
            <div className="step-num">{i + 1}</div>
            <div className="fact-title">{title}</div>
            <div className="s" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</div>
          </div>
        ))}
      </div>

      <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Голосование холдеров")}</h2>
      <Workshop wallet={wallet} onConnect={onConnect} />

      <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Очередь задач")}</h2>
      <Queue />

      <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Журнал агента")}</h2>
      <Journal wallet={wallet} />

      {/* Границы — не реклама честности, а обязательство. Держим коротко и
          внизу: тот, кому важно, дочитает; остальным они не мешают. */}
      <div className="ai-limits">
        <span className="ai-limits-h">{t("Агент никогда не будет")}:</span>
        {never.map((x, i) => <span className="ai-limit" key={i}>{x}</span>)}
      </div>
      <div className="ai-limits-note">
        {t("Это зашито в код и не меняется голосованием — иначе достаточно купить долю и приказать.")}
      </div>
    </div>
  );
}
