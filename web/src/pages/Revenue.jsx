import React, { useMemo, useState, useEffect } from "react";
import { useLang } from "../lib/i18n.jsx";
import { CHAT_DB_URL } from "../lib/config.js";

/** Revenue β v3 — токены с дивидендами из x402-выручки.
 *  Запуск-форма (заявка в RTDB), витрина со спарклайнами и детальной
 *  карточкой, анимированная схема потока, калькулятор, FAQ. */

// Детерминированная история выручки за 12 месяцев (демо)
function series(seed, base) {
  let x = seed;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const out = [];
  let v = base * (0.25 + rnd() * 0.2);
  for (let i = 0; i < 12; i++) {
    v = Math.max(base * 0.1, v * (0.92 + rnd() * 0.28));
    out.push(Math.round(v));
  }
  out[11] = base;
  return out;
}

const DEMO = [
  { name: "Vasya Data API", sym: "VASYA", desc: "Он-чейн аналитика токенов, 117 инструментов", rev: 5200, share: 30, yld: 18.7, payers: 277, price: 0.1, seed: 7 },
  { name: "GeoTime Utils", sym: "GEO", desc: "Геокодинг и таймзоны для агентов", rev: 1400, share: 25, yld: 5.2, payers: 122, price: 0.04, seed: 13 },
  { name: "SignalFeed", sym: "SIGF", desc: "Крипто-новости и сигналы для ботов", rev: 2900, share: 35, yld: 11.6, payers: 115, price: 0.07, seed: 29 },
].map((d) => ({ ...d, hist: series(d.seed, d.rev) }));

function Spark({ data, w = 240, h = 56, stroke = "var(--gold)" }) {
  const mx = Math.max(...data), mn = Math.min(...data);
  const X = (i) => (i / (data.length - 1)) * (w - 8) + 4;
  const Y = (v) => h - 6 - ((v - mn) / Math.max(mx - mn, 1)) * (h - 14);
  const pts = data.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="rev-spark" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity=".9" />
      <circle cx={X(data.length - 1)} cy={Y(data[data.length - 1])} r="3" fill={stroke} />
    </svg>
  );
}

// Живая лента микроплатежей агентов (демо: симулируем поток x402-вызовов)
const AGENT_NAMES = ["gpt-trader-04", "claude-scout", "arb-bot-x7", "data-crawler", "signal-daemon", "quote-fetcher", "vault-keeper", "mev-sniffer", "kyc-checker", "geo-resolver"];
const TOOLS = ["VASYA", "GEO", "SIGF", "onchain-intel", "price-feed", "sentiment", "rug-scan"];

function LiveTicker({ t }) {
  const [rows, setRows] = useState(() =>
    Array.from({ length: 5 }, (_, i) => ({
      id: i,
      agent: AGENT_NAMES[i % AGENT_NAMES.length],
      tool: TOOLS[i % TOOLS.length],
      amt: (0.5 + Math.random() * 5).toFixed(3),
    }))
  );
  useEffect(() => {
    const id = setInterval(() => {
      setRows((prev) => {
        const next = {
          id: Date.now() + Math.random(),
          agent: AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)],
          tool: TOOLS[Math.floor(Math.random() * TOOLS.length)],
          amt: (0.5 + Math.random() * 5).toFixed(3),
        };
        return [next, ...prev].slice(0, 5);
      });
    }, 1400 + Math.random() * 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="rev-ticker">
      <div className="rev-ticker-head">
        <span className="rev-live-dot" /> {t("Живой поток платежей агентов")} <span className="rev-demo-tag">{t("демо")}</span>
      </div>
      {rows.map((r, i) => (
        <div className="rev-tick-row" key={r.id} style={{ opacity: 1 - i * 0.15 }}>
          <span className="rev-tick-agent">{r.agent}</span>
          <span className="rev-tick-arrow">→</span>
          <span className="rev-tick-tool">${r.tool}</span>
          <span className="rev-tick-amt">+{r.amt}¢</span>
        </div>
      ))}
    </div>
  );
}

function FlowDiagram({ t }) {
  return (
    <svg className="rev-flow" viewBox="0 0 640 264" role="img" aria-label={t("Схема: агенты платят API, копилка делит платежи")}>
      <defs>
        <marker id="rvarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>
      <g className="rev-fbox"><rect x="14" y="40" width="132" height="52" rx="10" /><text x="80" y="61" className="rev-ft">{t("AI-агенты")}</text><text x="80" y="78" className="rev-fs">{t("тысячи ботов")}</text></g>
      <line x1="146" y1="66" x2="242" y2="66" className="rev-fline" markerEnd="url(#rvarr)" />
      <circle r="3.5" className="rev-dot"><animateMotion dur="2.2s" repeatCount="indefinite" path="M150 66 L238 66" /></circle>
      <g className="rev-fbox"><rect x="250" y="40" width="140" height="52" rx="10" /><text x="320" y="61" className="rev-ft">{t("API сервиса")}</text><text x="320" y="78" className="rev-fs">x402 · ~$0.03</text></g>
      <line x1="320" y1="92" x2="320" y2="144" className="rev-fline" markerEnd="url(#rvarr)" />
      <circle r="3.5" className="rev-dot"><animateMotion dur="1.8s" begin="0.5s" repeatCount="indefinite" path="M320 96 L320 140" /></circle>
      <g className="rev-fbox rev-fgold"><rect x="250" y="150" width="140" height="52" rx="10" /><text x="320" y="171" className="rev-ft">{t("Копилка")}</text><text x="320" y="188" className="rev-fs">{t("делит сама, навсегда")}</text></g>
      <line x1="390" y1="164" x2="474" y2="52" className="rev-fline" markerEnd="url(#rvarr)" />
      <line x1="390" y1="176" x2="474" y2="176" className="rev-fline" markerEnd="url(#rvarr)" />
      <line x1="390" y1="190" x2="474" y2="234" className="rev-fline" markerEnd="url(#rvarr)" />
      <circle r="3" className="rev-dot"><animateMotion dur="1.6s" begin="0.2s" repeatCount="indefinite" path="M392 163 L470 54" /></circle>
      <circle r="3" className="rev-dot"><animateMotion dur="1.6s" begin="0.7s" repeatCount="indefinite" path="M392 176 L470 176" /></circle>
      <circle r="3" className="rev-dot"><animateMotion dur="1.6s" begin="1.1s" repeatCount="indefinite" path="M392 189 L470 232" /></circle>
      <g className="rev-fbox"><rect x="480" y="28" width="146" height="44" rx="10" /><text x="553" y="46" className="rev-ft">{t("Разработчик")}</text><text x="553" y="62" className="rev-fs">69%</text></g>
      <g className="rev-fbox rev-fgold"><rect x="480" y="154" width="146" height="44" rx="10" /><text x="553" y="172" className="rev-ft">{t("Холдеры токена")}</text><text x="553" y="188" className="rev-fs">30% · {t("дивиденды")}</text></g>
      <g className="rev-fbox"><rect x="480" y="212" width="146" height="44" rx="10" /><text x="553" y="230" className="rev-ft">hood</text><text x="553" y="246" className="rev-fs">1%</text></g>
    </svg>
  );
}

// Запись заявки в Firebase (append-only), фолбэк — письмо
async function pushWaitlist(rec) {
  const r = await fetch(`${CHAT_DB_URL}/revenue_waitlist.json`, { method: "POST", body: JSON.stringify(rec) });
  if (!r.ok) throw new Error("rtdb");
}
function mailFallback(rec) {
  const body = encodeURIComponent(Object.entries(rec).map(([k, v]) => `${k}: ${v}`).join("\n"));
  window.open(`mailto:contact@hoodandarrow.com?subject=${encodeURIComponent("Revenue token waitlist")}&body=${body}`);
}

function LaunchModal({ t, onClose, onDone }) {
  const [name, setName] = useState("");
  const [sym, setSym] = useState("");
  const [api, setApi] = useState("");
  const [share, setShare] = useState(30);
  const [salePct, setSalePct] = useState(40);
  const [supply, setSupply] = useState(1_000_000);
  const [price, setPrice] = useState(0.05);
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const raise = Math.round(supply * (salePct / 100) * price);
  const devPct = Math.max(0, 100 - share - 1);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !contact.trim()) return;
    setBusy(true);
    const rec = {
      svc: name.trim().slice(0, 80), link: api.trim().slice(0, 200), contact: contact.trim().slice(0, 120),
      sym: sym.trim().toUpperCase().slice(0, 10), share, salePct, supply, price, ts: Date.now(),
    };
    try { await pushWaitlist(rec); onDone(); }
    catch { setErr(true); mailFallback(rec); }
    setBusy(false);
  }

  return (
    <div className="modal-back open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rev-launch-modal">
        <div className="rev-lm-head">
          <b>{t("Запустить revenue-токен")}</b>
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="rev-lm-grid">
            <label>{t("Название сервиса")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Data API" maxLength={80} required /></label>
            <label>{t("Тикер")}<input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="MYAPI" maxLength={10} /></label>
          </div>
          <label>{t("Ссылка на API / GitHub / сайт")}<input value={api} onChange={(e) => setApi(e.target.value)} placeholder="https://…" maxLength={200} /></label>
          <label>{t("Контакт (email / X / Telegram)")}<input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@handle" maxLength={120} required /></label>

          <label className="rev-lm-slider">
            <span>{t("Доля холдеров от выручки")}: <b>{share}%</b> <span className="dim">· {t("тебе")} {devPct}% · hood 1%</span></span>
            <input type="range" min="10" max="50" step="5" value={share} onChange={(e) => setShare(+e.target.value)} />
          </label>
          <div className="rev-split rev-split-big" style={{ marginTop: 4 }}>
            <div style={{ flex: devPct }} className="rev-sp-dev" />
            <div style={{ flex: share }} className="rev-sp-hold" />
            <div style={{ flex: 1 }} className="rev-sp-hood" />
          </div>

          <div className="rev-lm-grid3">
            <label>{t("Сапплай")}<input type="number" min="1000" value={supply} onChange={(e) => setSupply(+e.target.value || 0)} /></label>
            <label>{t("На продажу, %")}<input type="number" min="1" max="90" value={salePct} onChange={(e) => setSalePct(+e.target.value || 0)} /></label>
            <label>{t("Цена, $")}<input type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(+e.target.value || 0)} /></label>
          </div>

          <div className="rev-lm-raise">
            {t("Соберёшь при полной продаже")}: <b>${raise.toLocaleString("en-US")}</b>
            <span className="dim"> · {t("комиссия hood 2% с продажи")}</span>
          </div>

          <div className="rev-lm-note">
            {t("Это заявка в очередь testnet Base — деньги не участвуют. Первые 20 запусков — без комиссии платформы. Параметры сохраним и напишем тебе, когда откроем запуск.")}
          </div>
          {err && <div className="rev-err">{t("Не удалось сохранить — открыл письмо, отправь его, пожалуйста.")}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "…" : t("Забронировать запуск")}
          </button>
        </form>
      </div>
    </div>
  );
}

function DetailModal({ t, d, paid, onSim, onClose }) {
  const mx = Math.max(...d.hist);
  return (
    <div className="modal-back open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rev-launch-modal">
        <div className="rev-lm-head">
          <b>{d.name} <span className="dim">${d.sym}</span></b>
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p className="rev-card-desc" style={{ minHeight: 0 }}>{t(d.desc)} · <span className="rev-live">▲ {t("живой")}</span></p>

        <div className="rev-detail-chart">
          <div className="rev-dc-head"><span>{t("Выручка по месяцам")}</span><b>${d.rev.toLocaleString("en-US")}{t("/мес")}</b></div>
          <div className="rev-bars">
            {d.hist.map((v, i) => (
              <div key={i} className="rev-bar" style={{ height: `${Math.max((v / mx) * 100, 4)}%` }} title={`$${v.toLocaleString("en-US")}`} />
            ))}
          </div>
        </div>

        <div className="rev-card-kv" style={{ marginTop: 12 }}>
          <div><b className="rev-gold">{d.yld}%</b><span>{t("дивидендная доходность")}</span></div>
          <div><b>{d.payers}</b><span>{t("платящих агентов")}</span></div>
          <div><b>${paid.toLocaleString("en-US")}</b><span>{t("выплачено холдерам")}</span></div>
        </div>

        <div className="rev-split rev-split-big" style={{ marginTop: 12 }}>
          <div style={{ flex: 100 - d.share - 1 }} className="rev-sp-dev" />
          <div style={{ flex: d.share }} className="rev-sp-hold" />
          <div style={{ flex: 1 }} className="rev-sp-hood" />
        </div>
        <div className="rev-split-legend">
          <span><i className="rev-sp-dev" />{t("Разработчик")} {100 - d.share - 1}%</span>
          <span><i className="rev-sp-hold" />{t("Холдеры")} {d.share}%</span>
          <span><i className="rev-sp-hood" />hood 1%</span>
        </div>

        <div className="row" style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled title={t("Откроется вместе с testnet Base")}>{t("Купить")} · testnet</button>
          <button className="btn" onClick={onSim}>⏩ {t("прокрутить месяц")}</button>
        </div>
      </div>
    </div>
  );
}

export default function Revenue() {
  const { t } = useLang();
  const [paid, setPaid] = useState([1860, 610, 1670]);
  const [toast, setToast] = useState("");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [detail, setDetail] = useState(null); // index | null

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

  const faq = [
    [t("Чем это отличается от мем-токена?"), t("За мемом — только вера толпы. Здесь токен привязан к работающему сервису: смарт-контракт каждый месяц раздаёт холдерам долю реальной выручки в стейблкоинах. Держишь — получаешь, даже не продавая.")],
    [t("Откуда берётся выручка?"), t("AI-агенты (боты на ChatGPT, Claude и других) платят крошечные суммы за каждый вызов полезного API по протоколу x402 от Coinbase. За первый год через протокол прошло ~$50 млн и 165 млн платежей.")],
    [t("Можно ли подделать выручку?"), t("Платежи идут в блокчейне и видны каждому. Копилка — контракт с зашитыми долями: ни разработчик, ни hood не могут изменить правила или забрать чужое.")],
    [t("Когда запуск?"), t("Сначала testnet в сети Base (без реальных денег), параллельно — юридическая проверка: revenue-токены во многих странах считаются ценными бумагами. Ранние из списка получат запуск без комиссии.")],
  ];

  return (
    <div className="rev-page">
      {toast && <div className="rev-toast">{toast}</div>}
      {launchOpen && <LaunchModal t={t} onClose={() => setLaunchOpen(false)} onDone={() => { setLaunchOpen(false); setLaunched(true); }} />}
      {detail !== null && <DetailModal t={t} d={DEMO[detail]} paid={paid[detail]} onSim={() => simMonth(detail)} onClose={() => setDetail(null)} />}

      <div className="rev-hero">
        <span className="chip rev-beta">β · {t("скоро в testnet Base")}</span>
        <h1>{t("Токены с дивидендами")}</h1>
        <p className="rev-sub">
          {t("Мемы живут верой. Эти токены — выручкой: AI-агенты платят за API, контракт раздаёт холдерам долю каждого платежа. Пассивный доход в стейблкоинах, который видно в блокчейне.")}
        </p>
        <div className="rev-cta">
          <button className="btn btn-primary" onClick={() => setLaunchOpen(true)}>+ {t("Запустить revenue-токен")}</button>
          <a className="btn" href="#rev-how">{t("Как это работает")}</a>
        </div>
        {launched && <div className="rev-done" style={{ marginTop: 12 }}>{t("Заявка принята. Напишем, как только откроем testnet.")}</div>}
        <div className="rev-stats">
          <div><b>$50 {t("млн")}</b><span>{t("объём платежей x402 за год")}</span></div>
          <div><b>165 {t("млн")}</b><span>{t("микроплатежей агентов")}</span></div>
          <div><b>69 000</b><span>{t("платящих агентов")}</span></div>
        </div>
      </div>

      <LiveTicker t={t} />

      <h2 className="rev-h2" id="rev-how">{t("Как текут деньги")}</h2>
      <div className="rev-flow-wrap"><FlowDiagram t={t} /></div>

      <h2 className="rev-h2">{t("Мем-токен против revenue-токена")}</h2>
      <div className="rev-vs">
        <div className="rev-vs-col meme">
          <div className="rev-vs-title">{t("Обычный мем-токен")}</div>
          {[
            t("Стоит только на вере и хайпе"),
            t("Доход — лишь если продать дороже"),
            t("Кончился хайп — цена в ноль"),
            t("Ничего за токеном не стоит"),
          ].map((x) => <div className="rev-vs-item bad" key={x}><span>✕</span>{x}</div>)}
        </div>
        <div className="rev-vs-col rev">
          <div className="rev-vs-title">{t("Revenue-токен")} <span className="rev-demo-tag">hood</span></div>
          {[
            t("Привязан к работающему сервису"),
            t("Дивиденды капают, даже если не продавать"),
            t("Растёт выручка — обоснованно растёт цена"),
            t("Выручка видна в блокчейне, подделать нельзя"),
          ].map((x) => <div className="rev-vs-item ok" key={x}><span>✓</span>{x}</div>)}
        </div>
      </div>

      <h2 className="rev-h2">{t("Кому это выгодно")}</h2>
      <div className="rev-persona">
        <div className="rev-persona-card">
          <div className="rev-persona-h">{t("Разработчику API")}</div>
          <p>{t("Банк не даст кредит, венчур не придёт к маленькому сервису, грант — лотерея. Токен на hood — доступный капитал сейчас + бесплатный маркетинг: сам запуск приводит толпу инвесторов, которые становятся и пользователями.")}</p>
          <div className="rev-persona-tags">
            <span>{t("капитал без банка")}</span><span>{t("маркетинг")}</span><span>{t("комьюнити")}</span>
          </div>
          <button className="btn btn-primary" onClick={() => setLaunchOpen(true)}>+ {t("Запустить revenue-токен")}</button>
        </div>
        <div className="rev-persona-card">
          <div className="rev-persona-h">{t("Инвестору")}</div>
          <p>{t("Не лотерея на хайпе, а актив с денежным потоком: покупаешь долю выручки работающего сервиса и получаешь дивиденды в стейблкоинах. Выручка публична в блокчейне — можно оценить бизнес до покупки, как акцию.")}</p>
          <div className="rev-persona-tags">
            <span>{t("дивиденды в USDC")}</span><span>{t("прозрачная выручка")}</span><span>{t("оценка как акции")}</span>
          </div>
          <a className="btn" href="#rev-storefront">{t("Смотреть токены")}</a>
        </div>
      </div>

      <h2 className="rev-h2">{t("Дорожная карта")}</h2>
      <div className="rev-roadmap">
        {[
          { s: t("Готово"), d: t("Витрина, калькулятор, форма запуска, сбор заявок"), st: "done" },
          { s: t("Сейчас"), d: t("Контракты: копилка-сплиттер и дивиденды (протестированы)"), st: "done" },
          { s: t("Дальше"), d: t("Testnet Base: живые запуски без реальных денег"), st: "now" },
          { s: t("Потом"), d: t("Юридическая структура и mainnet"), st: "next" },
        ].map((r, i) => (
          <div className={`rev-rm-step ${r.st}`} key={i}>
            <div className="rev-rm-dot" />
            <div className="rev-rm-body"><b>{r.s}</b><span>{r.d}</span></div>
          </div>
        ))}
      </div>

      <h2 className="rev-h2" id="rev-storefront">{t("Витрина после запуска")} <span className="rev-demo-tag">{t("демо")}</span></h2>
      <div className="rev-cards">
        {DEMO.map((d, i) => (
          <div className="rev-card rev-card-click" key={d.sym} onClick={() => setDetail(i)}
               role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setDetail(i)}>
            <div className="rev-card-top">
              <div><b>{d.name}</b><span className="rev-card-sym">${d.sym}</span></div>
              <span className="rev-live">▲ {t("живой")}</span>
            </div>
            <Spark data={d.hist} />
            <div className="rev-card-kv">
              <div><b>${d.rev.toLocaleString("en-US")}</b><span>{t("выручка")}{t("/мес")}</span></div>
              <div><b className="rev-gold">{d.yld}%</b><span>{t("дивидендная доходность")}</span></div>
              <div><b>${paid[i].toLocaleString("en-US")}</b><span>{t("выплачено холдерам")}</span></div>
            </div>
            <div className="rev-card-open dim">{t("Открыть карточку")} →</div>
          </div>
        ))}
      </div>

      <div className="rev-calc">
        <h2>{t("Посчитай дивиденды")}</h2>
        <div className="rev-sliders">
          <label><span>{t("Выручка сервиса")}: <b>${rev.toLocaleString("en-US")}{t("/мес")}</b></span>
            <input type="range" min="500" max="50000" step="500" value={rev} onChange={(e) => setRev(+e.target.value)} /></label>
          <label><span>{t("Доля холдеров")}: <b>{share}%</b></span>
            <input type="range" min="10" max="50" step="5" value={share} onChange={(e) => setShare(+e.target.value)} /></label>
          <label><span>{t("Твой пакет токенов")}: <b>{stake}%</b></span>
            <input type="range" min="1" max="20" step="1" value={stake} onChange={(e) => setStake(+e.target.value)} /></label>
        </div>
        <div className="rev-split rev-split-big">
          <div style={{ flex: 100 - share - 1 }} className="rev-sp-dev" />
          <div style={{ flex: share }} className="rev-sp-hold" />
          <div style={{ flex: 1 }} className="rev-sp-hood" />
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
        {faq.map(([q, a]) => (<details key={q}><summary>{q}</summary><p>{a}</p></details>))}
      </div>

      <div className="rev-form-wrap">
        <h2>{t("Есть платный API или MCP-сервер?")}</h2>
        <p className="rev-sub">{t("Оставь заявку — первые 20 запусков без комиссии платформы.")}</p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setLaunchOpen(true)}>+ {t("Запустить revenue-токен")}</button>
      </div>

      <p className="rev-legal">
        {t("Revenue-токены дают право на долю выручки и во многих юрисдикциях являются ценными бумагами. Секция запустится после юридической проверки; testnet — без реальных денег.")}
      </p>
    </div>
  );
}
