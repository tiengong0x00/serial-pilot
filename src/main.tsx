import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 全局禁用浏览器默认右键菜单（桌面应用不需要）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
