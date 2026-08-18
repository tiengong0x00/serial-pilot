import { useState, useEffect } from "react";
import { Terminal, Plug, TestTube2, Settings2, Wrench } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Panel, Group, Separator } from "react-resizable-panels";
import SerialConnection from "@/components/serial/SerialConnection";
import DataTerminal from "@/components/serial/DataTerminal";
import { TestCaseManager } from "@/components/testcase/TestCaseManager";
import SettingsDialog from "@/components/SettingsDialog";
import StatusFooter from "@/components/StatusFooter";
import WindowControls from "@/components/WindowControls";
import { useSerialListener } from "@/hooks/useSerialListener";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useSettingsStore } from "@/stores/settingsStore";

const Index = () => {
  const { t } = useTranslation();
  const { backgroundImage, backgroundOpacity, backgroundPositionX, backgroundPositionY, backgroundScale, backgroundCover } = useSettingsStore();

  // 挂载串口数据监听器
  useSerialListener();

  const [leftPanelTab, setLeftPanelTab] = useState<string>(() => {
    return localStorage.getItem("serial_left_tab") || "connection";
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("0.1.0");

  // 获取应用版本号
  useEffect(() => {
    getVersion().then(version => setAppVersion(version)).catch(() => setAppVersion("0.1.0"));
  }, []);

  useEffect(() => {
    localStorage.setItem("serial_left_tab", leftPanelTab);
  }, [leftPanelTab]);

  // 全局快捷键：Ctrl+, 打开设置
  useShortcuts({
    onOpenSettings: () => setSettingsOpen(true),
  });

  return (
    <div
      className={`h-[100svh] md:h-screen w-full overflow-hidden bg-background animate-fade-in flex flex-col relative ${
        backgroundImage ? "bg-image-active" : ""
      }`}
      style={
        backgroundImage
          ? {
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: backgroundCover ? 'cover' : `${backgroundScale}%`,
              backgroundPosition: `${50 + backgroundPositionX}% ${50 + backgroundPositionY}%`,
              backgroundRepeat: 'no-repeat',
            }
          : undefined
      }
    >
      {/* 背景图遮罩层（降低不透明度，不影响前景内容） */}
      {/* 用内联 backgroundColor 而非 bg-background 类，避免受 bg-image-active 半透明规则影响 */}
      {backgroundImage && (
        <div
          className="absolute inset-0 pointer-events-none bg-mask-layer"
          style={{ opacity: 1 - backgroundOpacity / 100 }}
        />
      )}

      {/* 内容层 */}
      <div className="relative z-10 h-full flex flex-col">
      {/* Header - 自定义标题栏（含窗口控制） */}
      <header className="h-14 app-header px-6 flex items-center justify-between" data-tauri-drag-region>
        <div className="flex items-center gap-4" data-tauri-drag-region>
          <div className="flex items-center gap-3" data-tauri-drag-region>
            <Terminal className="w-6 h-6 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">{t("app.title")}</h1>
          </div>
          <span className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20">
            v{appVersion}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t("app.toolbox")}
            title={t("app.toolbox")}
            className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors rounded-md"
            onClick={() => {
              invoke("open_toolbox_window").catch((err) => {
                toast.error(`${t("app.toolbox")}: ${err}`);
              });
            }}
          >
            <Wrench className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label={t("app.settings")}
            className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors rounded-md"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <WindowControls />
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Group orientation="horizontal" className="h-full w-full">
          {/* Left Panel */}
          <Panel defaultSize="35" minSize="20" maxSize="50">
            <div className="h-full control-panel flex flex-col min-w-0 min-h-0">
              <div className="border-b border-border/50 px-4 py-3">
                <div className="grid w-full grid-cols-2 h-10 bg-secondary/50 p-1 rounded-lg">
                  <button
                    type="button"
                    className={`tab-trigger-enhanced text-sm h-8 inline-flex items-center justify-center ${
                      leftPanelTab === "connection" ? "tab-active bg-primary text-primary-foreground shadow-primary hover:bg-primary/90" : ""
                    }`}
                    onClick={() => setLeftPanelTab("connection")}
                  >
                    <Plug className="w-4 h-4 mr-2" />
                    {t("tabs.connection")}
                  </button>
                  <button
                    type="button"
                    className={`tab-trigger-enhanced text-sm h-8 inline-flex items-center justify-center ${
                      leftPanelTab === "testcase" ? "tab-active bg-primary text-primary-foreground shadow-primary hover:bg-primary/90" : ""
                    }`}
                    onClick={() => setLeftPanelTab("testcase")}
                  >
                    <TestTube2 className="w-4 h-4 mr-2" />
                    {t("tabs.testCase")}
                  </button>
                </div>
              </div>

              <div className="flex-1 m-0 animate-slide-up min-h-0 overflow-hidden">
                {leftPanelTab === "connection" ? (
                  <SerialConnection />
                ) : (
                  <TestCaseManager />
                )}
              </div>
            </div>
          </Panel>

          <Separator className="w-1 bg-border/50 hover:bg-primary/50 transition-colors cursor-col-resize" />

          {/* Right Panel - Data Terminal */}
          <Panel defaultSize="65" minSize="50">
            <div
              className={`h-full flex flex-col min-w-0 min-h-0 overflow-hidden ${
                backgroundImage ? "" : "bg-gradient-to-br from-background to-secondary/30"
              }`}
            >
              <DataTerminal />
            </div>
          </Panel>
        </Group>
      </div>

      {/* Status Footer */}
      <StatusFooter />

      {/* 设置对话框 */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </div>
  );
};

export default Index;
