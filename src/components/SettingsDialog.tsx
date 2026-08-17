import { useState } from "react";
import { useTranslation } from "react-i18next";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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

  const handleCheckUpdate = async () => {
    setUpdateState({ status: 'checking' });
    try {
      const update = await check();

      if (update?.available) {
        setUpdateState({
          status: 'available',
          version: update.version,
          body: update.body,
          download: async () => {
            setUpdateState({ status: 'downloading', percent: 0 });
            let total = 0;
            let downloaded = 0;
            await update.downloadAndInstall((event) => {
              if (event.event === 'Started') {
                total = event.data.contentLength ?? 0;
                setUpdateState({ status: 'downloading', percent: 0 });
              } else if (event.event === 'Progress') {
                downloaded += event.data.chunkLength;
                const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
                setUpdateState({ status: 'downloading', percent });
              } else if (event.event === 'Finished') {
                setUpdateState({ status: 'ready', relaunch: () => { void relaunch(); } });
              }
            });
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
    filePacketSize,
    filePacketInterval,
    serialFrameTimeout,
    terminalFontSize,
    terminalLineHeight,
    terminalMaxMessages,
    terminalLogPath,
    testCaseAutoSave,
    setLanguage,
    setThemeMode,
    setTerminalBgColor,
    setTerminalTextColor,
    setTerminalOpacity,
    setBackgroundImage,
    setBackgroundOpacity,
    setFilePacketSize,
    setFilePacketInterval,
    setSerialFrameTimeout,
    setTerminalFontSize,
    setTerminalLineHeight,
    setTerminalMaxMessages,
    setTerminalLogPath,
    setTestCaseAutoSave,
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
                      {/* 背景图预览 */}
                      <div
                        className="w-full h-32 rounded-md border border-border bg-cover bg-center"
                        style={{ backgroundImage: `url(${backgroundImage})` }}
                      />

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
                        onClick={() => setBackgroundImage('')}
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

                            // 压缩图片以避免 localStorage 超限
                            const img = new Image();
                            img.onload = () => {
                              // 计算缩放比例，最大宽度 1920px
                              const maxWidth = 1920;
                              const maxHeight = 1080;
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
                                // 输出 JPEG 格式，质量 0.8（平衡质量和大小）
                                const compressed = canvas.toDataURL('image/jpeg', 0.8);
                                setBackgroundImage(compressed);
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
                  <label className="text-sm font-medium">{t("settings.terminalMaxMessages")}</label>
                  <input
                    type="number"
                    min={100}
                    max={50000}
                    step={100}
                    className="h-9 px-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    value={terminalMaxMessages}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 10000;
                      setTerminalMaxMessages(Math.max(100, Math.min(50000, val)));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t("settings.terminalMaxMessagesHint")}</p>
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
                    <span className="text-muted-foreground">v0.1.0</span>
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
