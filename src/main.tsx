import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// styles.css first: it holds the primitives (.btn, .input, .menu…) that component
// stylesheets override, and Vite emits CSS in import order
import "./styles.css";
import { App } from "./App.tsx";
import { loadSettings, SettingsProvider } from "./lib/settings.ts";
import { loadDictionary, resolveLanguage } from "./lib/i18n.ts";
import "./lib/viewport.ts";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

const root = createRoot(container);
const render = () => root.render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);

loadDictionary(resolveLanguage(loadSettings().language)).then(render, render);
