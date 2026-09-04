import { Electroview } from "electrobun/view";
import { rpc } from "./src/rpc.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./src/App.js";

// Initialize Electroview with our typed RPC schema
export const electroview = new Electroview({ rpc });

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(React.createElement(App));
} else {
  console.error("Root element #root not found in document");
}
