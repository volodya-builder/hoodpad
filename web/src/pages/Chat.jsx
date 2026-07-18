import React, { useEffect, useState, useCallback, useRef } from "react";
import { short } from "../lib/web3.js";
import { CHAT_DB_URL } from "../lib/config.js";

// Обычный (офчейн) чат поверх Firebase Realtime Database REST API.
// Без SDK: GET для чтения, POST для отправки, поллинг раз в 4 секунды.

function ago(tsMs) {
  const s = Math.max(1, (Date.now() - tsMs) / 1000);
  if (s < 60) return `${Math.floor(s)}с`;
  if (s < 3600) return `${Math.floor(s / 60)}м`;
  if (s < 86400) return `${Math.floor(s / 3600)}ч`;
  return `${Math.floor(s / 86400)}д`;
}

function guestName() {
  try {
    let g = localStorage.getItem("hood_guest");
    if (!g) {
      g = "гость-" + Math.random().toString(36).slice(2, 6);
      localStorage.setItem("hood_guest", g);
    }
    return g;
  } catch (e) {
    return "гость";
  }
}

export default function Chat({ tokenAddress, wallet }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  const enabled = !!CHAT_DB_URL;
  const room = tokenAddress.toLowerCase();
  const url = `${CHAT_DB_URL}/chats/${room}.json`;

  const load = useCallback(async () => {
    if (!enabled) return;
    const r = await fetch(url + '?orderBy="$key"&limitToLast=60');
    if (!r.ok) throw new Error("chat backend " + r.status);
    const j = await r.json();
    const list = j
      ? Object.entries(j)
          .map(([k, v]) => ({ key: k, ...v }))
          .sort((a, b) => (a.key < b.key ? -1 : 1))
      : [];
    setMsgs(list);
  }, [url, enabled]);

  useEffect(() => {
    load().catch(() => setMsgs([]));
    const id = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setError("");
    setBusy(true);
    try {
      const author = wallet ? short(wallet.account) : guestName();
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          who: author,
          w: wallet ? 1 : 0,
          text: t.slice(0, 280),
          ts: { ".sv": "timestamp" },
        }),
      });
      if (!r.ok) throw new Error("не удалось отправить (" + r.status + ")");
      setText("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <div className="chat-panel" style={{ marginTop: 18 }}>
        <div className="chat-head"><h3>Чат</h3></div>
        <div className="chat-sub">Скоро: подключаем хранилище сообщений.</div>
      </div>
    );
  }

  return (
    <div className="chat-panel" style={{ marginTop: 18 }}>
      <div className="chat-head">
        <h3>Чат</h3>
        <span className="chat-count">{msgs?.length ?? "…"}</span>
      </div>
      <div className="chat-sub">Писать могут все — кошелёк не обязателен.</div>
      <div className="chat-list" ref={listRef}>
        {msgs === null && <div className="dim">Загружаю…</div>}
        {msgs?.length === 0 && <div className="dim">Пока тихо — напишите первым.</div>}
        {msgs?.map((m) => (
          <div className="chat-msg" key={m.key}>
            <div className="chat-ava">{m.w ? "🏹" : "👤"}</div>
            <div>
              <span className="who mono">{m.who}</span>
              <span className="when">{m.ts ? ago(m.ts) : ""}</span>
              <div className="txt">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Сообщение…"
          maxLength={280}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary chat-send" onClick={send} disabled={busy}>
          {busy ? "…" : "➤"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
