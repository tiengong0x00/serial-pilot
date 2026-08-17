import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "sonner";
import ToolboxWindow from "./components/toolbox/ToolboxWindow";
import ErrorBoundary from "./components/ErrorBoundary";
import { useCommandLibrary } from "./stores/commandLibraryStore";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useLanguageEffect } from "./hooks/useLanguageEffect";
import "./i18n";
import "./index.css";

// 全局禁用浏览器默认右键菜单（桌面应用不需要）
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// 工具箱窗口根组件：仅应用主题/语言，不加载串口等主窗口逻辑
const ToolboxApp = () => {
  useThemeEffect();
  useLanguageEffect();

  // toolbox 是独立 webview（独立 JS 上下文），需自行加载命令库供 AT 速查使用
  useEffect(() => {
    void useCommandLibrary.getState().load();
  }, []);

  return (
    <>
      <Sonner
        position="top-right"
        richColors
        closeButton
        duration={3000}
        toastOptions={{ className: "font-sans" }}
      />
      <ErrorBoundary>
        <ToolboxWindow />
      </ErrorBoundary>
    </>
  );
};

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <ToolboxApp />
  </React.StrictMode>
);
