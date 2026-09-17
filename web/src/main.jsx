import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./lib/i18n.jsx";
import { installTooltips } from "./lib/tooltip.js";
import StagingGate from "./components/StagingGate.jsx";
import "./styles.css";

installTooltips();

// Скорость: в простое после загрузки заранее тянем код остальных страниц
// (арена, документация…) — переход по вкладкам без ожидания чанка.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
idle(() => {
  import("./pages/Arena.jsx"); import("./pages/Docs.jsx"); import("./components/CandleChart.jsx");
  // данные арены (сделки, фонд, выплаты) — тоже заранее: вкладка открывается готовой
  import("./lib/arena.js").then((m) => m.warmArena?.()).catch(() => {});
});

// Service worker: хэшированные ассеты кэшируются навсегда (повторный заход —
// мгновенно, без сети), index.html — всегда свежий с сети.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  });
}

// Вместо «чёрного экрана смерти» показываем текст ошибки — и пользователю понятнее,
// и чинить по скриншоту можно сразу.
function showFatal(msg) {
  try {
    let el = document.getElementById("fatal-err");
    if (!el) {
      el = document.createElement("div");
      el.id = "fatal-err";
      el.style.cssText = "position:fixed;inset:auto 12px 12px 12px;z-index:99999;background:#2a1212;color:#ffb4a6;border:1px solid #e06a4a;border-radius:12px;padding:14px 16px;font:12px/1.5 monospace;max-height:45vh;overflow:auto;white-space:pre-wrap;";
      document.body.appendChild(el);
    }
    el.textContent = "Ошибка на странице (пришлите скрин):\n" + msg;
  } catch (e) { /* ignore */ }
}
window.addEventListener("error", (e) => showFatal((e.error && e.error.stack) || e.message));
// Сетевые сбои окна кошельков (реестр Reown отвечает 403/5xx, когда домен не
// в allowlist проекта) — не падение страницы: окно работает, просто без списка.
const isWalletNoise = (r) => { const s = String((r && (r.stack || r.message)) || r); return /ApiController|api\.web3modal|HTTP status code: \d+/.test(s); };
window.addEventListener("unhandledrejection", (e) => { if (isWalletNoise(e.reason)) { console.warn("wallet registry:", e.reason?.message || e.reason); return; } showFatal((e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)); });

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { showFatal((err && err.stack) + "\n" + (info && info.componentStack || "")); }
  render() {
    if (this.state.err) {
      return React.createElement("div", { style: { padding: 40, fontFamily: "monospace", color: "#ffb4a6", whiteSpace: "pre-wrap" } },
        "Страница упала. Пришлите скрин этой ошибки:\n\n" + String(this.state.err && (this.state.err.stack || this.state.err.message)));
    }
    return this.props.children;
  }
}

// Staging-сборка (base != "/") не должна попадать в поисковики.
if (import.meta.env.BASE_URL !== "/") {
  const m = document.createElement("meta");
  m.name = "robots";
  m.content = "noindex, nofollow";
  document.head.appendChild(m);
}

// StagingGate — замок тестового сайта (пусто в основной сборке, см. components/StagingGate.jsx)
createRoot(document.getElementById("root")).render(<Boundary><StagingGate><LangProvider><App /></LangProvider></StagingGate></Boundary>);
