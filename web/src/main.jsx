import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./lib/i18n.jsx";
import { installTooltips } from "./lib/tooltip.js";
import StagingGate from "./components/StagingGate.jsx";
import { WC_PROJECT_ID } from "./lib/config.js";
import "./styles.css";

installTooltips();

// Скорость: в простое после загрузки заранее тянем код остальных страниц
// (арена, документация…) — переход по вкладкам без ожидания чанка.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
idle(() => {
  import("./pages/Arena.jsx"); import("./pages/Docs.jsx"); import("./components/CandleChart.jsx");
});
// Тяжёлый прогрев — только когда страница уже показала свои данные: раньше
// прогрев арены (все сделки платформы, обмены Uniswap, фонд) и AppKit
// стартовали через полторы секунды и толкались с запросами самой страницы —
// узел отвечал 429, и цифры на странице «плавали» (аудит 19.09.2026).
// Прогрев арены убран (аудит 19.09.2026): он жёг бюджет узла (~130 вызовов)
// на каждой странице, а после него любой клик по монете получал 429. Арена
// теперь и так открывается быстро: отправители и блоки — в вечном кэше.
setTimeout(() => {
  // окно кошельков (Reown AppKit) тяжёлое — поднимаем его заранее в простое,
  // чтобы «Подключить кошелёк» открывалось мгновенно, как у Pons (17.09.2026)
  if (/^[0-9a-f]{32}$/i.test(WC_PROJECT_ID)) import("./lib/appkit.js").catch(() => {});
}, 9000);

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
// Всплывающие подсказки при наведении (атрибут title) владелец убрал 17.09.2026 —
// «бесят». Срезаем их у всех элементов разом, включая те, что появятся позже;
// в коде title остаются как пояснения, но браузер их не показывает.
(() => {
  const strip = (root) => {
    if (root.nodeType !== 1) return;
    if (root.hasAttribute("title")) root.removeAttribute("title");
    for (const el of root.querySelectorAll("[title]")) el.removeAttribute("title");
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") { if (m.target.hasAttribute("title")) m.target.removeAttribute("title"); continue; }
      m.addedNodes.forEach(strip);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
  strip(document.documentElement);
})();

createRoot(document.getElementById("root")).render(<Boundary><StagingGate><LangProvider><App /></LangProvider></StagingGate></Boundary>);
