import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

console.log('[main.tsx] Script loaded');
console.log('[main.tsx] window.location:', window.location.href);

// 检测 CLI 模式（通过 URL 参数）
const urlParams = new URLSearchParams(window.location.search);
const isCliMode = urlParams.get('cli') === 'true';

console.log('[main.tsx] URL params:', window.location.search);
console.log('[main.tsx] isCliMode:', isCliMode);

if (isCliMode) {
  window.__CLI_MODE__ = true;
  console.log('[CLI] Running in CLI mode');

  // 立即发送就绪信号（在应用初始化之前）
  console.log('[CLI] Sending early ready signal...');
  import('@tauri-apps/api/event').then(({ emit }) => {
    emit('cli-ready', { early: true })
      .then(() => console.log('[CLI] Early ready signal sent successfully'))
      .catch((error) => console.error('[CLI] Failed to send early ready signal:', error));
  }).catch(error => {
    console.error('[CLI] Failed to import Tauri event module:', error);
  });
}

// 全局禁用浏览器默认右键菜单（桌面应用不需要）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

const container = document.getElementById("root");
if (!container) {
  console.error('[main.tsx] Root element #root not found');
  throw new Error("Root element #root not found");
}

console.log('[main.tsx] Creating React root...');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
console.log('[main.tsx] React root created');
