import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { clientLogger } from "./rpc";
// Self-hosted fonts: no network round trip for a LAN-only app.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";

// Restore the persisted zoom level before the first paint to avoid a layout shift.
try {
  const savedZoom = localStorage.getItem("portfolio_zoom_level");
  if (savedZoom) {
    const parsed = parseFloat(savedZoom);
    if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2.5) {
      document.documentElement.style.zoom = String(parsed);
    }
  }
} catch {
  // localStorage unavailable
}

clientLogger.log("debug", "mount", "GUI script loaded", undefined, { url: window.location.href });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
