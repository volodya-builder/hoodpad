import React, { useEffect, useState, useCallback } from "react";
import Home from "./pages/Home.jsx";
import Create from "./pages/Create.jsx";
import TokenPage from "./pages/Token.jsx";
import Analytics from "./pages/Analytics.jsx";
import Profile from "./pages/Profile.jsx";
import Vote from "./pages/Vote.jsx";
import About from "./pages/About.jsx";
import Treasury from "./pages/Treasury.jsx";
import Admin from "./pages/Admin.jsx";
import { Privacy, Terms } from "./pages/Legal.jsx";
import { connectWallet, reconnectWallet, hasWallet, short, fmt, fmtEth, publicClient } from "./lib/web3.js";
import { CHAIN, FACTORY_ADDRESS, TREASURY_ADDRESS } from "./lib/config.js";
import { treasuryAbi } from "./lib/abi.js";
import { dataSource } from "./lib/data.js";
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

function DataSourceBadge() {
  const [src, setSrc] = useState(dataSource.v);
  useEffect(() => {
    const id = setInterval(() => setSrc(dataSource.v), 2000);
    return () => clearInterval(id);
  }, []);
  if (!src) return null;
  return <span title="Откуда сайт берёт данные">{src === "subgraph" ? " · ⚡ Goldsky" : " · ⛓ RPC fallback"}</span>;
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
  const [isOwner, setIsOwner] = useState(false);
  const [hdrBal, setHdrBal] = useState(null);
  const [tosOpen, setTosOpen] = useState(false);
  const [tosA, setTosA] = useState(false);
  const [tosB, setTosB] = useState(false);
  const [walletMenu, setWalletMenu] = useState(false);
  useEffect(() => {
    const close = (e) => { if (!e.target.closest(".wallet-wrap")) setWalletMenu(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const tosAccepted = (acc) => {
    try {
      const m = JSON.parse(localStorage.getItem("hood_tos_v1") || "{}");
      return !!m[acc.toLowerCase()];
    } catch (e) { return false; }
  };

  const requireTos = useCallback((acc) => {
    if (!tosAccepted(acc)) { setTosA(false); setTosB(false); setTosOpen(true); }
  }, []);

  const connect = useCallback(async () => {
    try {
      const w = await connectWallet();
      setWallet(w);
      try { localStorage.setItem("hood_wallet", "1"); } catch (e) { /* ignore */ }
      requireTos(w.account);
    } catch (e) {
      const msg = String(e.message || "");
      if (e.code === -32002 || msg.includes("already pending")) {
        alert(t("Запрос на подключение уже открыт в кошельке. Нажмите на иконку MetaMask в панели браузера и подтвердите его там."));
      } else if (e.code === 4001 || msg.includes("rejected")) {
        // пользователь сам отменил — молчим
      } else {
        alert(e.shortMessage || e.message);
      }
    }
  }, [requireTos, t]);

  const hardDisconnect = useCallback(() => {
    const prov = wallet?.provider;
    setWallet(null);
    try { localStorage.removeItem("hood_wallet"); } catch (e) { /* ignore */ }
    // отзыв разрешения в MetaMask — следующее подключение снова спросит
    try {
      prov?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      }).catch(() => {});
    } catch (e) { /* кошелёк без поддержки revoke — не страшно */ }
  }, [wallet]);

  const acceptTos = () => {
    if (!wallet) return;
    try {
      const m = JSON.parse(localStorage.getItem("hood_tos_v1") || "{}");
      m[wallet.account.toLowerCase()] = true;
      localStorage.setItem("hood_tos_v1", JSON.stringify(m));
    } catch (e) { /* ignore */ }
    setTosOpen(false);
  };

  const declineTos = () => {
    setTosOpen(false);
    hardDisconnect();
  };

  // Прогрев кэша данных сразу при загрузке приложения
  useEffect(() => { loadTokens().catch(() => {}); }, []);

  // Закрываем мобильное меню при смене страницы
  useEffect(() => { setMenuOpen(false); }, [route]);

  // Автовосстановление сессии кошелька после перезагрузки страницы
  useEffect(() => {
    let alive = true;
    try {
      if (localStorage.getItem("hood_wallet") !== "1") return;
    } catch (e) { return; }
    reconnectWallet()
      .then((w) => { if (alive && w) { setWallet(w); requireTos(w.account); } })
      .catch(() => {});
    return () => { alive = false; };
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

  // баланс кошелька в шапке
  useEffect(() => {
    let alive = true;
    if (!wallet) { setHdrBal(null); return; }
    const pull = () =>
      publicClient.getBalance({ address: wallet.account })
        .then((b) => alive && setHdrBal(b))
        .catch(() => {});
    pull();
    const id = setInterval(pull, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [wallet]);

  // владелец казны видит пункт «Админ» в меню кошелька
  useEffect(() => {
    let alive = true;
    if (!wallet) { setIsOwner(false); return; }
    publicClient.readContract({
      address: TREASURY_ADDRESS, abi: treasuryAbi, functionName: "owner",
    })
      .then((o) => alive && setIsOwner(o.toLowerCase() === wallet.account.toLowerCase()))
      .catch(() => alive && setIsOwner(false));
    return () => { alive = false; };
  }, [wallet]);

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
  } else if (route === "/treasury") {
    page = <Treasury />;
  } else if (route === "/admin") {
    page = <Admin wallet={wallet} onConnect={connect} />;
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
            <img src="./logo-64.png" alt="" width="32" height="32"
                 style={{ borderRadius: 9, display: "block" }} />
            <span className="logo-word">HOOD</span>
          </a>
          <div className={`nav-pills ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)}>
            <a className={`nav-pill ${!route.startsWith("/analytics") && !route.startsWith("/profile") && !route.startsWith("/vote") && !route.startsWith("/treasury") && !route.startsWith("/about") ? "on" : ""}`} href="#/">{t("Обзор")}</a>
            <a className={`nav-pill ${route.startsWith("/analytics") ? "on" : ""}`} href="#/analytics">{t("Аналитика")}</a>
            <a className={`nav-pill ${route.startsWith("/vote") ? "on" : ""}`} href="#/vote">{t("Голосование")}</a>
            <a className={`nav-pill ${route.startsWith("/treasury") ? "on" : ""}`} href="#/treasury">{t("Казна")}</a>
            <a className={`nav-pill ${route.startsWith("/about") ? "on" : ""}`} href="#/about">{t("О нас")}</a>
          </div>
          <nav className="nav">
            <button className={`icon-btn burger ${menuOpen ? "on" : ""}`} onClick={() => setMenuOpen(!menuOpen)} title={t("Меню")} aria-label="menu">
              {menuOpen ? "✕" : "☰"}
            </button>
            <button className="icon-btn" onClick={() => setSearchOpen(true)} title="Поиск (Ctrl+K)">⌕</button>
            <a className={`icon-btn ${route.startsWith("/profile") ? "on" : ""}`} href="#/profile" title={t("Профиль")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.8-3.4 4.5-5 8-5s6.2 1.6 8 5" />
              </svg>
            </a>
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
                  {hdrBal !== null && (
                    <span style={{ color: "var(--gold)", marginRight: 8 }}>
                      {fmtEth(Number(formatEther(hdrBal)))} ETH
                    </span>
                  )}
                  {short(wallet.account)} ▾
                </button>
                <div className={`wallet-menu ${walletMenu ? "open" : ""}`}>
                  <a className="wallet-item" href="#/profile" onClick={() => setWalletMenu(false)}
                     style={{ display: "block" }}>{t("Профиль")}</a>
                  {isOwner && (
                    <a className="wallet-item" href="#/admin" onClick={() => setWalletMenu(false)}
                       style={{ display: "block" }}>⚙ {t("Админ-панель")}</a>
                  )}
                  <div className="wallet-item" onClick={() => {
                    setWalletMenu(false);
                    hardDisconnect();
                  }}>
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
        <div className="container">
          <div className="footer-inner">
            <div className="footer-brand">
              <div className="footer-tag">hood</div>
              <div className="dim" style={{ marginTop: 12, lineHeight: 1.55 }}>{t("Запускайте и исследуйте токены с фиксированным сапплаем на Robinhood Chain. Ваш кошелёк подписывает каждую транзакцию. hood не хранит активы.")}</div>
            </div>
            <div className="fcol">
              <h4>{t("Продукт")}</h4>
              <a href="#/">{t("Обзор")}</a>
              <a href="#/analytics">{t("Аналитика")}</a>
              <a href="#/vote">{t("Голосование")}</a>
              <a href="#/treasury">{t("Казна")}</a>
              <a href="#/about">{t("О нас")}</a>
              <a href="#/create">{t("Создать")}</a>
              <a href="#/profile">{t("Профиль")}</a>
            </div>
            <div className="fcol">
              <h4>{t("Правовое")}</h4>
              <a href="#/privacy">{t("Политика конфиденциальности")}</a>
              <a href="#/terms">{t("Условия использования")}</a>
              <a href="mailto:contact@hoodandarrow.com">contact@hoodandarrow.com</a>
            </div>
            <div className="fcol">
              <h4>{t("Риск-нотис")}</h4>
              <div className="dim" style={{ lineHeight: 1.55 }}>
                {t("Транзакции отправляются вашим кошельком и необратимы. Токены волатильны и могут полностью обесцениться. hood не хранит активы, не даёт гарантий и финансовых советов.")}
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <span className="dim">© 2026 hood · Robinhood Chain<DataSourceBadge /></span>
            <a className="x-chip" href="https://x.com/hoodandarrow" target="_blank" rel="noreferrer">
              @hoodandarrow <span className="x-box">𝕏</span>
            </a>
          </div>
        </div>
      </footer>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      {tosOpen && wallet && (
        <div className="modal-back open">
          <div className="tos-modal">
            <div className="tos-hero"><div className="tos-ico">🤝</div></div>
            <div className="tos-body">
              <h2 className="tos-title">
                {t("Ознакомьтесь и примите")} <span className="tos-chip">{t("Обязательно")}</span>
              </h2>
              <p className="dim" style={{ lineHeight: 1.6, margin: "10px 0 18px" }}>
                {t("Прежде чем использовать hood с этим кошельком, примите актуальные Условия использования и Политику конфиденциальности. Вы также подтверждаете, что не находитесь в юрисдикции, где использование запрещено.")}
              </p>
              <label className="tos-check">
                <input type="checkbox" checked={tosA} onChange={(e) => setTosA(e.target.checked)} />
                <span>
                  {t("Я прочитал и принимаю")}{" "}
                  <a href="#/terms" target="_blank" rel="noreferrer">{t("Условия использования")}</a>.
                </span>
              </label>
              <label className="tos-check">
                <input type="checkbox" checked={tosB} onChange={(e) => setTosB(e.target.checked)} />
                <span>
                  {t("Я прочитал и принимаю")}{" "}
                  <a href="#/privacy" target="_blank" rel="noreferrer">{t("Политику конфиденциальности")}</a>.
                </span>
              </label>
              <div className="tos-actions">
                <button className="btn btn-primary" disabled={!tosA || !tosB} onClick={acceptTos}>
                  {t("Принять и продолжить")}
                </button>
                <button className="tos-ghost" onClick={declineTos}>{t("Отключить кошелёк")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
