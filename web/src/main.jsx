import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./lib/i18n.jsx";
import "./styles.css";

// Staging-сборка (base != "/") не должна попадать в поисковики.
if (import.meta.env.BASE_URL !== "/") {
  const m = document.createElement("meta");
  m.name = "robots";
  m.content = "noindex, nofollow";
  document.head.appendChild(m);
}

createRoot(document.getElementById("root")).render(<LangProvider><App /></LangProvider>);
