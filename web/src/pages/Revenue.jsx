import React, { useMemo, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { CHAT_DB_URL } from "../lib/config.js";

/** Revenue β — новая секция hood: токены с дивидендами из x402-выручки.
 *  Пока контракты не задеплоены в Base — страница объясняет механику,
 *  даёт интерактивный калькулятор и собирает заявки разработчиков. */
export default function Revenue() {
  const { t } = useLang();

  // --- калькулятор дивидендов
  const [rev, setRev] = useState(5000);      // $/мес выручка сервиса
  const [share, setShare] = useState(30);    // % холдерам
  const [stake, setStake] = useState(5);     // % supply у инвестора
  const pool = useMemo(() => Math.round(rev * share / 100), [rev, share]);
  const mine = useMemo(() => Math.round(rev * share / 100 * stake / 100), [rev, share, stake]);

  // --- форма заявки
  const [svc, setSvc] = useState("");
  const [link, setLink] = useState("");
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!svc.trim() || !contact.trim()) return;
    const rec = { svc: svc.trim().slice(0, 80), link: link.trim().slice(0, 200), contact: contact.trim().slice(0, 120), ts: Date.now() };
    try {
      const r = await fetch(`${CHAT_DB_URL}/revenue_waitlist.json`, {
        method: "POST", body: JSON.stringify(rec),
      });
      if (!r.ok) throw new Error("rtdb");
      setSent(true); setErr(false);
    } catch {
      setErr(true);
      // фолбэк: письмо (Email Routing contact@ уже настроен)
      const body = encodeURIComponent(`Service: ${rec.svc}\nLink: ${rec.link}\nContact: ${rec.contact}`);
      window.open(`mailto:contact@hoodandarrow.com?subject=${encodeURIComponent("Revenue token waitlist")}&body=${body}`);
    }
  }

  const steps = [
    [t("1 · Запусти токен выручки"), t("Одна транзакция деплоит токен, продажу и «копилку» — сплиттер с зашитыми долями. Изменить их после запуска не может никто.")],
    [t("2 · Смени одну строчку"), t("В конфиге x402 замени payTo на адрес копилки. Всё — никакого другого кода, интеграция закончена.")],
    [t("3 · Дивиденды капают сами"), t("Каждый платёж AI-агента делится контрактом: доля тебе, доля холдерам, 1% платформе. Выручка видна в блокчейне — подделать нельзя.")],
  ];

  return (
    <div className="rev-page">
      <div className="rev-hero">
        <span className="chip rev-beta">β · {t("скоро в testnet Base")}</span>
        <h1>{t("Токены с дивидендами")}</h1>
        <p className="rev-sub">
          {t("AI-агенты уже платят за API микроплатежами (протокол x402 — $50 млн за первый год). hood Revenue даёт разработчику превратить этот поток в токен: капитал сейчас — в обмен на долю будущей выручки. Не мем — актив с денежным потоком.")}
        </p>
      </div>

      <div className="rev-steps">
        {steps.map(([h, d]) => (
          <div className="rev-step" key={h}><b>{h}</b><span>{d}</span></div>
        ))}
      </div>

      <div className="rev-calc">
        <h2>{t("Посчитай дивиденды")}</h2>
        <div className="rev-sliders">
          <label>
            <span>{t("Выручка сервиса")}: <b>${rev.toLocaleString("en-US")}{t("/мес")}</b></span>
            <input type="range" min="500" max="50000" step="500" value={rev} onChange={(e) => setRev(+e.target.value)} />
          </label>
          <label>
            <span>{t("Доля холдеров")}: <b>{share}%</b></span>
            <input type="range" min="10" max="50" step="5" value={share} onChange={(e) => setShare(+e.target.value)} />
          </label>
          <label>
            <span>{t("Твой пакет токенов")}: <b>{stake}%</b></span>
            <input type="range" min="1" max="20" step="1" value={stake} onChange={(e) => setStake(+e.target.value)} />
          </label>
        </div>
        <div className="rev-out">
          <div><b>${pool.toLocaleString("en-US")}</b><span>{t("пул холдеров в месяц")}</span></div>
          <div><b>${mine.toLocaleString("en-US")}</b><span>{t("твои дивиденды в месяц")}</span></div>
          <div><b>${(mine * 12).toLocaleString("en-US")}</b><span>{t("за год")}</span></div>
        </div>
      </div>

      <div className="rev-form-wrap">
        <h2>{t("Есть платный API или MCP-сервер?")}</h2>
        <p className="rev-sub">{t("Оставь заявку — первые 20 запусков без комиссии платформы.")}</p>
        {sent ? (
          <div className="rev-done">{t("Заявка принята. Напишем, как только откроем testnet.")}</div>
        ) : (
          <form className="rev-form" onSubmit={submit}>
            <input placeholder={t("Название сервиса")} value={svc} onChange={(e) => setSvc(e.target.value)} maxLength={80} required />
            <input placeholder={t("Ссылка (сайт или GitHub)")} value={link} onChange={(e) => setLink(e.target.value)} maxLength={200} />
            <input placeholder={t("Контакт (email / X / Telegram)")} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} required />
            <button className="btn btn-primary" type="submit">{t("В список ранних")}</button>
            {err && <span className="rev-err">{t("Не удалось сохранить — открыл письмо, отправь его, пожалуйста.")}</span>}
          </form>
        )}
      </div>

      <p className="rev-legal">
        {t("Revenue-токены дают право на долю выручки и во многих юрисдикциях являются ценными бумагами. Секция запустится после юридической проверки; testnet — без реальных денег.")}
      </p>
    </div>
  );
}
