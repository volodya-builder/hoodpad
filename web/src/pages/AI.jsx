import React from "react";
import { useLang } from "../lib/i18n.jsx";
import Board from "../components/Board.jsx";
import Workshop from "../components/Workshop.jsx";
import Queue from "../components/Queue.jsx";
import Journal from "../components/Journal.jsx";
import { FEATURES } from "../lib/config.js";

/** Вкладка «ИИ»: доска идей монеты и что построено. Только действие:
 *  написать, проголосовать, открыть результат. Объяснения — в подсказках.
 *  Weekly-мастерская (Workshop/Queue/Journal) остаётся за FEATURES.weeklyWorkshop. */
export default function AI({ wallet, onConnect }) {
  const { t } = useLang();
  return (
    <div className="about-page ai-page">
      <div className="page-title">{t("ИИ монет")}</div>
      <div className="page-sub" style={{ maxWidth: 660 }}>
        {t("Напишите, что построить, проголосуйте — агент забирает верхнюю идею, как только освободится, и выкладывает результат сюда.")}
      </div>
      <Board wallet={wallet} onConnect={onConnect} />
      {FEATURES.weeklyWorkshop && (
        <>
          <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Голосование холдеров")}</h2>
          <Workshop wallet={wallet} onConnect={onConnect} />
          <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Очередь задач")}</h2>
          <Queue />
          <h2 className="sec-h2" style={{ marginTop: 52 }}>{t("Журнал агента")}</h2>
          <Journal wallet={wallet} />
        </>
      )}
    </div>
  );
}
