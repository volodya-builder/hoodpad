import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./lib/i18n.jsx";
import "./styles.css";

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
window.addEventListener("unhandledrejection", (e) => showFatal((e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));

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

createRoot(document.getElementById("root")).render(<Boundary><LangProvider><App /></LangProvider></Boundary>);
