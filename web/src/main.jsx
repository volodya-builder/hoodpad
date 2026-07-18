import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { LangProvider } from "./lib/i18n.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<LangProvider><App /></LangProvider>);
