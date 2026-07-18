import React, { useEffect, useState, useCallback } from "react";
import Home from "./pages/Home.jsx";
import Create from "./pages/Create.jsx";
import TokenPage from "./pages/Token.jsx";
import Analytics from "./pages/Analytics.jsx";
import Profile from "./pages/Profile.jsx";
import Vote from "./pages/Vote.jsx";
import About from "./pages/About.jsx";
import { Privacy, Terms } from "./pages/Legal.jsx";
import { connectWallet, hasWallet, short, fmt } from "./lib/web3.js";
import { CHAIN, FACTORY_ADDRESS } from "./lib/config.js";
import { loadTokens } from "./lib/data.js";
import { useEthUsd, usd } from "./lib/price.js";
import { useLang } from "./lib/i18n.jsx";
import { formatEther } from "viem";

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.replace(/^#/, "");
}

function SearchModal({ open, onClose }) {
  const { t } = useLang();
  const rate = useEthUsd();
  const [q, setQ] = useState("");
  const [tokens, setTokens] = useState(null);
  useEffect(() => {
    if (!open) return;
    setQ("");
    loadTokens().then(setTokens).catch(() => setTokens([]));
  }, [open]);
  if (!open) return null;
  const res = (tokens ?? []).filter(
    (t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) ||
           t.symbol.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);
  return (
    <div className="modal-back open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-modal">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Поиск токена по имени или тикеру…")}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && res[0]) { onClose(); window.location.hash = `#/token/${res[0].token}`; }
          }}
        />
        <div className="sr-list">
          {tokens === null && <div className="center" style={{ padding: "20px 0" }}>{t("Загружаю…")}</div>}
          {tokens !== null && res.length === 0 && (
            <div className="center" style={{ padding: "20px 0" }}>{t("Ничего не найдено")}</div>
          )}
          {res.map((r) => (
            <div className="sr-item" key={r.token}
                 onClick={() => { onClose(); window.location.hash = `#/token/${r.token}`; }}>
              {r.meta.image && <img src={r.meta.image} alt="" />}
              <span className="n">{r.name} <span className="ticker">${r.symbol}</span></span>
              <span className="m">
                {usd(Number(formatEther(r.price)) * 1e9 * rate)}{r.graduated ? " · 🎯" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { lang, t, setLang } = useLang();
  const route = useHashRoute();
  const [wallet, setWallet] = useState(null); // { account, walletClient }
  const [walletMenu, setWalletMenu] = useState(false);
  useEffect(() => {
    const close = (e) => { if (!e.target.closest(".wallet-wrap")) setWalletMenu(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("hood_theme") || ""; } catch (e) { return ""; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("hood_theme", theme); } catch (e) { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const connect = useCallback(async () => {
    try {
      const w = await connectWallet();
      setWallet(w);
    } catch (e) {
      alert(e.shortMessage || e.message);
    }
  }, []);

  useEffect(() => {
    if (!hasWallet()) return;
    const provider = window.ethereum;
    if (!provider?.on) return;
    const onAccounts = (accs) => {
      if (accs.length === 0) setWallet(null);
      else connect();
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, [connect]);

  const factoryMissing =
    FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000";

  let page;
  if (route.startsWith("/token/")) {
    page = <TokenPage tokenAddress={route.split("/token/")[1]} wallet={wallet} onConnect={connect} />;
  } else if (route === "/create") {
    page = <Create wallet={wallet} onConnect={connect} />;
  } else if (route === "/analytics") {
    page = <Analytics />;
  } else if (route === "/vote") {
    page = <Vote wallet={wallet} onConnect={connect} />;
  } else if (route === "/about") {
    page = <About />;
  } else if (route === "/privacy") {
    page = <Privacy />;
  } else if (route === "/terms") {
    page = <Terms />;
  } else if (route === "/profile") {
    page = <Profile wallet={wallet} onConnect={connect} />;
  } else {
    page = <Home onSearch={() => setSearchOpen(true)} />;
  }

  return (
    <>
      <header>
        <div className="container header-inner">
          <a className="logo" href="#/" aria-label="hood">
            <svg width="32" height="32" viewBox="0 0 64 64">
              <rect width="64" height="64" rx="14" fill="#f5f5f2" />
              <path d="M32 8.6 C30 8.6 27.6 11 25.4 14.2 C20.4 21.4 15.2 31.6 13.2 41 C12.2 45.4 12.7 48.7 15.3 50.5 C17.9 52.2 23 51.3 32 51.3 C41 51.3 46.1 52.2 48.7 50.5 C51.3 48.7 51.8 45.4 50.8 41 C48.8 31.6 43.6 21.4 38.6 14.2 C36.4 11 34 8.6 32 8.6 Z" fill="#4a4d51" />
              <path d="M32 25 C26.6 28.6 20.6 35.4 20.1 42.6 C19.8 46 21 48.4 22.5 50.2 C23.6 51.6 24 53 25.4 54.1 C27.2 55.4 29.4 55.8 32 55.8 C34.6 55.8 36.8 55.4 38.6 54.1 C40 53 40.4 51.6 41.5 50.2 C43 48.4 44.2 46 43.9 42.6 C43.4 35.4 37.4 28.6 32 25 Z" fill="#101112" stroke="#f5f5f2" strokeWidth="2.1" />
            </svg>
            <span className="logo-word">HOOD</span>
          </a>
          <div className="nav-pills">
            <a className={`nav-pill ${!route.startsWith("/analytics") && !route.startsWith("/profile") && !route.startsWith("/vote") && !route.startsWith("/about") ? "on" : ""}`} href="#/">{t("Обзор")}</a>
            <a className={`nav-pill ${route.startsWith("/analytics") ? "on" : ""}`} href="#/analytics">{t("Аналитика")}</a>
            <a className={`nav-pill ${route.startsWith("/vote") ? "on" : ""}`} href="#/vote">{t("Голосование")}</a>
            <a className={`nav-pill ${route.startsWith("/about") ? "on" : ""}`} href="#/about">{t("О нас")}</a>
          </div>
          <nav className="nav">
            <button className="icon-btn" onClick={() => setSearchOpen(true)} title="Поиск (Ctrl+K)">⌕</button>
            <button className="icon-btn" onClick={() => setLang(lang === "en" ? "ru" : "en")}
                    title="Язык / Language" style={{ width: "auto", padding: "0 13px", fontSize: 12, fontWeight: 800 }}>
              {lang === "en" ? "RU" : "EN"}
            </button>
            <button className="icon-btn" onClick={() => setTheme(theme === "light" ? "" : "light")} title="Сменить тему">
              {theme === "light" ? "☾" : "☀"}
            </button>
            {wallet ? (
              <div className="wallet-wrap">
                <button className="btn mono" onClick={() => setWalletMenu(!walletMenu)}>
                  {short(wallet.account)} ▾
                </button>
                <div className={`wallet-menu ${walletMenu ? "open" : ""}`}>
                  <a className="wallet-item" href="#/profile" onClick={() => setWalletMenu(false)}
                     style={{ display: "block" }}>{t("Профиль")}</a>
                  <div className="wallet-item" onClick={() => { setWallet(null); setWalletMenu(false); }}>
                    {t("Отключить")}
                  </div>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={connect}>
                {t("Подключить кошелёк")}
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="container">
        {factoryMissing && (
          <div className="error" style={{ marginTop: 16 }}>
            Адрес фабрики не настроен. Задеплойте контракты и укажите
            VITE_FACTORY_ADDRESS.
          </div>
        )}
        {page}
      </main>
      <footer>
        <div className="container footer-inner">
          <div style={{ maxWidth: 300 }}>
            <div className="footer-tag">hood</div>
            <div className="dim" style={{ marginTop: 10 }}>{t("Запускайте и исследуйте токены с фиксированным сапплаем на Robinhood Chain. Каждую транзакцию подписывает ваш кошелёк — hood не хранит активы.")}</div>
          </div>
          <div className="footer-cols">
            <div className="fcol">
              <h4>{t("Продукт")}</h4>
              <a href="#/">{t("Обзор")}</a>
              <a href="#/analytics">{t("Аналитика")}</a>
              <a href="#/vote">{t("Голосование")}</a>
              <a href="#/about">{t("О нас")}</a>
              <a href="#/create">{t("Создать")}</a>
              <a href="#/profile">{t("Профиль")}</a>
            </div>
            <div className="fcol">
              <h4>{t("Правовое")}</h4>
              <a href="#/privacy">{t("Политика конфиденциальности")}</a>
              <a href="#/terms">{t("Условия использования")}</a>
            </div>
          </div>
          <div className="footer-note">
            <h4 style={{ fontSize: "11.5px", textTransform: "uppercase", color: "var(--text-dim)", letterSpacing: 1, margin: "0 0 11px" }}>{t("Риск-нотис")}</h4>
            {t("Транзакции отправляются вашим кошельком и необратимы. Токены волатильны и могут полностью обесцениться. hood не хранит активы, не даёт гарантий и финансовых советов.")}
            <div className="dim" style={{ marginTop: 14 }}>© 2026 hood · Robinhood Chain</div>
          </div>
        </div>
      </footer>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
