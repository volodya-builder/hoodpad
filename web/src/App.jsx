import React, { useEffect, useState, useCallback, lazy, Suspense } from "react";
import Icon from "./components/Icon.jsx";
import QuoteLogo from "./components/QuoteLogo.jsx";
import Home from "./pages/Home.jsx";
import Create from "./pages/Create.jsx";
import TokenPage from "./pages/Token.jsx";
import Analytics from "./pages/Analytics.jsx";
import Leaderboard from "./pages/Leaderboard.jsx";
import Trader from "./pages/Trader.jsx";
import Profile from "./pages/Profile.jsx";
import AI from "./pages/AI.jsx";
import { Privacy, Terms } from "./pages/Legal.jsx";
// Скрытые (FEATURES) и редкие страницы грузятся отдельными кусками и только
// когда открыты: в основном бандле их нет, посетители их не качают.
const Arena = lazy(() => import("./pages/Arena.jsx"));
const Ticker = lazy(() => import("./components/Ticker.jsx"));
const About = lazy(() => import("./pages/About.jsx"));
const Treasury = lazy(() => import("./pages/Treasury.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));
const Revenue = lazy(() => import("./pages/Revenue.jsx"));
const Cats = lazy(() => import("./pages/Cats.jsx"));
import { connectWallet, reconnectWallet, hasWallet, short, fmt, fmtEth, publicClient } from "./lib/web3.js";
import { CHAIN, FACTORY_ADDRESS, TREASURY_ADDRESS, CHAT_DB_URL, FEATURES } from "./lib/config.js";
import { treasuryAbi } from "./lib/abi.js";
import { loadTokens, timeAgo } from "./lib/data.js";
import { useEthUsd, usd } from "./lib/price.js";
import { useLang } from "./lib/i18n.jsx";
import { formatEther, formatUnits } from "viem";

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.replace(/^#/, "");
}


/** Подсветка совпавшего куска — чтобы глазом было видно, почему строка нашлась. */
function Mark({ text, q }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="sr-mark">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const SR_SORTS = [
  ["rel", "Релевантность"],
  ["mcap", "Капитализация"],
  ["vol", "Объём"],
  ["new", "Новые"],
  ["old", "Старые"],
];
const SR_AGES = [["all", "Все"], ["24h", "24ч"], ["7d", "7д"]];
const SR_PAGE = 24;

// Умный поиск (по образцу Pons, 15.09.2026): одна строка, три ряда фильтров —
// сортировка, возраст, валюта пары (ETH / акции с выпадающим списком),
// строки «имя · $тикер · капа · возраст», счётчик и страницы.
function SearchModal({ open, onClose }) {
  const { t } = useLang();
  const rate = useEthUsd();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rel");
  const [age, setAge] = useState("all");
  const [pair, setPair] = useState("all");   // all | eth | stocks | <quote addr>
  const [page, setPage] = useState(0);
  const [cur, setCur] = useState(0);
  const [tokens, setTokens] = useState(null);
  const [vol24, setVol24] = useState({});
  const [qPx, setQPx] = useState({});        // адрес валюты → $ за единицу
  const [dd, setDd] = useState(false);       // выпадающий список акций
  const ddRef = React.useRef(null);
  // меню закрывается кликом мимо или Esc — не уходом мыши (щель между
  // кнопкой и меню закрывала его раньше, чем успеешь выбрать)
  useEffect(() => {
    if (!dd) return undefined;
    const onDown = (e) => { if (ddRef.current && !ddRef.current.contains(e.target)) setDd(false); };
    const onEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); setDd(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc, true); };
  }, [dd]);
  const listRef = React.useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSort("rel"); setAge("all"); setPair("all"); setPage(0); setCur(0); setDd(false);
    loadTokens().then(async (tk) => {
      setTokens(tk);
      // курсы валют монет за акции — для капы и сортировки
      const { quoteUsd } = await import("./lib/price.js");
      const qs = [...new Set(tk.filter((x) => x.q).map((x) => x.q.addr.toLowerCase()))];
      const px = {};
      await Promise.all(qs.map(async (a) => { px[a] = await quoteUsd(a).catch(() => 0); }));
      setQPx(px);
    }).catch(() => setTokens([]));
    import("./lib/data.js").then((m) => m.subgraphStats24 && m.subgraphStats24().then((st) => setVol24(st?.vol || {})).catch(() => {}));
  }, [open]);

  const mcapOf = React.useCallback((r) => {
    if (r.q) {
      const px = qPx[r.q.addr.toLowerCase()] || 0;
      return px > 0 ? Number(formatUnits(r.price, r.q.dec)) * 1e9 * px : 0;
    }
    return Number(formatEther(r.price)) * 1e9 * (rate || 0);
  }, [rate, qPx]);
  const volOf = (r) => (vol24[(r.pool || "").toLowerCase()] || 0) * (rate || 0);

  // акции, за которые есть монеты — для выпадающего списка
  const stocks = React.useMemo(() => {
    const m = new Map();
    for (const r of tokens || []) if (r.q && r.q.stock !== false && r.q.sym !== "ETH") m.set(r.q.addr.toLowerCase(), r.q.sym);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tokens]);

  const res = React.useMemo(() => {
    const all = tokens ?? [];
    const s = q.trim().toLowerCase();
    const now = Date.now();
    let list = all.filter((r) => {
      if (age === "24h" && !(r.createdAt && now - r.createdAt < 86400e3)) return false;
      if (age === "7d" && !(r.createdAt && now - r.createdAt < 7 * 86400e3)) return false;
      if (pair === "eth" && r.q) return false;
      if (pair === "stocks" && !r.q) return false;
      if (pair.startsWith("0x") && (!r.q || r.q.addr.toLowerCase() !== pair)) return false;
      return true;
    });
    if (s) {
      const scored = [];
      for (const r of list) {
        const sym = (r.symbol || "").toLowerCase();
        const nm = (r.name || "").toLowerCase();
        const addr = (r.token || "").toLowerCase();
        let score = -1;
        if (sym === s) score = 0;
        else if (sym.startsWith(s)) score = 1;
        else if (nm.startsWith(s)) score = 2;
        else if (sym.includes(s)) score = 3;
        else if (nm.includes(s)) score = 4;
        else if (addr.includes(s)) score = 5;
        if (score >= 0) scored.push({ r, score });
      }
      scored.sort((a, b) => a.score - b.score || mcapOf(b.r) - mcapOf(a.r));
      list = scored.map((x) => x.r);
    }
    const out = [...list];
    if (sort === "mcap") out.sort((a, b) => mcapOf(b) - mcapOf(a));
    else if (sort === "vol") out.sort((a, b) => volOf(b) - volOf(a));
    else if (sort === "new") out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else if (sort === "old") out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    else if (!s) out.sort((a, b) => mcapOf(b) - mcapOf(a));
    return out;
  }, [tokens, q, sort, age, pair, mcapOf, vol24]); // eslint-disable-line

  const pages = Math.max(1, Math.ceil(res.length / SR_PAGE));
  const shown = res.slice(page * SR_PAGE, (page + 1) * SR_PAGE);
  useEffect(() => { setCur(0); setPage(0); }, [q, sort, age, pair]);
  useEffect(() => { setCur(0); }, [page]);
  useEffect(() => {
    const el = listRef.current && listRef.current.children[cur];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [cur]);

  if (!open) return null;

  const go = (r) => { onClose(); window.location.hash = `#/token/${r.token}`; };
  const onKey = (e) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(shown.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter" && shown[cur]) { go(shown[cur]); }
  };
  const Chips = ({ label, items, val, set }) => (
    <div className="sr-row">
      <span className="sr-row-lbl">{label}</span>
      {items.map(([k, lbl]) => (
        <button key={k} type="button" className={`sr-chip ${val === k ? "on" : ""}`} onClick={() => set(k)}>{lbl}</button>
      ))}
    </div>
  );
  const stockSel = pair === "stocks" || pair.startsWith("0x");

  return (
    <div className="modal-back open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-modal">
        <div className="sr-input">
          <Icon name="search" size={17} style={{ margin: 0, opacity: .7 }} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Имя, тикер или адрес контракта…")} onKeyDown={onKey} />
          <button type="button" className="sr-close" onClick={onClose} aria-label={t("закрыть")}>×</button>
        </div>

        <div className="sr-filters">
          <Chips label={t("Сортировка")} items={SR_SORTS.map(([k, l]) => [k, t(l)])} val={sort} set={setSort} />
          <Chips label={t("Возраст")} items={SR_AGES.map(([k, l]) => [k, t(l)])} val={age} set={setAge} />
          <div className="sr-row">
            <span className="sr-row-lbl">{t("Пара")}</span>
            <button type="button" className={`sr-chip ${pair === "all" ? "on" : ""}`} onClick={() => setPair("all")}>{t("Все")}</button>
            <button type="button" className={`sr-chip ${pair === "eth" ? "on" : ""}`} onClick={() => setPair("eth")}>ETH</button>
            {stocks.length > 0 && (
              <span className="sr-dd" ref={ddRef}>
                <button type="button" className={`sr-chip ${stockSel ? "on" : ""}`} onClick={() => setDd(!dd)}>
                  {!stockSel ? t("Акции") : pair === "stocks" ? t("Все акции") : <QuoteLogo q={{ sym: (stocks.find(([a]) => a === pair) || [])[1] }} size={14} withSym />}
                  <Icon name="chevron" size={13} style={{ margin: 0, transform: dd ? "rotate(180deg)" : "", transition: "transform .18s" }} />
                </button>
                {dd && (
                  <div className="sr-menu">
                    <button type="button" className={`sr-menu-it ${pair === "stocks" ? "on" : ""}`} onClick={() => { setPair("stocks"); setDd(false); }}>{t("Все акции")}</button>
                    {stocks.map(([a, sym]) => (
                      <button key={a} type="button" className={`sr-menu-it ${pair === a ? "on" : ""}`} onClick={() => { setPair(a); setDd(false); }}>
                        <QuoteLogo q={{ sym }} size={18} withSym />
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="sr-list" ref={listRef}>
          {tokens === null && <div className="center" style={{ padding: "20px 0" }}>{t("Загружаю…")}</div>}
          {tokens !== null && shown.length === 0 && <div className="center" style={{ padding: "20px 0" }}>{t("Ничего не найдено")}</div>}
          {shown.map((r, i) => {
            const mc = mcapOf(r);
            return (
              <div className={`sr-item ${i === cur ? "on" : ""}`} key={r.token} onMouseEnter={() => setCur(i)} onClick={() => go(r)}>
                {r.meta && r.meta.image ? <img src={r.meta.image} alt="" loading="lazy" /> : <span className="sr-noimg" />}
                <span className="sr-main">
                  <span className="n"><Mark text={r.name || r.symbol} q={q} /></span>
                  <span className="sr-meta">
                    <span className="ticker">$<Mark text={r.symbol} q={q} /></span>
                    {" · "}{mc > 0 ? usd(mc) : "…"} MC
                    {r.createdAt ? <> · {timeAgo(r.createdAt)}</> : null}
                    {r.q ? <> · <QuoteLogo q={r.q} size={14} withSym /></> : null}
                    {r.graduated ? <> · {t("Градуировал")}</> : null}
                  </span>
                </span>
                <Icon name="chevron" size={14} style={{ margin: 0, transform: "rotate(-90deg)", opacity: .5 }} />
              </div>
            );
          })}
        </div>

        {tokens !== null && res.length > 0 && (
          <div className="sr-hint">
            <span>{page * SR_PAGE + 1}–{Math.min(res.length, (page + 1) * SR_PAGE)} {t("из")} {res.length}</span>
            <span className="sr-pages">
              <button type="button" className="sr-pg" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Назад")}</button>
              <span className="mono">{page + 1} / {pages}</span>
              <button type="button" className="sr-pg" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t("Дальше")}</button>
            </span>
          </div>
        )}
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
  const [netMenu, setNetMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  useEffect(() => {
    const close = () => { setNetMenu(false); setMoreMenu(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
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

  // Пульс присутствия: каждый посетитель раз в 20с отмечается в Firebase,
  // из этих отметок админ-панель считает «онлайн сейчас».
  useEffect(() => {
    if (!CHAT_DB_URL) return;
    let id;
    try {
      let pid = localStorage.getItem("hood_pid");
      if (!pid) { pid = Math.random().toString(36).slice(2, 12); localStorage.setItem("hood_pid", pid); }
      const beat = () => {
        const now = Date.now();
        fetch(`${CHAT_DB_URL}/presence/${pid}.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ts: now, w: wallet ? 1 : 0 }),
        }).catch(() => {});
        // анонимная статистика посещений: случайный id, время первого и последнего визита,
        // подключался ли кошелёк. Никаких персональных данных и IP не собираем.
        let first = 0;
        try {
          first = Number(localStorage.getItem("hood_first_seen") || 0);
          if (!first) { first = now; localStorage.setItem("hood_first_seen", String(first)); }
        } catch (e) { first = now; }
        fetch(`${CHAT_DB_URL}/visitors/${pid}.json`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first, last: now, w: wallet ? 1 : 0,
            addr: wallet ? wallet.account : null,
          }),
        }).catch(() => {});
        // активность по 5-минутным корзинам для графика «за час» в админке:
        // 12 слотов по кругу, старые перезаписываются сами — база не растёт.
        const bucket = Math.floor(now / 300_000);
        if (window.__hoodActBucket !== bucket) {
          window.__hoodActBucket = bucket;
          const slot = bucket % 12;
          fetch(`${CHAT_DB_URL}/activity/${slot}.json`)
            .then((r) => r.json())
            .then((cur) => (cur && cur.b === bucket
              ? fetch(`${CHAT_DB_URL}/activity/${slot}/p/${pid}.json`, { method: "PUT", body: "1" })
              : fetch(`${CHAT_DB_URL}/activity/${slot}.json`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ b: bucket, p: { [pid]: 1 } }),
                })))
            .catch(() => {});
        }
      };
      beat();
      id = setInterval(beat, 20_000);
    } catch (e) { /* ignore */ }
    return () => clearInterval(id);
  }, [wallet]);

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
  } else if (route === "/leaderboard") {
    page = <Analytics />; // лидеры теперь живут внутри аналитики
  } else if (route === "/arena" && FEATURES.arena) {
    page = <Arena />;
  } else if (route.startsWith("/trader/")) {
    page = <Trader address={route.split("/trader/")[1]} />;
  } else if (route === "/vote" && FEATURES.treasury) {
    // голосование убрано из продукта: старые ссылки ведут в казну
    page = <Treasury wallet={wallet} onConnect={connect} />;
  } else if (route === "/treasury" && FEATURES.treasury) {
    page = <Treasury />;
  } else if (route === "/admin") {
    page = <Admin wallet={wallet} onConnect={connect} />;
  } else if (route === "/revenue") {
    page = <Revenue />;
  } else if (route === "/cats" && FEATURES.cats) {
    page = <Cats wallet={wallet} />;
  } else if (route === "/ai" && FEATURES.ai) {
    page = <AI wallet={wallet} onConnect={connect} />;
  } else if (route === "/about" && FEATURES.about) {
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
          {import.meta.env.BASE_URL !== "/" && (
            <span className="staging-badge" title="Тестовая версия — данные и вид могут отличаться от боевого сайта">
              STAGING{import.meta.env.VITE_BUILD ? ` #${import.meta.env.VITE_BUILD}` : ""}
            </span>
          )}
          <div className={`nav-pills ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)}>
            <a className={`nav-pill ${!route.startsWith("/analytics") && !route.startsWith("/leaderboard") && !route.startsWith("/profile") && !route.startsWith("/treasury") && !route.startsWith("/about") && !route.startsWith("/arena") ? "on" : ""}`} href="#/">{t("Обзор")}</a>
            {FEATURES.arena && (
              <a className={`nav-pill ${route.startsWith("/arena") ? "on" : ""}`} href="#/arena">{t("Арена")}</a>
            )}
            {FEATURES.cats && (
              <a className={`nav-pill ${route.startsWith("/cats") ? "on" : ""}`} href="#/cats">🐱 {t("Коты")} <span className="rev-nav-beta">β</span></a>
            )}
            {FEATURES.treasury && (
              <a className={`nav-pill ${route.startsWith("/treasury") ? "on" : ""}`} href="#/treasury">{t("Казна")}</a>
            )}
            {FEATURES.ai && (
              <a className={`nav-pill ${route.startsWith("/ai") ? "on" : ""}`} href="#/ai">{t("ИИ")}</a>
            )}
            <a className={`nav-pill ${route.startsWith("/analytics") ? "on" : ""}`} href="#/analytics">{t("Аналитика")}</a>
            {FEATURES.about && (
              <a className={`nav-pill ${route.startsWith("/about") ? "on" : ""}`} href="#/about">{t("О нас")}</a>
            )}
          </div>
          <nav className="nav">
            <button className={`icon-btn burger ${menuOpen ? "on" : ""}`} onClick={() => setMenuOpen(!menuOpen)} title={t("Меню")} aria-label="menu">
              {menuOpen ? "✕" : "☰"}
            </button>
            {FEATURES.headerSearch && (
              <button className="icon-btn nav-search" onClick={() => setSearchOpen(true)} title={t("Поиск (Ctrl+K)")}>⌕</button>
            )}
            {FEATURES.netSwitch && (
              <div className="net-wrap">
                <button className="icon-btn net-btn" onClick={(e) => { e.stopPropagation(); setNetMenu(!netMenu); }} title={t("Сеть")}>
                  <img className="net-ico" src="https://icons.llamao.fi/icons/chains/rsz_robinhood.jpg" alt=""
                       onError={(e) => { e.currentTarget.style.display = "none"; }} /> Robinhood <span className="chev">▾</span>
                </button>
                {netMenu && (
                  <div className="net-menu" onClick={(e) => e.stopPropagation()}>
                    {[
                      { key: "robinhood", name: "Robinhood", ico: "rsz_robinhood", live: true },
                      { key: "bsc", name: "BSC", ico: "rsz_binance", hint: t("Откроется после деплоя контрактов в BSC") },
                      { key: "base", name: "Base", ico: "rsz_base", hint: "Base — вместе с Revenue β" },
                      { key: "eth", name: "ETH", ico: "rsz_ethereum" },
                      { key: "sol", name: "SOL", ico: "rsz_solana" },
                    ].map((n) => (
                      <div key={n.key} className={`net-item ${n.live ? "on" : "soon"}`} title={n.hint || ""}>
                        <span className="net-badge">
                          <img className="net-ico" src={`https://icons.llamao.fi/icons/chains/${n.ico}.jpg`} alt=""
                               onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        </span>
                        {n.name}
                        {n.live ? <span className="net-check">✓</span> : <span className="net-soon">{t("скоро")}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="icon-btn lang-btn" onClick={() => setLang(lang === "en" ? "ru" : "en")}
                    title="Язык / Language">
              <span className={lang !== "en" ? "on" : ""}>RU</span>
              <span className="sep">/</span>
              <span className={lang === "en" ? "on" : ""}>EN</span>
            </button>
            <button className="icon-btn" onClick={() => setTheme(theme === "light" ? "" : "light")}
                    title={theme === "light" ? t("Тёмная тема") : t("Светлая тема")}>
              {theme === "light" ? "☾" : "☀"}
            </button>
            <a className={`icon-btn ${route.startsWith("/profile") ? "on" : ""}`} href="#/profile" title={t("Профиль")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.8-3.4 4.5-5 8-5s6.2 1.6 8 5" />
              </svg>
            </a>
            {wallet ? (
              <div className="wallet-wrap">
                <button className="btn mono wal-btn" onClick={() => setWalletMenu(!walletMenu)}>
                  {hdrBal !== null && (
                    <span className="wal-bal" style={{ color: "var(--gold)", marginRight: 8 }}>
                      {fmtEth(Number(formatEther(hdrBal)))} ETH
                    </span>
                  )}
                  <span className="wal-addr">{short(wallet.account)}</span> ▾
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
      {FEATURES.ticker && <Ticker />}
      <main className={`container ${route.startsWith("/token/") ? "container-wide" : ""}`}>
        {factoryMissing && (
          <div className="error" style={{ marginTop: 16 }}>
            Адрес фабрики не настроен. Задеплойте контракты и укажите
            VITE_FACTORY_ADDRESS.
          </div>
        )}
        <Suspense fallback={null}>{page}</Suspense>
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
              <a href="#/create">{t("Запустить монету")}</a>
              {FEATURES.ai && <a href="#/ai">{t("ИИ")}</a>}
              {FEATURES.arena && <a href="#/arena">{t("Арена")}</a>}
              {FEATURES.treasury && <a href="#/treasury">{t("Казна")}</a>}
              <a href="#/analytics">{t("Аналитика")}</a>
            </div>
            <div className="fcol">
              <h4>{t("Правовое")}</h4>
              <a href="#/privacy">{t("Политика конфиденциальности")}</a>
              <a href="#/terms">{t("Условия использования")}</a>
            </div>
            <div className="fcol">
              <h4>{t("Риск-нотис")}</h4>
              <div className="dim" style={{ lineHeight: 1.55 }}>
                {t("Транзакции отправляются вашим кошельком и необратимы. Токены волатильны и могут полностью обесцениться. hood не хранит активы, не даёт гарантий и финансовых советов.")}
              </div>
            </div>
          </div>
          {/* отказ от аффилиации — одной строкой; полный текст в Условиях (§ о валютах курвы) */}
          <div className="footer-disclaimer dim">
            {t("hood — независимый проект, не аффилирован с Robinhood Markets, Inc.; названия и тикеры акций принадлежат их правообладателям.")}{" "}
            <a href="#/terms">{t("Подробнее в Условиях")}</a>
          </div>
          <div className="footer-bottom">
            <span className="dim">© 2026 hood · Robinhood Chain</span>
            <span style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              <a className="dim" href="mailto:contact@hoodandarrow.com" style={{ textDecoration: "none" }}>
                <Icon name="mail" /> contact@hoodandarrow.com
              </a>
              <a className="x-chip" href="https://x.com/hoodandarrow" target="_blank" rel="noreferrer">
                @hoodandarrow <span className="x-box">𝕏</span>
              </a>
            </span>
          </div>
        </div>
      </footer>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      {tosOpen && wallet && (
        <div className="modal-back open">
          <div className="tos-modal">
            <div className="tos-hero"><div className="tos-ico"><Icon name="handshake" size={30} style={{ margin: 0 }} /></div></div>
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
