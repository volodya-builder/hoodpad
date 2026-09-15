import React from "react";
import { useLang } from "../lib/i18n.jsx";

/** Кнопки X / Telegram / сайт из метадаты монеты. Одна на страницу монеты
 *  и на шапку монеты во вкладке «ИИ». Ничего нет — ничего не рисуем. */
export default function Socials({ meta, style }) {
  const { t } = useLang();
  if (!meta || !(meta.x || meta.telegram || meta.website)) return null;
  return (
    <div className="soc-row" style={{ margin: 0, ...style }}>
      {meta.x && (
        <a className="soc-btn" title="X (Twitter)" target="_blank" rel="noreferrer"
           href={/^https?:\/\//.test(meta.x) ? meta.x : `https://x.com/${meta.x.replace(/^@/, "")}`}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 5.9-7zm-1.3 19.4h2L6.6 3.3H4.4l13.2 17.3z"/>
          </svg>
        </a>
      )}
      {meta.telegram && (
        <a className="soc-btn" title="Telegram" target="_blank" rel="noreferrer"
           href={/^https?:\/\//.test(meta.telegram) ? meta.telegram : `https://t.me/${meta.telegram.replace(/^@/, "")}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M21.9 3.4 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18.1 6.5c.4-.4-.1-.6-.6-.2L6 13.5l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.4 2c.9-.3 1.7.2 1.5 1.4z"/>
          </svg>
        </a>
      )}
      {meta.website && (
        <a className="soc-btn" title={t("Сайт")} target="_blank" rel="noreferrer"
           href={/^https?:\/\//.test(meta.website) ? meta.website : `https://${meta.website}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9"/>
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21M12 3C9.5 5.6 8.2 8.7 8.2 12s1.3 6.4 3.8 9"/>
          </svg>
        </a>
      )}
    </div>
  );
}
