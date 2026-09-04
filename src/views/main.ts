import { Electroview } from "electrobun/view";
import { rpc, clientLogger, setElectroviewInstance } from "./src/rpc.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./src/App.js";

// Initialize Electroview with our typed RPC schema
export const electroview = new Electroview({ rpc });
setElectroviewInstance(electroview);

clientLogger.log("info", "webview_entrypoint", "Webview script loaded, mounting React root", undefined, {
  url: typeof window !== "undefined" ? window.location.href : "",
  readyState: typeof document !== "undefined" ? document.readyState : "",
});

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(React.createElement(App));
  clientLogger.log("info", "react_mounted", "React root rendered successfully");
} else {
  clientLogger.log("error", "react_mount_failed", "Root element #root not found in document");
  console.error("Root element #root not found in document");
}
