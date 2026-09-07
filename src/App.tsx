import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster as Sonner } from "sonner";
import Index from "./pages/Index";
import ErrorBoundary from "./components/ErrorBoundary";
import { useCommandLibrary } from "./stores/commandLibraryStore";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useLanguageEffect } from "./hooks/useLanguageEffect";
import { usePowerMonitor } from "./hooks/usePowerMonitor";
import { useTestExecution } from "./hooks/useTestExecution";
import { initCLIMode } from "./cli-adapter";
import { NotificationContainer } from "./components/TestNotification";
import { initReportMonitor } from "./report-monitor";

const App = () => {
  // 应用主题和语言设置（从 settingsStore 读取并应用到 DOM）
  useThemeEffect();
  useLanguageEffect();

  // 监听系统电源事件（休眠/恢复）
  usePowerMonitor();

  // 测试执行 hook
  const { startExecution } = useTestExecution();

  // 启动时加载命令库（从 .exe/../commands/*.json 构建内存 Trie）
  useEffect(() => {
    void useCommandLibrary.getState().load();
  }, []);

  // 初始化报告监控器
  useEffect(() => {
    const unsubscribe = initReportMonitor();
    return unsubscribe;
  }, []);

  // 初始化 CLI 模式（如果处于 CLI 模式）
  useEffect(() => {
    if (window.__CLI_MODE__) {
      console.log('[App] Detected CLI mode, initializing...');

      // 注册测试执行函数供 CLI 使用
      window.__executeTestCase = async () => {
        console.log('[App] __executeTestCase called');
        await startExecution();
      };

      // 立即初始化，stores 应该已经通过 import 时的初始化准备好了
      initCLIMode();
    }
  }, [startExecution]);

  return (
    <>
      <Sonner
        position="top-right"
        richColors
        closeButton
        duration={3000}
        offset={{
          top: '6.5rem',
          right: '1.5rem',
        }}
        toastOptions={{ className: "font-sans" }}
      />
      <NotificationContainer />
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
