import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster as Sonner } from "sonner";
import Index from "./pages/Index";
import ErrorBoundary from "./components/ErrorBoundary";
import { useCommandLibrary } from "./stores/commandLibraryStore";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useLanguageEffect } from "./hooks/useLanguageEffect";

const App = () => {
  // 应用主题和语言设置（从 settingsStore 读取并应用到 DOM）
  useThemeEffect();
  useLanguageEffect();

  // 启动时加载命令库（从 .exe/../commands/*.json 构建内存 Trie）
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
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="*" element={<Index />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </>
  );
};

export default App;
