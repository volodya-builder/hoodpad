import React, { useMemo, useState } from "react";
import { useLang } from "../lib/i18n.jsx";
import { CHAT_DB_URL } from "../lib/config.js";

/** Revenue β — токены с дивидендами из x402-выручки.
 *  Схема потока (SVG с анимацией), демо-витрина, калькулятор, FAQ, waitlist. */

const DEMO = [
  { name: "Vasya Data API", sym: "VASYA", desc: "Он-чейн аналитика токенов, 117 инструментов", rev: 5200, share: 30, yld: 18.7 },
  { name: "GeoTime Utils", sym: "GEO", desc: "Геокодинг и таймзоны для агентов", rev: 1400, share: 25, yld: 5.2 },
  { name: "SignalFeed", sym: "SIGF", desc: "Крипто-новости и сигналы для ботов", rev: 2900, share: 35, yld: 11.6 },
];

function FlowDiagram({ t }) {
  return (
    <svg className="rev-flow" viewBox="0 0 640 264" role="img" aria-label={t("Схема: агенты платят API, копилка делит платежи")}>
      <defs>
        <marker id="rvarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      <g className="rev-fbox">
        <rect x="14" y="40" width="132" height="52" rx="10" />
        <text x="80" y="61" className="rev-ft">{t("AI-агенты")}</text>
        <text x="80" y="78" className="rev-fs">{t("тысячи ботов")}</text>
      </g>

      <line x1="146" y1="66" x2="242" y2="66" className="rev-fline" markerEnd="url(#rvarr)" />
      <circle r="3.5" className="rev-dot">
        <animateMotion dur="2.2s" repeatCount="indefinite" path="M150 66 L238 66" />
      </circle>

      <g className="rev-fbox">
        <rect x="250" y="40" width="140" height="52" rx="10" />
        <text x="320" y="61" className="rev-ft">{t("API сервиса")}</text>
        <text x="320" y="78" className="rev-fs">x402 · ~$0.03</text>
      </g>

      <line x1="320" y1="92" x2="320" y2="144" className="rev-fline" markerEnd="url(#rvarr)" />
      <circle r="3.5" className="rev-dot">
        <animateMotion dur="1.8s" begin="0.5s" repeatCount="indefinite" path="M320 96 L320 140" />
      </circle>

      <g className="rev-fbox rev-fgold">
        <rect x="250" y="150" width="140" height="52" rx="10" />
        <text x="320" y="171" className="rev-ft">{t("Копилка")}</text>
        <text x="320" y="188" className="rev-fs">{t("делит сама, навсегда")}</text>
      </g>

      <line x1="390" y1="164" x2="474" y2="52" className="rev-fline" markerEnd="url(#rvarr)" />
      <line x1="390" y1="176" x2="474" y2="176" className="rev-fline" markerEnd="url(#rvarr)" />
      <line x1="390" y1="190" x2="474" y2="234" className="rev-fline" markerEnd="url(#rvarr)" />
      <circle r="3" className="rev-dot"><animateMotion dur="1.6s" begin="0.2s" repeatCount="indefinite" path="M392 163 L470 54" /></circle>
      <circle r="3" className="rev-dot"><animateMotion dur="1.6s" begin="0.7s" repeatCount="indefinite" path="M392 176 L470 176" /></circle>
      <circle r="3" className="rev-dot"><animateMotion dur="1.6s" begin="1.1s" repeatCount="indefinite" path="M392 189 L470 232" /></circle>

      <g className="rev-fbox">
        <rect x="480" y="28" width="146" height="44" rx="10" />
        <text x="553" y="46" className="rev-ft">{t("Разработчик")}</text>
        <text x="553" y="62" className="rev-fs">69%</text>
      </g>
      <g className="rev-fbox rev-fgold">
        <rect x="480" y="154" width="146" height="44" rx="10" />
        <text x="553" y="172" className="rev-ft">{t("Холдеры токена")}</text>
        <text x="553" y="188" className="rev-fs">30% · {t("дивиденды")}</text>
      </g>
      <g className="rev-fbox">
        <rect x="480" y="212" width="146" height="44" rx="10" />
        <text x="553" y="230" className="rev-ft">hood</text>
        <text x="553" y="246" className="rev-fs">1%</text>
      </g>
    </svg>
  );
}

export default function Revenue() {
  const { t } = useLang();

  // демо-витрина: симуляция месяца
  const [paid, setPaid] = useState([1860, 610, 1670]);
  const [toast, setToast] = useState("");
  function simMonth(i) {
    const d = DEMO[i];
    const pool = Math.round(d.rev * (0.9 + Math.random() * 0.3) * d.share / 100);
    setPaid((p) => p.map((v, j) => (j === i ? v + pool : v)));
    setToast(`$${d.sym}: +$${pool.toLocaleString("en-US")} ${t("холдерам за месяц")}`);
    setTimeout(() => setToast(""), 2600);
  }

  // калькулятор
  const [rev, setRev] = useState(5000);
  const [share, setShare] = useState(30);
  const [stake, setStake] = useState(5);
  const pool = useMemo(() => Math.round(rev * share / 100), [rev, share]);
  const mine = useMemo(() => Math.round(rev * share / 100 * stake / 100), [rev, share, stake]);

  // waitlist
  const [svc, setSvc] = useState(""); const [link, setLink] = useState("");
  const [contact, setContact] = useState(""); const [sent, setSent] = useState(false); const [err, setErr] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!svc.trim() || !contact.trim()) return;
    const rec = { svc: svc.trim().slice(0, 80), link: link.trim().slice(0, 200), contact: contact.trim().slice(0, 120), ts: Date.now() };
    try {
      const r = await fetch(`${CHAT_DB_URL}/revenue_waitlist.json`, { method: "POST", body: JSON.stringify(rec) });
      if (!r.ok) throw new Error("rtdb");
      setSent(true); setErr(false);
    } catch {
      setErr(true);
      const body = encodeURIComponent(`Service: ${rec.svc}\nLink: ${rec.link}\nContact: ${rec.contact}`);
      window.open(`mailto:contact@hoodandarrow.com?subject=${encodeURIComponent("Revenue token waitlist")}&body=${body}`);
    }
  }

  const faq = [
    [t("Чем это отличается от мем-токена?"), t("За мемом — только вера толпы. Здесь токен привязан к работающему сервису: смарт-контракт каждый месяц раздаёт холдерам долю реальной выручки в стейблкоинах. Держишь — получаешь, даже не продавая.")],
    [t("Откуда берётся выручка?"), t("AI-агенты (боты на ChatGPT, Claude и других) платят крошечные суммы за каждый вызов полезного API по протоколу x402 от Coinbase. За первый год через протокол прошло ~$50 млн и 165 млн платежей.")],
    [t("Можно ли подделать выручку?"), t("Платежи идут в блокчейне и видны каждому. Копилка — контракт с зашитыми долями: ни разработчик, ни hood не могут изменить правила или забрать чужое.")],
    [t("Когда запуск?"), t("Сначала testnet в сети Base (без реальных денег), параллельно — юридическая проверка: revenue-токены во многих странах считаются ценными бумагами. Ранние из списка получат запуск без комиссии.")],
  ];

  return (
    <div className="rev-page">
      {toast && <div className="rev-toast">{toast}</div>}

      <div className="rev-hero">
        <span className="chip rev-beta">β · {t("скоро в testnet Base")}</span>
        <h1>{t("Токены с дивидендами")}</h1>
        <p className="rev-sub">
          {t("Мемы живут верой. Эти токены — выручкой: AI-агенты платят за API, контракт раздаёт холдерам долю каждого платежа. Пассивный доход в стейблкоинах, который видно в блокчейне.")}
        </p>
        <div className="rev-stats">
          <div><b>$50 {t("млн")}</b><span>{t("объём платежей x402 за год")}</span></div>
          <div><b>165 {t("млн")}</b><span>{t("микроплатежей агентов")}</span></div>
          <div><b>69 000</b><span>{t("платящих агентов")}</span></div>
        </div>
      </div>

      <h2 className="rev-h2">{t("Как текут деньги")}</h2>
      <div className="rev-flow-wrap"><FlowDiagram t={t} /></div>

      <h2 className="rev-h2">{t("Витрина после запуска")} <span className="rev-demo-tag">{t("демо")}</span></h2>
      <div className="rev-cards">
        {DEMO.map((d, i) => (
          <div className="rev-card" key={d.sym}>
            <div className="rev-card-top">
              <div><b>{d.name}</b><span className="rev-card-sym">${d.sym}</span></div>
              <span className="rev-live">▲ {t("живой")}</span>
            </div>
            <p className="rev-card-desc">{t(d.desc)}</p>
            <div className="rev-split">
              <div style={{ flex: 100 - d.share - 1 }} className="rev-sp-dev" />
              <div style={{ flex: d.share }} className="rev-sp-hold" />
              <div style={{ flex: 1 }} className="rev-sp-hood" />
            </div>
            <div className="rev-card-kv">
              <div><b>${d.rev.toLocaleString("en-US")}</b><span>{t("выручка")}{t("/мес")}</span></div>
              <div><b className="rev-gold">{d.yld}%</b><span>{t("дивидендная доходность")}</span></div>
              <div><b>${paid[i].toLocaleString("en-US")}</b><span>{t("выплачено холдерам")}</span></div>
            </div>
            <button className="btn rev-sim" onClick={() => simMonth(i)}>⏩ {t("прокрутить месяц")}</button>
          </div>
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
        <div className="rev-split rev-split-big">
          <div style={{ flex: 100 - share - 1 }} className="rev-sp-dev" title={t("Разработчик")} />
          <div style={{ flex: share }} className="rev-sp-hold" title={t("Холдеры токена")} />
          <div style={{ flex: 1 }} className="rev-sp-hood" title="hood 1%" />
        </div>
        <div className="rev-split-legend">
          <span><i className="rev-sp-dev" />{t("Разработчик")} {100 - share - 1}%</span>
          <span><i className="rev-sp-hold" />{t("Холдеры")} {share}%</span>
          <span><i className="rev-sp-hood" />hood 1%</span>
        </div>
        <div className="rev-out">
          <div><b>${pool.toLocaleString("en-US")}</b><span>{t("пул холдеров в месяц")}</span></div>
          <div><b>${mine.toLocaleString("en-US")}</b><span>{t("твои дивиденды в месяц")}</span></div>
          <div><b>${(mine * 12).toLocaleString("en-US")}</b><span>{t("за год")}</span></div>
        </div>
      </div>

      <h2 className="rev-h2">{t("Вопросы")}</h2>
      <div className="rev-faq">
        {faq.map(([q, a]) => (
          <details key={q}><summary>{q}</summary><p>{a}</p></details>
        ))}
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
