import React, { useState } from "react";

// ============================================================================
//  Замок на тестовый сайт (/staging/) — просьба владельца 17.09.2026:
//  посторонние не должны попадать на staging.
//
//  Как работает: в сборку staging из GitHub (переменная STAGING_GATE →
//  VITE_STAGING_GATE) попадает не пароль, а его SHA-256. Пользователь вводит
//  пароль, браузер считает хэш и сравнивает; совпало — хэш запоминается в
//  localStorage, и замок больше не спрашивает. Пароль нигде не хранится.
//  Переменная пуста (основной сайт) — замка нет, компонент прозрачный.
//
//  Это защита от случайных посетителей и поисковиков, не от взломщика: код
//  сайта открыт, и упорный человек соберёт его сам. Для настоящей защиты —
//  Cloudflare Access на путь /staging/* (в панели Cloudflare владельца).
// ============================================================================

const GATE = String(import.meta.env.VITE_STAGING_GATE || "").trim().toLowerCase();
const LS = "hood.stg";

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function StagingGate({ children }) {
  const [ok, setOk] = useState(() => {
    if (!/^[0-9a-f]{64}$/.test(GATE)) return true; // замка нет
    try { return localStorage.getItem(LS) === GATE; } catch (e) { return false; }
  });
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  if (ok) return children;

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    let h = "";
    try { h = await sha256(value.trim()); } catch (err) { h = ""; }
    if (h === GATE) {
      try { localStorage.setItem(LS, h); } catch (err) { /* приватный режим — спросим снова */ }
      setOk(true);
    } else {
      setBad(true);
    }
    setBusy(false);
  };

  return (
    <div className="stg-gate">
      <form className="stg-box" onSubmit={submit}>
        <div className="stg-logo">hood</div>
        <div className="stg-title">Тестовая версия · Test build</div>
        <div className="stg-sub">Доступ только для команды. Введите пароль.<br />Team only. Enter the password.</div>
        <input className="stg-in" type="password" autoFocus autoComplete="current-password" value={value}
               onChange={(e) => { setValue(e.target.value); setBad(false); }} placeholder="Пароль / Password" />
        {bad && <div className="stg-err">Неверный пароль · Wrong password</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>Войти · Enter</button>
        <a className="stg-link" href="https://hoodandarrow.com/">hoodandarrow.com</a>
      </form>
    </div>
  );
}
