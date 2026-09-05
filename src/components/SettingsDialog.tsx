import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useSettingsStore,
  TERMINAL_BG_PRESETS,
  TERMINAL_TEXT_PRESETS,
  TERMINAL_THEME_PRESETS,
} from "@/stores/settingsStore";
import { SHORTCUT_BINDINGS } from "@/lib/shortcutBus";
import { HighlightSettings } from "./HighlightSettings";
import { useSerialStore } from "@/stores/serialStore";
import { useSerialCommands } from "@/hooks/useSerialCommands";
import type { SerialConfig } from "@/types/serial";
import { toast } from "sonner";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab = "general" | "testcases" | "appearance" | "serial" | "terminal" | "highlight" | "shortcuts" | "about";

/** 流控模式选择器（P1/P2 独立） */
function FlowControlSelect({ portLabel }: { portLabel: 'P1' | 'P2' }) {
  const { t } = useTranslation();
  const { p1Config, p2Config, setConfig } = useSerialStore();
  const config = portLabel === 'P1' ? p1Config : p2Config;

  const handleChange = (flowControl: SerialConfig['flow_control']) => {
    setConfig(portLabel, { ...config, flow_control: flowControl });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{portLabel} {t("settings.flowControl")}</label>
      <select
        className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        value={config.flow_control}
        onChange={(e) => handleChange(e.target.value as SerialConfig['flow_control'])}
      >
        <option value="none">{t("settings.flowControlNone")}</option>
        <option value="software">{t("settings.flowControlSoftware")}</option>
        <option value="hardware">{t("settings.flowControlHardware")}</option>
      </select>
    </div>
  );
}

const SettingsDialog = ({ open, onOpenChange }: SettingsDialogProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // 更新状态管理
  type UpdateState =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string; body?: string; download: () => Promise<void> }
    | { status: 'not-available' }
    | { status: 'downloading'; percent: number; speed: number; downloaded: number; total: number }
    | { status: 'ready'; relaunch: () => void }
    | { status: 'error'; message: string };

  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [bgAdvancedOpen, setBgAdvancedOpen] = useState(false); // 背景图高级选项折叠状态
  const [terminalColorsOpen, setTerminalColorsOpen] = useState(false); // 终端配色自定义折叠状态
  const [backgroundOpen, setBackgroundOpen] = useState(true); // 背景图分组折叠状态（默认展开）
  const [appVersion, setAppVersion] = useState<string>("0.1.0"); // 应用版本号

  // 路径配置
  const { getAppConfig, setTestcasesDir, setCommandsDir, openHelpManual } = useSerialCommands();
  const [testcasesPath, setTestcasesPath] = useState("");
  const [commandsPath, setCommandsPath] = useState("");

  // 加载路径配置
  useEffect(() => {
    if (open) {
      getAppConfig().then((config) => {
        setTestcasesPath(config.testcasesDir);
        setCommandsPath(config.commandsDir);
      }).catch(err => {
        console.error("Failed to load app config:", err);
      });
    }
  }, [open, getAppConfig]);

  // 保存路径配置
  const handleSaveTestcasesPath = async () => {
    try {
      await setTestcasesDir(testcasesPath);
      toast.success(t("settings.pathSaved"));
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleSaveCommandsPath = async () => {
    try {
      await setCommandsDir(commandsPath);
      toast.success(t("settings.pathSaved"));
    } catch (err) {
      toast.error(String(err));
    }
  };

  // 背景图上传处理
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查文件大小（限制 5MB）
    if (file.size > 5 * 1024 * 1024) {
      alert(t("settings.backgroundTooLarge"));
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target?.result as string;

      // 按用户配置压缩图片
      const img = new Image();
      img.onload = () => {
        const maxWidth = backgroundMaxResolution;
        const maxHeight = Math.round((backgroundMaxResolution * 9) / 16);
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', backgroundQuality);
          if (compressed.length > 4 * 1024 * 1024) {
            alert(t("settings.backgroundCompressedTooLarge"));
            return;
          }
          setBackgroundImage(compressed);
          resetBackgroundTransform();
        }
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 背景图拖拽处理
  const handleBackgroundDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = backgroundPositionX;
    const startPosY = backgroundPositionY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const newX = Math.max(-50, Math.min(50, startPosX + deltaX / 3));
      const newY = Math.max(-50, Math.min(50, startPosY + deltaY / 3));
      setBackgroundPosition(newX, newY);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 背景图缩放处理
  const handleBackgroundZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -10 : 10;
    const base = backgroundCover ? 100 : backgroundScale;
    const newScale = Math.max(50, Math.min(300, base + delta));
    setBackgroundScale(newScale);
  };

  // 浏览选择目录
  const handleBrowseTestcasesPath = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("settings.selectTestcasesDir"),
      });
      if (selected) {
        setTestcasesPath(selected as string);
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleBrowseCommandsPath = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("settings.selectCommandsDir"),
      });
      if (selected) {
        setCommandsPath(selected as string);
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  // 获取应用版本号
  useEffect(() => {
    getVersion().then(version => setAppVersion(version)).catch(() => setAppVersion("0.1.0"));
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateState({ status: 'checking' });
    try {
      const updateInfo = await invoke<{ available: boolean; version?: string }>('check_update');

      if (updateInfo.available) {
        setUpdateState({
          status: 'available',
          version: updateInfo.version ?? '',
          download: async () => {
            setUpdateState({ status: 'downloading', percent: 0, speed: 0, downloaded: 0, total: 0 });

            // 监听下载进度事件
            const unlisten = await listen<{ downloaded: number; total: number; percent: number; speed: number }>(
              'download_progress',
              (event) => {
                setUpdateState({
                  status: 'downloading',
                  percent: event.payload.percent,
                  speed: event.payload.speed,
                  downloaded: event.payload.downloaded,
                  total: event.payload.total,
                });
              }
            );

            try {
              await invoke('install_update');
              unlisten();
              setUpdateState({
                status: 'ready',
                relaunch: () => { void relaunch(); }
              });
            } catch (error) {
              unlisten();
              console.error('[Update Error]', error);
              setUpdateState({
                status: 'error',
                message: error instanceof Error ? error.message : String(error)
              });
            }
          },
        });
      } else {
        setUpdateState({ status: 'not-available' });
      }
    } catch (error) {
      setUpdateState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const {
    language,
    themeMode,
    terminalBgColor,
    terminalTextColor,
    terminalTxColor,
    terminalOpacity,
    backgroundImage,
    backgroundOpacity,
    backgroundPositionX,
    backgroundPositionY,
    backgroundScale,
    backgroundCover,
    backgroundMaxResolution,
    backgroundQuality,
    backgroundPreset,
    overlayStrength,
    overlayBlur,
    filePacketSize,
    filePacketInterval,
    serialFrameTimeout,
    terminalFontSize,
    terminalLineHeight,
    terminalMaxBytes,
    terminalLogPath,
    testCaseAutoSave,
    testCaseRowHeight,
    testCaseButtonWidth,
    testCaseButtonDisplay,
    testCaseButtonContent,
    enterToSend,
    setLanguage,
    setThemeMode,
    setTerminalBgColor,
    setTerminalTextColor,
    setTerminalTxColor,
    setTerminalOpacity,
    setBackgroundImage,
    setBackgroundOpacity,
    setBackgroundPosition,
    setBackgroundScale,
    setBackgroundCover,
    setBackgroundMaxResolution,
    setBackgroundQuality,
    setBackgroundPreset,
    setOverlayStrength,
    setOverlayBlur,
    resetBackgroundTransform,
    setFilePacketSize,
    setFilePacketInterval,
    setSerialFrameTimeout,
    setTerminalFontSize,
    setTerminalLineHeight,
    setTerminalMaxBytes,
    setTerminalLogPath,
    setTestCaseAutoSave,
    setTestCaseRowHeight,
    setTestCaseButtonWidth,
    setTestCaseButtonDisplay,
    setTestCaseButtonContent,
    setEnterToSend,
  } = useSettingsStore();

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: "general", label: t("settings.navGeneral") },
    { id: "testcases", label: t("settings.navTestCases") },
    { id: "appearance", label: t("settings.navAppearance") },
    { id: "serial", label: t("settings.navSerial") },
    { id: "terminal", label: t("settings.navTerminal") },
    { id: "highlight", label: t("settings.navHighlight") },
    { id: "shortcuts", label: t("settings.navShortcuts") },
    { id: "about", label: t("settings.navAbout") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex h-[calc(85vh-120px)]">
          {/* 左侧导航 */}
          <nav className="w-48 border-r bg-muted/30 p-3">
            <div className="flex flex-col gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    px-3 py-2 text-sm text-left rounded-md transition-colors
                    ${
                      activeTab === tab.id
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    }
                  `}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>

          {/* 右侧内容区 */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "general" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.generalDesc")}</p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{t("settings.language")}</label>
                  <select
                    className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as "zh-CN" | "en-US")}
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                  </select>
                  <p className="text-xs text-muted-foreground">{t("settings.languageHint")}</p>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("settings.enterToSend")}</div>
                    <p className="text-xs text-muted-foreground mt-1">{t("settings.enterToSendHint")}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={enterToSend}
                    onChange={(e) => setEnterToSend(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input cursor-pointer"
                  />
                </div>

                {/* 存储路径配置 */}
                <div className="border-t pt-4 mt-2 flex flex-col gap-4">
                  <div>
                    <h3 className="text-sm font-medium mb-1">{t("settings.pathsTitle")}</h3>
                    <p className="text-xs text-muted-foreground">{t("settings.pathsDesc")}</p>
                  </div>

                  {/* 测试用例目录 */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("settings.testcasesDir")}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={testcasesPath}
                        onChange={(e) => setTestcasesPath(e.target.value)}
                        placeholder={t("settings.pathPlaceholderTestcases")}
                        className="flex-1 h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={handleBrowseTestcasesPath}
                        className="px-3 h-9 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
                      >
                        {t("settings.pathBrowse")}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveTestcasesPath}
                        className="px-3 h-9 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        {t("settings.pathSave")}
                      </button>
                    </div>
                  </div>

                  {/* 命令库目录 */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">{t("settings.commandsDir")}</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commandsPath}
                        onChange={(e) => setCommandsPath(e.target.value)}
                        placeholder={t("settings.pathPlaceholderCommands")}
                        className="flex-1 h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={handleBrowseCommandsPath}
                        className="px-3 h-9 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
                      >
                        {t("settings.pathBrowse")}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveCommandsPath}
                        className="px-3 h-9 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        {t("settings.pathSave")}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">{t("settings.pathHint")}</p>
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">{t("settings.pathRestartHint")}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "testcases" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.testCasesDesc")}</p>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("settings.testCaseAutoSave")}</div>
                    <p className="text-xs text-muted-foreground mt-1">{t("settings.testCaseAutoSaveHint")}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={testCaseAutoSave}
                    onChange={(e) => setTestCaseAutoSave(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{t("settings.testCaseRowHeight")}</div>
                      <p className="text-xs text-muted-foreground mt-1">{t("settings.testCaseRowHeightHint")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-12 text-right">{testCaseRowHeight}px</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={24}
                    max={48}
                    step={2}
                    value={testCaseRowHeight}
                    onChange={(e) => setTestCaseRowHeight(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{t("settings.testCaseButtonWidth")}</div>
                      <p className="text-xs text-muted-foreground mt-1">{t("settings.testCaseButtonWidthHint")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-12 text-right">{testCaseButtonWidth}px</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={24}
                    max={80}
                    step={2}
                    value={testCaseButtonWidth}
                    onChange={(e) => setTestCaseButtonWidth(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("settings.testCaseButtonDisplay")}</div>
                    <p className="text-xs text-muted-foreground mt-1">{t("settings.testCaseButtonDisplayHint")}</p>
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="testCaseButtonDisplay"
                        value="hover"
                        checked={testCaseButtonDisplay === 'hover'}
                        onChange={(e) => setTestCaseButtonDisplay(e.target.value as 'hover' | 'always')}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span className="text-sm">{t("settings.testCaseButtonHover")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="testCaseButtonDisplay"
                        value="always"
                        checked={testCaseButtonDisplay === 'always'}
                        onChange={(e) => setTestCaseButtonDisplay(e.target.value as 'hover' | 'always')}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span className="text-sm">{t("settings.testCaseButtonAlways")}</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t("settings.testCaseButtonContent")}</div>
                    <p className="text-xs text-muted-foreground mt-1">{t("settings.testCaseButtonContentHint")}</p>
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="testCaseButtonContent"
                        value="auto"
                        checked={testCaseButtonContent === 'auto'}
                        onChange={(e) => setTestCaseButtonContent(e.target.value as 'icon' | 'text' | 'auto')}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span className="text-sm">{t("settings.testCaseButtonContentAuto")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="testCaseButtonContent"
                        value="icon"
                        checked={testCaseButtonContent === 'icon'}
                        onChange={(e) => setTestCaseButtonContent(e.target.value as 'icon' | 'text' | 'auto')}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span className="text-sm">{t("settings.testCaseButtonContentIcon")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="testCaseButtonContent"
                        value="text"
                        checked={testCaseButtonContent === 'text'}
                        onChange={(e) => setTestCaseButtonContent(e.target.value as 'icon' | 'text' | 'auto')}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span className="text-sm">{t("settings.testCaseButtonContentText")}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.appearanceDesc")}</p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{t("settings.themeMode")}</label>
                  <div className="flex gap-2">
                    {(["light", "dark", "system"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setThemeMode(mode)}
                        className={`
                          flex-1 px-4 py-2 text-sm rounded-md border transition-colors
                          ${
                            themeMode === mode
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-input hover:bg-muted"
                          }
                        `}
                      >
                        {t(`settings.theme${mode.charAt(0).toUpperCase() + mode.slice(1)}` as any)}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("settings.themeModeHint")}</p>
                </div>

                {/* ========== 终端配色分组 ========== */}
                <div className="flex flex-col gap-3 mt-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{t("settings.terminalColors")}</label>
                    <button
                      type="button"
                      onClick={() => setTerminalColorsOpen(!terminalColorsOpen)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {terminalColorsOpen ? "收起 ▲" : "展开 ▼"}
                    </button>
                  </div>

                  {/* 快速预设 */}
                  <div className="flex gap-2 flex-wrap">
                    {TERMINAL_THEME_PRESETS.map((preset) => {
                      const active = terminalBgColor === preset.bg && terminalTextColor === preset.text;
                      return (
                        <button
                          key={preset.name}
                          onClick={() => {
                            setTerminalBgColor(preset.bg);
                            setTerminalTextColor(preset.text);
                          }}
                          className={`
                            px-3 py-2 text-xs rounded border transition-all font-mono
                            ${active ? "ring-2 ring-primary border-primary" : "border-input hover:border-primary/50"}
                          `}
                          style={{ background: `hsl(${preset.bg})`, color: `hsl(${preset.text})` }}
                        >
                          {preset.name}
                        </button>
                      );
                    })}
                  </div>

                  {/* 自定义颜色（折叠） */}
                  {terminalColorsOpen && (
                    <div className="flex flex-col gap-3 pt-2 border-t border-border/30">
                      <ColorSwatchRow
                        label={t("settings.terminalBgColor")}
                        hint={t("settings.terminalBgColorHint")}
                        customLabel={t("settings.terminalBgCustom")}
                        presets={TERMINAL_BG_PRESETS}
                        value={terminalBgColor}
                        onChange={setTerminalBgColor}
                      />

                      <ColorSwatchRow
                        label={t("settings.terminalRxColor")}
                        hint={t("settings.terminalRxColorHint")}
                        customLabel={t("settings.terminalBgCustom")}
                        presets={TERMINAL_TEXT_PRESETS}
                        value={terminalTextColor}
                        onChange={setTerminalTextColor}
                      />

                      <ColorSwatchRow
                        label={t("settings.terminalTxColor")}
                        hint={t("settings.terminalTxColorHint")}
                        customLabel={t("settings.terminalBgCustom")}
                        presets={TERMINAL_TEXT_PRESETS}
                        value={terminalTxColor}
                        onChange={setTerminalTxColor}
                      />
                    </div>
                  )}
                </div>

                {/* ========== 背景图与效果分组 ========== */}
                <div className="flex flex-col gap-3 mt-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{t("settings.backgroundAndEffects")}</label>
                    <button
                      type="button"
                      onClick={() => setBackgroundOpen(!backgroundOpen)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {backgroundOpen ? "收起 ▲" : "展开 ▼"}
                    </button>
                  </div>

                  {backgroundOpen && (
                    <>
                      {backgroundImage ? (
                        <div className="flex flex-col gap-3">
                          {/* 操作按钮 */}
                          <div className="flex gap-2">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleImageUpload}
                              className="hidden"
                              id="background-image-replace"
                            />
                            <label
                              htmlFor="background-image-replace"
                              className="flex-1 px-3 py-1.5 text-xs rounded-md border border-input hover:bg-muted transition-colors cursor-pointer inline-block text-center"
                            >
                              {t("settings.replaceImage")}
                            </label>
                            <button
                              type="button"
                              onClick={() => { setBackgroundImage(''); resetBackgroundTransform(); }}
                              className="flex-1 px-3 py-1.5 text-xs rounded-md border border-input hover:bg-destructive/10 hover:border-destructive transition-colors"
                            >
                              {t("settings.removeBackground")}
                            </button>
                          </div>

                          {/* 清晰度预设（一键配置） */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-xs text-muted-foreground">{t("settings.clarityPreset")}</span>
                            <div className="grid grid-cols-4 gap-1.5">
                              <button
                                type="button"
                                onClick={() => setBackgroundPreset('clear')}
                                className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                                  backgroundPreset === 'clear' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
                                }`}
                              >
                                {t("settings.presetClear")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setBackgroundPreset('balanced')}
                                className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                                  backgroundPreset === 'balanced' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
                                }`}
                              >
                                {t("settings.presetBalanced")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setBackgroundPreset('beautiful')}
                                className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                                  backgroundPreset === 'beautiful' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
                                }`}
                              >
                                {t("settings.presetBeautiful")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setBackgroundPreset('custom')}
                                className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                                  backgroundPreset === 'custom' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
                                }`}
                              >
                                {t("settings.presetCustom")}
                              </button>
                            </div>
                            <p className="text-[10px] text-muted-foreground/60">{t("settings.clarityPresetHint")}</p>
                          </div>

                          {/* 高级调整（折叠） */}
                          <div className="border-t border-border/30 pt-2">
                            <button
                              type="button"
                              onClick={() => setBgAdvancedOpen(!bgAdvancedOpen)}
                              className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
                            >
                              <span>{t("settings.advancedAdjust")}</span>
                              <span>{bgAdvancedOpen ? "▲" : "▼"}</span>
                            </button>

                            {bgAdvancedOpen && (
                              <div className="flex flex-col gap-3">
                                {/* 背景强度 */}
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{t("settings.backgroundStrength")}</span>
                                    <span className="font-mono">{backgroundOpacity}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="5"
                                    value={backgroundOpacity}
                                    onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                                    className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted"
                                  />
                                </div>

                                {/* 遮罩强度 */}
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{t("settings.overlayStrength")}</span>
                                    <span className="font-mono">{overlayStrength}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="5"
                                    value={overlayStrength}
                                    onChange={(e) => setOverlayStrength(Number(e.target.value))}
                                    className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted"
                                  />
                                </div>

                                {/* 模糊强度 */}
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{t("settings.overlayBlur")}</span>
                                    <span className="font-mono">{overlayBlur}px</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="20"
                                    step="2"
                                    value={overlayBlur}
                                    onChange={(e) => setOverlayBlur(Number(e.target.value))}
                                    className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted"
                                  />
                                  <span className="text-[10px] text-muted-foreground/60">{t("settings.overlayBlurHint")}</span>
                                </div>

                                {/* 终端透明度 */}
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{t("settings.terminalOpacity")}</span>
                                    <span className="font-mono">{terminalOpacity}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    step="5"
                                    value={terminalOpacity}
                                    onChange={(e) => setTerminalOpacity(Number(e.target.value))}
                                    className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted"
                                  />
                                  <span className="text-[10px] text-muted-foreground/60">{t("settings.terminalOpacityHint")}</span>
                                </div>

                                {/* 位置和缩放调整（升级为完整界面预览） */}
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{t("settings.backgroundAdjust")}</span>
                                    <span className="font-mono">{backgroundCover ? t("settings.backgroundFit") : `${backgroundScale}%`}</span>
                                  </div>
                                  <div
                                    className="relative w-full h-32 rounded-md border border-border overflow-hidden bg-secondary/20 group cursor-move"
                                    onMouseDown={handleBackgroundDrag}
                                    onWheel={handleBackgroundZoom}
                                  >
                                    {/* 背景图层 */}
                                    <div
                                      className="absolute inset-0 bg-no-repeat"
                                      style={{
                                        backgroundImage: `url(${backgroundImage})`,
                                        backgroundPosition: `${50 + backgroundPositionX}% ${50 + backgroundPositionY}%`,
                                        backgroundSize: backgroundCover ? 'cover' : `${backgroundScale}%`,
                                      }}
                                    />
                                    {/* 透明度遮罩层 */}
                                    <div
                                      className="absolute inset-0 pointer-events-none bg-mask-layer"
                                      style={{ opacity: 1 - backgroundOpacity / 100 }}
                                    />
                                    {/* 保护遮罩层 */}
                                    <div
                                      className="absolute inset-0 pointer-events-none"
                                      style={{
                                        backgroundColor: `rgba(0, 0, 0, ${overlayStrength / 100})`,
                                        backdropFilter: overlayBlur > 0 ? `blur(${overlayBlur}px)` : 'none',
                                      }}
                                    />
                                    {/* 模拟终端区域 */}
                                    <div
                                      className="absolute inset-2 rounded border border-border/30"
                                      style={{
                                        backgroundColor: `hsl(var(--terminal-bg) / ${terminalOpacity / 100})`,
                                      }}
                                    >
                                      <div className="p-2 space-y-1 text-[10px] font-mono">
                                        <div style={{ color: 'hsl(var(--terminal-text))' }}>$ serial-pilot started</div>
                                        <div style={{ color: 'hsl(var(--terminal-tx))' }}>TX: AT+CGMR</div>
                                        <div style={{ color: 'hsl(var(--terminal-rx))' }}>RX: OK</div>
                                      </div>
                                    </div>
                                    {/* 控制按钮 */}
                                    <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={() => { setBackgroundCover(true); setBackgroundPosition(0, 0); }}
                                        className={`w-6 h-6 rounded text-white text-xs flex items-center justify-center ${backgroundCover ? 'bg-primary/80 hover:bg-primary' : 'bg-black/60 hover:bg-black/80'}`}
                                        title={t("settings.backgroundFit")}
                                      >
                                        ⤢
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setBackgroundScale(Math.min(300, (backgroundCover ? 100 : backgroundScale) + 10))}
                                        className="w-6 h-6 rounded bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
                                        title={t("settings.zoomIn")}
                                      >
                                        +
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setBackgroundScale(Math.max(50, (backgroundCover ? 100 : backgroundScale) - 10))}
                                        className="w-6 h-6 rounded bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
                                        title={t("settings.zoomOut")}
                                      >
                                        −
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => resetBackgroundTransform()}
                                        className="w-6 h-6 rounded bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
                                        title={t("settings.backgroundReset")}
                                      >
                                        ↻
                                      </button>
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground/60">{t("settings.backgroundAdjustHint")} · 实时预览最终效果</span>
                                </div>

                                {/* 压缩设置 */}
                                <div className="flex flex-col gap-2 pt-2 border-t border-border/30">
                                  <span className="text-xs font-medium">{t("settings.compressionSettings")}</span>

                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground">{t("settings.backgroundMaxResolution")}</span>
                                      <span className="font-mono">{backgroundMaxResolution}px</span>
                                    </div>
                                    <select
                                      value={backgroundMaxResolution}
                                      onChange={(e) => setBackgroundMaxResolution(Number(e.target.value))}
                                      className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background"
                                    >
                                      <option value={1920}>1920px (1080p)</option>
                                      <option value={2560}>2560px (1440p)</option>
                                      <option value={3840}>3840px (4K)</option>
                                    </select>
                                    <span className="text-[10px] text-muted-foreground/60">{t("settings.backgroundMaxResolutionHint")}</span>
                                  </div>

                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground">{t("settings.backgroundQuality")}</span>
                                      <span className="font-mono">{Math.round(backgroundQuality * 100)}%</span>
                                    </div>
                                    <input
                                      type="range"
                                      min="50"
                                      max="100"
                                      step="5"
                                      value={backgroundQuality * 100}
                                      onChange={(e) => setBackgroundQuality(Number(e.target.value) / 100)}
                                      className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted"
                                    />
                                    <span className="text-[10px] text-muted-foreground/60">{t("settings.backgroundQualityHint")}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="hidden"
                            id="background-image-upload"
                          />
                          <label
                            htmlFor="background-image-upload"
                            className="px-3 py-2 text-sm rounded-md border border-dashed border-input hover:bg-muted transition-colors cursor-pointer inline-block text-center"
                          >
                            📁 {t("settings.chooseImage")}
                          </label>
                          <p className="text-xs text-muted-foreground">{t("settings.backgroundHint")}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* 终端字体配置 */}
                <div className="border-t pt-4 mt-2">
                  <p className="text-sm text-muted-foreground mb-3">{t("settings.terminalDisplayDesc")}</p>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">{t("settings.terminalFontSize")}</label>
                    <input
                      type="range"
                      min={10}
                      max={20}
                      step={1}
                      className="accent-primary"
                      value={terminalFontSize}
                      onChange={(e) => setTerminalFontSize(Number(e.target.value))}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>10px</span>
                      <span className="font-medium text-foreground">{terminalFontSize}px</span>
                      <span>20px</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 mt-3">
                    <label className="text-sm font-medium">{t("settings.terminalLineHeight")}</label>
                    <input
                      type="range"
                      min={1.0}
                      max={2.0}
                      step={0.1}
                      className="accent-primary"
                      value={terminalLineHeight}
                      onChange={(e) => setTerminalLineHeight(Number(e.target.value))}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1.0</span>
                      <span className="font-medium text-foreground">{terminalLineHeight.toFixed(1)}</span>
                      <span>2.0</span>
                    </div>
                  </div>
                </div>

                {/* 实时预览 */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-sm font-medium">{t("settings.terminalPreview")}</label>
                  <div
                    className="rounded-md p-3 font-mono text-xs border border-border"
                    style={{ background: `hsl(${terminalBgColor})`, color: `hsl(${terminalTextColor})` }}
                  >
                    <div style={{ color: `hsl(${terminalTxColor})` }}>[TX] AT+CGMR</div>
                    <div>[RX] +CGMR: V1.0.0</div>
                    <div>[RX] OK</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "serial" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.fileSendDesc")}</p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{t("settings.filePacketSize")}</label>
                  <input
                    type="number"
                    min={0}
                    className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    value={filePacketSize}
                    onChange={(e) => setFilePacketSize(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.filePacketSizeHint")}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{t("settings.filePacketInterval")}</label>
                  <input
                    type="number"
                    min={0}
                    className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    value={filePacketInterval}
                    onChange={(e) => setFilePacketInterval(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.filePacketIntervalHint")}</p>
                </div>

                <div className="border-t pt-4 mt-2">
                  <p className="text-sm text-muted-foreground mb-3">{t("settings.receiveDesc")}</p>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">{t("settings.serialFrameTimeout")}</label>
                    <input
                      type="number"
                      min={6}
                      max={200}
                      className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                      value={serialFrameTimeout}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 20;
                        setSerialFrameTimeout(Math.max(6, Math.min(200, val)));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t("settings.serialFrameTimeoutHint")}</p>
                  </div>
                </div>

                <div className="border-t pt-4 mt-2">
                  <p className="text-sm text-muted-foreground mb-3">{t("settings.flowControlDesc")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FlowControlSelect portLabel="P1" />
                    <FlowControlSelect portLabel="P2" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{t("settings.flowControlHint")}</p>
                </div>
              </div>
            )}

            {activeTab === "terminal" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.terminalDisplayDesc")}</p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{t("settings.terminalMaxBytes")}</label>
                  <input
                    type="number"
                    min={1024}
                    max={10485760}
                    step={1024}
                    className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    value={terminalMaxBytes}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 1048576;
                      setTerminalMaxBytes(Math.max(1024, Math.min(10485760, val)));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.terminalMaxBytesHint")}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{t("settings.terminalLogPath")}</label>
                  <input
                    type="text"
                    className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    value={terminalLogPath}
                    onChange={(e) => setTerminalLogPath(e.target.value)}
                    placeholder="logs/"
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.terminalLogPathHint")}</p>
                </div>
              </div>
            )}

            {activeTab === "highlight" && <HighlightSettings />}

            {activeTab === "shortcuts" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.shortcutsDesc")}</p>
                <div className="flex flex-col gap-2">
                  {SHORTCUT_BINDINGS.map((b) => (
                    <div key={b.action} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                      <span className="text-foreground">{t(b.labelKey)}</span>
                      <kbd className="px-2 py-1 text-xs font-mono rounded border border-border bg-secondary/50 text-muted-foreground">
                        {b.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "about" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.aboutDesc")}</p>
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex items-baseline gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void openUrl("https://github.com/tiengong0x00/serial-pilot");
                      }}
                      className="font-medium text-primary hover:underline cursor-pointer"
                      title={t("settings.aboutRepoLink")}
                    >
                      {t("settings.aboutAppName")}
                    </button>
                    <span className="text-muted-foreground">v{appVersion}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {t("settings.aboutDescription")}
                  </p>
                </div>

                {/* 帮助手册 */}
                <div className="border-t pt-4 mt-2 flex flex-col gap-3">
                  <h3 className="text-sm font-medium">{t("settings.helpManuals")}</h3>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        void openHelpManual('testcases', language);
                      }}
                      className="px-4 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
                    >
                      {t("settings.testcasesHelp")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void openHelpManual('commands', language);
                      }}
                      className="px-4 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
                    >
                      {t("settings.commandsHelp")}
                    </button>
                  </div>
                </div>

                {/* 检查更新 */}
                <div className="border-t pt-4 mt-2 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleCheckUpdate}
                      disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
                      className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {updateState.status === 'checking'
                        ? t("settings.checkingUpdate")
                        : t("settings.checkUpdate")}
                    </button>

                    {updateState.status === 'not-available' && (
                      <span className="text-sm text-muted-foreground">{t("settings.updateNotAvailable")}</span>
                    )}
                    {updateState.status === 'error' && (
                      <span className="text-sm text-destructive">
                        {t("settings.updateError", { error: updateState.message })}
                      </span>
                    )}
                  </div>

                  {/* 发现新版本 */}
                  {updateState.status === 'available' && (
                    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
                      <div className="text-sm font-medium text-foreground">
                        {t("settings.updateAvailable", { version: updateState.version })}
                      </div>
                      {updateState.body && (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">{t("settings.updateReleaseNotes")}</span>
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
                            {updateState.body}
                          </pre>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => { void updateState.download(); }}
                        className="self-start px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        {t("settings.updateDownloadInstall")}
                      </button>
                    </div>
                  )}

                  {/* 下载中 */}
                  {updateState.status === 'downloading' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {t("settings.updateDownloading", { percent: updateState.percent })}
                        </span>
                        <span className="font-mono">
                          {formatBytes(updateState.downloaded)} / {formatBytes(updateState.total)}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${updateState.percent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {t("settings.updateSpeed")}: {updateState.speed.toFixed(1)} KB/s
                        </span>
                        {updateState.speed > 0 && updateState.total > 0 && (
                          <span>
                            {t("settings.updateTimeRemaining")}: {formatTimeRemaining(updateState.downloaded, updateState.total, updateState.speed)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 已就绪，等待重启 */}
                  {updateState.status === 'ready' && (
                    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
                      <span className="text-sm text-foreground">{t("settings.updateReadyRestart")}</span>
                      <button
                        type="button"
                        onClick={updateState.relaunch}
                        className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        {t("settings.updateRestartNow")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;

// 纯色块选择行：预设色块 + 自定义取色器（无文字标签）
interface ColorSwatchRowProps {
  label: string;
  hint: string;
  customLabel: string;
  presets: readonly string[];
  value: string;
  onChange: (hsl: string) => void;
}

function ColorSwatchRow({ label, hint, customLabel, presets, value, onChange }: ColorSwatchRowProps) {
  const isCustom = !presets.includes(value);
  return (
    <div className="flex flex-col gap-1.5 mt-3">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex gap-2 flex-wrap items-center">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onChange(preset)}
            title={preset}
            className={`
              w-8 h-8 rounded border transition-all
              ${value === preset ? "ring-2 ring-primary border-primary" : "border-input hover:border-primary/50"}
            `}
            style={{ background: `hsl(${preset})` }}
          />
        ))}
        <label
          title={customLabel}
          className={`
            relative w-8 h-8 rounded border cursor-pointer flex items-center justify-center transition-all
            ${isCustom ? "ring-2 ring-primary border-primary" : "border-input hover:border-primary/50"}
          `}
          style={{
            background: isCustom
              ? `hsl(${value})`
              : "conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
        >
          <input
            type="color"
            className="sr-only"
            value={hslToHex(value)}
            onChange={(e) => onChange(hexToHsl(e.target.value))}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// HSL ↔ HEX 转换辅助函数（简化版，用于颜色选择器）
function hslToHex(hsl: string): string {
  const [h, s, l] = hsl.split(/\s+/).map((v) => parseFloat(v));
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = (l / 100) - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// 格式化字节大小
// 格式：25.7 MB (26,958,848 B)
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  // 小于 1KB，只显示字节数
  if (bytes < 1024) return `${bytes} B`;

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = (bytes / Math.pow(k, i)).toFixed(1);

  // 格式化字节数为带千分位的字符串
  const formattedBytes = bytes.toLocaleString('en-US');

  return `${value} ${sizes[i]} (${formattedBytes} B)`;
}

// 格式化剩余时间
function formatTimeRemaining(downloaded: number, total: number, speedKBps: number): string {
  if (speedKBps === 0 || total === 0) return '--';
  const remainingBytes = total - downloaded;
  const remainingKB = remainingBytes / 1024;
  const remainingSecs = Math.ceil(remainingKB / speedKBps);

  if (remainingSecs < 60) {
    return `${remainingSecs}秒`;
  } else if (remainingSecs < 3600) {
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    return `${mins}分${secs}秒`;
  } else {
    const hours = Math.floor(remainingSecs / 3600);
    const mins = Math.floor((remainingSecs % 3600) / 60);
    return `${hours}小时${mins}分`;
  }
}
