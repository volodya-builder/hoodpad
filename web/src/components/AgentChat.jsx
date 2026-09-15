import React, { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_API_URL, CHAT_DB_URL, FEATURES } from "../lib/config.js";
import { short } from "../lib/web3.js";
import { useLang } from "../lib/i18n.jsx";
import { modelLogo } from "../lib/models.mjs";
import Icon from "./Icon.jsx";

// Чат холдеров с ИИ монеты. Общая комната на монету: читают все, пишут
// только холдеры (баланс > 0), отвечает модель монеты. Сообщения хранит
// воркер (worker/), сайт их только читает — живым потоком из RTDB.
//
// Вход: одна подпись кошельком раз в неделю (сессия лежит в localStorage),
// дальше сообщения уходят в воркер с этой сессией. Ключ модели в браузер
// не попадает никогда.

const SESSION_KEY = (addr) => `hood_aichat_s_${addr.toLowerCase()}`;
/** Текст входа — тот же, что проверяет воркер (worker/src/core.js). */
const loginMessage = (address, ts) => `hood ai chat\naddress: ${address.toLowerCase()}\nts: ${ts}`;
const MAX_TEXT = 500;
const WINDOW = 60; // сколько последних сообщений показываем

function ago(ts) {
  const s = Math.max(1, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}с`;
  if (s < 3600) return `${Math.floor(s / 60)}м`;
  if (s < 86400) return `${Math.floor(s / 3600)}ч`;
  return `${Math.floor(s / 86400)}д`;
}

/** Живой список сообщений: поток RTDB, а не выйдет — опрос раз в 6 секунд. */
function useMessages(token, enabled) {
  const [msgs, setMsgs] = useState(null);
  const [feedErr, setFeedErr] = useState(false); // база не отдаёт ленту (правила/сеть)
  useEffect(() => {
    if (!enabled || !token) return;
    setMsgs(null); setFeedErr(false);
    const url = `${CHAT_DB_URL}/aichat/${token.toLowerCase()}/messages.json?orderBy="$key"&limitToLast=${WINDOW}`;
    const toList = (obj) => Object.entries(obj || {})
      .map(([id, m]) => ({ id, ...(m || {}) }))
      .filter((m) => typeof m.text === "string")
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    let snapshot = {};
    let stopped = false;
    let es = null, poll = null;
    const startPoll = () => {
      if (poll) return;
      const tick = () => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => { if (!stopped) { snapshot = j || {}; setMsgs(toList(snapshot)); setFeedErr(false); } })
        .catch(() => { if (!stopped) { setFeedErr(true); setMsgs((m) => m || []); } });
      tick(); poll = setInterval(tick, 6000);
    };
    try {
      es = new EventSource(url);
      const handler = (e) => {
        try {
          const { path, data } = JSON.parse(e.data);
          if (path === "/" || path === "") snapshot = data || {};
          else {
            const key = path.split("/").filter(Boolean)[0];
            if (data === null) delete snapshot[key]; else snapshot[key] = { ...(snapshot[key] || {}), ...(path.split("/").filter(Boolean).length > 1 ? {} : data) };
          }
          setMsgs(toList(snapshot));
        } catch (err) { /* мусор в потоке */ }
      };
      es.addEventListener("put", handler);
      es.addEventListener("patch", handler);
      es.onerror = () => { try { es.close(); } catch (e2) { /* ignore */ } es = null; startPoll(); };
    } catch (e) { startPoll(); }
    return () => { stopped = true; if (es) try { es.close(); } catch (e) { /* ignore */ } if (poll) clearInterval(poll); };
  }, [token, enabled]);
  return { msgs, feedErr };
}

export default function AgentChat({ token, symbol, aiOn, model, modelName, holder, wallet, onConnect }) {
  const { t } = useLang();
  const enabled = Boolean(FEATURES.aiChat && CHAT_DB_URL && CHAT_API_URL && token);
  const { msgs, feedErr } = useMessages(token, enabled);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(null); // моё сообщение, пока воркер думает
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length, pending, busy]);

  /** Сессия: из памяти, а нет или истекла — одна подпись кошельком. */
  const session = useCallback(async () => {
    const k = SESSION_KEY(wallet.account);
    try {
      const s = JSON.parse(localStorage.getItem(k) || "null");
      if (s && s.session && s.exp * 1000 > Date.now() + 60_000) return s.session;
    } catch (e) { /* нет сессии */ }
    const ts = Date.now();
    const sig = await wallet.walletClient.signMessage({ account: wallet.account, message: loginMessage(wallet.account, ts) });
    const r = await fetch(`${CHAT_API_URL}/chat/session`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.account, ts, sig }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.session) throw new Error(j.message || t("Не удалось войти в чат."));
    try { localStorage.setItem(k, JSON.stringify(j)); } catch (e) { /* ignore */ }
    return j.session;
  }, [wallet, t]);

  async function send() {
    const msg = text.trim().slice(0, MAX_TEXT);
    if (!msg || busy) return;
    if (!wallet) return onConnect?.();
    setErr(""); setBusy(true); setPending(msg);
    try {
      let s = await session();
      let r = await post(s, msg);
      if (r.status === 401) { // сессия протухла на сервере — подписать заново
        try { localStorage.removeItem(SESSION_KEY(wallet.account)); } catch (e) { /* ignore */ }
        s = await session(); r = await post(s, msg);
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `${t("Ошибка")} ${r.status}`);
      setText("");
    } catch (e) {
      const m = String(e.shortMessage || e.message || e);
      setErr(/failed to fetch|networkerror|load failed/i.test(m) ? t("Чат с ИИ пока не подключён — воркер ещё не задеплоен.") : m);
    } finally { setBusy(false); setPending(null); }
  }
  const post = (s, msg) => fetch(`${CHAT_API_URL}/chat/send`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: s, coin: token, text: msg }),
  });

  if (!enabled) return null;
  const canWrite = wallet && holder && aiOn !== false;
  const label = modelName || (model ? model.split("/")[1] || model : "");

  return (
    <div className="chat-panel aichat">
      <div className="chat-head">
        <h3><Icon name="sparkles" /> {t("Чат с ИИ монеты")}</h3>
        {model && (
          <span className="aichat-model" title={model}>
            <img src={modelLogo(model)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            {label.slice(0, 24)}
          </span>
        )}
      </div>
      <div className="chat-sub">
        {aiOn === false
          ? t("ИИ у этой монеты не включён — это решение её создателя.")
          : t("Читают все, пишут холдеры. ИИ отвечает от лица монеты — про мемы, посты, идеи для доски.")}
      </div>
      <div className="chat-list" ref={listRef}>
        {msgs === null && <div className="dim">{t("Загружаю…")}</div>}
        {feedErr && <div className="dim">{t("Лента чата пока недоступна.")}</div>}
        {!feedErr && msgs?.length === 0 && !pending && <div className="dim">{t("Пока тихо — спросите ИИ первым.")}</div>}
        {msgs?.map((m) => {
          const ai = m.role === "ai";
          const mine = wallet && !ai && String(m.who || "").toLowerCase() === wallet.account.toLowerCase();
          return (
            <div className={`chat-msg ${ai ? "from-ai" : ""}`} key={m.id}>
              <div className="chat-ava">{ai ? <Icon name="sparkles" size={13} style={{ margin: 0 }} /> : <Icon name="user" size={13} style={{ margin: 0 }} />}</div>
              <div>
                <span className={`who mono ${ai ? "ai" : ""}`}>{ai ? `$${symbol || ""} AI` : (mine ? t("вы") : short(m.who || ""))}</span>
                <span className="when">{m.ts ? ago(m.ts) : ""}</span>
                <div className="txt">{m.text}</div>
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="chat-msg">
            <div className="chat-ava"><Icon name="user" size={13} style={{ margin: 0 }} /></div>
            <div><span className="who mono">{t("вы")}</span><div className="txt">{pending}</div></div>
          </div>
        )}
        {busy && (
          <div className="chat-msg from-ai">
            <div className="chat-ava"><Icon name="sparkles" size={13} style={{ margin: 0 }} /></div>
            <div><span className="who mono ai">{`$${symbol || ""} AI`}</span><div className="txt dim aichat-typing">{t("думает…")}</div></div>
          </div>
        )}
      </div>

      {aiOn === false ? null : !wallet ? (
        <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => onConnect?.()}>{t("Подключить кошелёк, чтобы писать")}</button>
      ) : holder === false ? (
        <div className="aichat-gate">{t("Писать могут холдеры")} <b>${symbol}</b> — {t("купите хоть немного, и чат откроется.")}</div>
      ) : (
        <div className="chat-input-row">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Спросите ИИ монеты…")}
                 maxLength={MAX_TEXT} disabled={busy || !canWrite}
                 onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(); }} />
          <button className="btn btn-primary chat-send" onClick={send} disabled={busy || !canWrite || !text.trim()}>
            {busy ? "…" : <Icon name="send" size={15} style={{ margin: 0 }} />}
          </button>
        </div>
      )}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
