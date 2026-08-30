import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
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
import type { SerialConfig } from "@/types/serial";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab = "general" | "theme" | "serial" | "terminal" | "highlight" | "shortcuts" | "about";

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
    | { status: 'downloading'; percent: number }
    | { status: 'ready'; relaunch: () => void }
    | { status: 'error'; message: string };

  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [bgAdvancedOpen, setBgAdvancedOpen] = useState(false); // 背景图高级选项折叠状态
  const [appVersion, setAppVersion] = useState<string>("0.1.0"); // 应用版本号

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
            setUpdateState({ status: 'downloading', percent: 0 });

            try {
              await invoke('install_update');
              setUpdateState({
                status: 'ready',
                relaunch: () => { void relaunch(); }
              });
            } catch (error) {
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
    terminalOpacity,
    backgroundImage,
    backgroundOpacity,
    backgroundPositionX,
    backgroundPositionY,
    backgroundScale,
    backgroundCover,
    backgroundMaxResolution,
    backgroundQuality,
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
    setTerminalOpacity,
    setBackgroundImage,
    setBackgroundOpacity,
    setBackgroundPosition,
    setBackgroundScale,
    setBackgroundCover,
    setBackgroundMaxResolution,
    setBackgroundQuality,
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
    { id: "theme", label: t("settings.navTheme") },
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
              </div>
            )}

            {activeTab === "theme" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("settings.themeDesc")}</p>

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

                {/* 整体配色预设 */}
                <div className="flex flex-col gap-1.5 mt-3">
                  <label className="text-sm font-medium">{t("settings.terminalThemePreset")}</label>
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
                  <p className="text-xs text-muted-foreground">{t("settings.terminalThemePresetHint")}</p>
                </div>

                {/* 背景色：纯色块 */}
                <ColorSwatchRow
                  label={t("settings.terminalBgColor")}
                  hint={t("settings.terminalBgColorHint")}
                  customLabel={t("settings.terminalBgCustom")}
                  presets={TERMINAL_BG_PRESETS}
                  value={terminalBgColor}
                  onChange={setTerminalBgColor}
                />

                {/* 文字色：纯色块 */}
                <ColorSwatchRow
                  label={t("settings.terminalTextColor")}
                  hint={t("settings.terminalTextColorHint")}
                  customLabel={t("settings.terminalBgCustom")}
                  presets={TERMINAL_TEXT_PRESETS}
                  value={terminalTextColor}
                  onChange={setTerminalTextColor}
                />

                {/* 背景图配置 */}
                <div className="flex flex-col gap-1.5 mt-3 border-t pt-4">
                  <label className="text-sm font-medium">{t("settings.backgroundImage")}</label>

                  {backgroundImage ? (
                    <div className="flex flex-col gap-2">
                      {/* 交互式背景图预览 */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t("settings.backgroundAdjust")}</span>
                          <span className="font-mono">{backgroundCover ? t("settings.backgroundFit") : `${backgroundScale}%`}</span>
                        </div>
                        <div
                          className="relative w-full h-40 rounded-md border border-border overflow-hidden bg-secondary/20 group"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return; // 只响应左键
                            e.preventDefault();
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startPosX = backgroundPositionX;
                            const startPosY = backgroundPositionY;

                            const handleMouseMove = (moveEvent: MouseEvent) => {
                              const deltaX = moveEvent.clientX - startX;
                              const deltaY = moveEvent.clientY - startY;
                              // 每 3px 鼠标移动 = 1% 位置偏移（灵敏度调节）
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
                          }}
                          onWheel={(e) => {
                            e.preventDefault();
                            const delta = e.deltaY > 0 ? -10 : 10; // 滚轮缩放步进 10%
                            const base = backgroundCover ? 100 : backgroundScale; // cover 模式从 100% 起算
                            const newScale = Math.max(50, Math.min(300, base + delta));
                            setBackgroundScale(newScale);
                          }}
                        >
                          <div
                            className="absolute inset-0 bg-no-repeat cursor-move"
                            style={{
                              backgroundImage: `url(${backgroundImage})`,
                              backgroundPosition: `${50 + backgroundPositionX}% ${50 + backgroundPositionY}%`,
                              backgroundSize: backgroundCover ? 'cover' : `${backgroundScale}%`,
                            }}
                          />
                          {/* 控制按钮（hover 时显示） */}
                          <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => { setBackgroundCover(true); setBackgroundPosition(0, 0); }}
                              className={`w-7 h-7 rounded text-white text-xs flex items-center justify-center ${backgroundCover ? 'bg-primary/80 hover:bg-primary' : 'bg-black/60 hover:bg-black/80'}`}
                              title={t("settings.backgroundFit")}
                            >
                              ⤢
                            </button>
                            <button
                              type="button"
                              onClick={() => setBackgroundScale(Math.min(300, (backgroundCover ? 100 : backgroundScale) + 10))}
                              className="w-7 h-7 rounded bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
                              title={t("settings.zoomIn")}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => setBackgroundScale(Math.max(50, (backgroundCover ? 100 : backgroundScale) - 10))}
                              className="w-7 h-7 rounded bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
                              title={t("settings.zoomOut")}
                            >
                              −
                            </button>
                            <button
                              type="button"
                              onClick={() => resetBackgroundTransform()}
                              className="w-7 h-7 rounded bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
                              title={t("settings.backgroundReset")}
                            >
                              ↻
                            </button>
                          </div>
                          {/* 提示文字 */}
                          <div className="absolute top-2 left-2 text-[10px] text-white bg-black/50 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            {t("settings.backgroundAdjustHint")}
                          </div>
                        </div>
                      </div>

                      {/* 背景图不透明度滑块 */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t("settings.backgroundOpacity")}</span>
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

                      {/* 终端背景不透明度滑块（背景图模式下控制终端透出程度） */}
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

                      {/* 移除背景图按钮 */}
                      <button
                        type="button"
                        onClick={() => { setBackgroundImage(''); resetBackgroundTransform(); }}
                        className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-muted transition-colors"
                      >
                        {t("settings.removeBackground")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
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

                            // 按用户配置压缩图片（分辨率上限 + JPEG 质量），避免 localStorage 超限
                            const img = new Image();
                            img.onload = () => {
                              // 宽度上限来自配置，高度按 16:9 推算上限（宽屏背景常见比例）
                              const maxWidth = backgroundMaxResolution;
                              const maxHeight = Math.round((backgroundMaxResolution * 9) / 16);
                              let { width, height } = img;

                              if (width > maxWidth || height > maxHeight) {
                                const ratio = Math.min(maxWidth / width, maxHeight / height);
                                width = Math.floor(width * ratio);
                                height = Math.floor(height * ratio);
                              }

                              // 使用 canvas 压缩
                              const canvas = document.createElement('canvas');
                              canvas.width = width;
                              canvas.height = height;
                              const ctx = canvas.getContext('2d');
                              if (ctx) {
                                ctx.drawImage(img, 0, 0, width, height);
                                // 输出 JPEG，质量取自配置
                                const compressed = canvas.toDataURL('image/jpeg', backgroundQuality);
                                // 体积保护：压缩后 base64 超过 ~4MB（localStorage 安全线）时提示
                                if (compressed.length > 4 * 1024 * 1024) {
                                  alert(t("settings.backgroundCompressedTooLarge"));
                                  return;
                                }
                                setBackgroundImage(compressed);
                                resetBackgroundTransform(); // 新图重置位置和缩放
                              }
                            };
                            img.src = base64;
                          };
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }}
                        className="hidden"
                        id="background-image-upload"
                      />
                      <label
                        htmlFor="background-image-upload"
                        className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted transition-colors cursor-pointer inline-block text-center"
                      >
                        {t("settings.chooseImage")}
                      </label>
                      <p className="text-xs text-muted-foreground">{t("settings.backgroundHint")}</p>

                      {/* 高级选项折叠面板 */}
                      <div className="mt-2 border-t pt-2">
                        <button
                          type="button"
                          onClick={() => setBgAdvancedOpen(!bgAdvancedOpen)}
                          className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <span>{t("settings.backgroundAdvanced")}</span>
                          <span className="text-[10px]">{bgAdvancedOpen ? '▲' : '▼'}</span>
                        </button>

                        {bgAdvancedOpen && (
                          <div className="flex flex-col gap-3 mt-3">
                            {/* 分辨率上限 */}
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

                            {/* 压缩质量 */}
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
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 实时预览 */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-sm font-medium">{t("settings.terminalPreview")}</label>
                  <div
                    className="rounded-md p-3 font-mono text-xs border border-border"
                    style={{ background: `hsl(${terminalBgColor})`, color: `hsl(${terminalTextColor})` }}
                  >
                    <div>[TX] AT+CGMR</div>
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

                <div className="flex flex-col gap-1.5">
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
                    <span className="font-medium text-foreground">{t("settings.aboutAppName")}</span>
                    <span className="text-muted-foreground">v{appVersion}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {t("settings.aboutDescription")}
                  </p>
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
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {t("settings.updateDownloading", { percent: updateState.percent })}
                      </span>
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${updateState.percent}%` }}
                        />
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
