import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Language = 'zh-CN' | 'en-US';
type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsStore {
  // 通用设置
  language: Language;

  // 主题设置
  themeMode: ThemeMode;
  terminalBgColor: string; // HSL 格式：如 "0 0% 12%"
  terminalTextColor: string; // HSL 格式：如 "0 0% 88%"
  terminalOpacity: number; // 终端背景不透明度 0-100（背景图模式下生效）
  backgroundImage: string; // 背景图路径（空字符串表示无背景图）
  backgroundOpacity: number; // 背景图不透明度 0-100
  backgroundPositionX: number; // 背景图水平偏移百分比 -50~50（0 为居中）
  backgroundPositionY: number; // 背景图垂直偏移百分比 -50~50（0 为居中）
  backgroundScale: number; // 背景图缩放百分比 50~300（cover 模式下忽略）
  backgroundCover: boolean; // true=填满容器(CSS cover)，false=按 backgroundScale 百分比缩放
  backgroundMaxResolution: number; // 背景图压缩分辨率上限(宽度 px)，1920|2560|3840，超过按比例缩小
  backgroundQuality: number; // 背景图 JPEG 压缩质量 0.5~1.0（0.8 为平衡点）

  // 文件分包配置
  filePacketSize: number; // 单包字节数上限，0 表示不分包
  filePacketInterval: number; // 包间隔毫秒数

  // 接收组包配置
  serialFrameTimeout: number; // 字符间超时(ms)，相邻字节间隔超过该值视为一包结束

  // 终端显示配置
  terminalFontSize: number; // 字号（px），范围 10-20
  terminalLineHeight: number; // 行高（倍数），范围 1.0-2.0
  terminalMaxBytes: number; // 日志上限（字节），默认 1MB
  terminalLogPath: string; // 日志保存路径，超限时自动保存

  // 测试用例配置
  testCaseAutoSave: boolean; // 用例改动自动保存（默认 false）
  testCaseRowHeight: number; // 测试用例树形行高（px），范围 24-48，默认 28
  testCaseButtonWidth: number; // 运行按钮宽度（px），范围 24-80，默认 28
  testCaseButtonDisplay: 'hover' | 'always'; // 运行按钮显示方式，hover=悬浮显示，always=固定显示
  testCaseButtonContent: 'icon' | 'text' | 'auto'; // 运行按钮内容，icon=图标，text=文字，auto=根据宽度自动

  // 发送配置
  enterToSend: boolean; // 手动发送框：回车键是否直接发送（默认 true）

  // 终端时间戳显示（默认开启）
  showTimestamp: boolean;

  // 日志导出路径记忆
  lastExportDir?: string;

  // Actions
  setLanguage: (lang: Language) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setTerminalBgColor: (color: string) => void;
  setTerminalTextColor: (color: string) => void;
  setTerminalOpacity: (opacity: number) => void;
  setBackgroundImage: (path: string) => void;
  setBackgroundOpacity: (opacity: number) => void;
  setBackgroundPosition: (x: number, y: number) => void;
  setBackgroundScale: (scale: number) => void;
  setBackgroundCover: (enabled: boolean) => void;
  setBackgroundMaxResolution: (px: number) => void;
  setBackgroundQuality: (quality: number) => void;
  resetBackgroundTransform: () => void;
  setFilePacketSize: (size: number) => void;
  setFilePacketInterval: (interval: number) => void;
  setSerialFrameTimeout: (timeout: number) => void;
  setShowTimestamp: (show: boolean) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalLineHeight: (height: number) => void;
  setTerminalMaxBytes: (max: number) => void;
  setTerminalLogPath: (path: string) => void;
  setTestCaseAutoSave: (enabled: boolean) => void;
  setTestCaseRowHeight: (height: number) => void;
  setTestCaseButtonWidth: (width: number) => void;
  setTestCaseButtonDisplay: (mode: 'hover' | 'always') => void;
  setTestCaseButtonContent: (mode: 'icon' | 'text' | 'auto') => void;
  setEnterToSend: (enabled: boolean) => void;
  setLastExportDir: (dir: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // 通用默认值（对外发布默认英文，客户可自行切换中文）
      language: 'en-US',

      // 主题默认值
      themeMode: 'system',
      terminalBgColor: '0 0% 12%', // 默认深黑
      terminalTextColor: '0 0% 88%', // 默认浅色文字
      terminalOpacity: 80, // 终端背景默认不透明度 80%（背景图模式下微透）
      backgroundImage: '', // 默认无背景图
      backgroundOpacity: 15, // 默认不透明度 15%（淡背景，不干扰阅读）
      backgroundPositionX: 0, // 默认水平居中
      backgroundPositionY: 0, // 默认垂直居中
      backgroundScale: 100, // 默认 100% 缩放
      backgroundCover: true, // 默认填满容器
      backgroundMaxResolution: 1920, // 默认 1920px 宽度上限（1080p，稳妥）
      backgroundQuality: 0.8, // 默认质量 0.8（平衡清晰度与体积）

      // 默认值：每包 256 字节，包间隔 1ms
      filePacketSize: 256,
      filePacketInterval: 1,
      // 默认帧超时 20ms：串口逐字节回传时，静默超过 20ms 判定为一包
      serialFrameTimeout: 20,
      // 终端显示默认值
      terminalFontSize: 12,
      terminalLineHeight: 1.2, // 行距默认 1.2（更紧凑，显示更多日志）
      terminalMaxBytes: 1 * 1024 * 1024, // 1MB
      // 空字符串表示使用默认路径（软件执行路径下的 logs/）
      terminalLogPath: "",
      // 测试用例默认不自动保存
      testCaseAutoSave: false,
      testCaseRowHeight: 28, // 默认行高 28px（保持当前样式不变）
      testCaseButtonWidth: 28, // 默认按钮宽度 28px（小按钮，需用户主动调大）
      testCaseButtonDisplay: 'hover', // 默认悬浮显示（保持当前行为）
      testCaseButtonContent: 'auto', // 默认根据宽度自动判断（保持当前行为）
      // 手动发送框默认回车即发送
      enterToSend: true,
      // 终端时间戳默认显示
      showTimestamp: true,

      setLanguage: (lang) => set({ language: lang }),
      setThemeMode: (mode) => set({ themeMode: mode }),
      setTerminalBgColor: (color) => set({ terminalBgColor: color }),
      setTerminalTextColor: (color) => set({ terminalTextColor: color }),
      setTerminalOpacity: (opacity) => set({ terminalOpacity: opacity }),
      setBackgroundImage: (path) => set({ backgroundImage: path }),
      setBackgroundOpacity: (opacity) => set({ backgroundOpacity: opacity }),
      setBackgroundPosition: (x, y) => set({ backgroundPositionX: x, backgroundPositionY: y }),
      setBackgroundScale: (scale) => set({ backgroundScale: scale, backgroundCover: false }), // 手动缩放时退出 cover 模式
      setBackgroundCover: (enabled) => set({ backgroundCover: enabled }),
      setBackgroundMaxResolution: (px) => set({ backgroundMaxResolution: px }),
      setBackgroundQuality: (quality) => set({ backgroundQuality: quality }),
      resetBackgroundTransform: () => set({ backgroundPositionX: 0, backgroundPositionY: 0, backgroundScale: 100, backgroundCover: true }),
      setFilePacketSize: (size) => set({ filePacketSize: size }),
      setFilePacketInterval: (interval) => set({ filePacketInterval: interval }),
      setSerialFrameTimeout: (timeout) => set({ serialFrameTimeout: timeout }),
      setShowTimestamp: (show) => set({ showTimestamp: show }),
      setTerminalFontSize: (size) => set({ terminalFontSize: size }),
      setTerminalLineHeight: (height) => set({ terminalLineHeight: height }),
      setTerminalMaxBytes: (max) => set({ terminalMaxBytes: max }),
      setTerminalLogPath: (path) => set({ terminalLogPath: path }),
      setTestCaseAutoSave: (enabled) => set({ testCaseAutoSave: enabled }),
      setTestCaseRowHeight: (height) => set({ testCaseRowHeight: Math.max(24, Math.min(48, height)) }),
      setTestCaseButtonWidth: (width) => set({ testCaseButtonWidth: Math.max(24, Math.min(80, width)) }),
      setTestCaseButtonDisplay: (mode) => set({ testCaseButtonDisplay: mode }),
      setTestCaseButtonContent: (mode) => set({ testCaseButtonContent: mode }),
      setEnterToSend: (enabled) => set({ enterToSend: enabled }),
      setLastExportDir: (dir) => set({ lastExportDir: dir }),
    }),
    {
      name: 'serial-pilot-settings', // localStorage key
      // 自定义 storage，捕获 localStorage 异常（背景图 base64 过大导致超限）
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            return str ? JSON.parse(str) : null;
          } catch (err) {
            console.error('Failed to load settings from localStorage:', err);
            // 超限时清空配置，使用默认值
            localStorage.removeItem(name);
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch (err) {
            console.error('Failed to save settings to localStorage:', err);
            // QuotaExceededError：提示用户背景图过大
            if (err instanceof Error && err.name === 'QuotaExceededError') {
              console.warn('localStorage quota exceeded, likely due to large background image');
            }
          }
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);

// 终端整体配色预设（一键切换背景+文字）
export const TERMINAL_THEME_PRESETS = [
  { name: 'Classic Dark', bg: '0 0% 12%', text: '0 0% 88%' },
  { name: 'White Terminal', bg: '0 0% 98%', text: '0 0% 15%' },
  { name: 'Deep Blue', bg: '220 13% 18%', text: '120 60% 70%' },
] as const;

// 终端背景色预设（不带name，纯色块）
export const TERMINAL_BG_PRESETS = [
  '0 0% 12%',    // 深黑
  '220 13% 18%', // 深蓝
  '240 2% 20%',  // 暗灰
  '0 0% 8%',     // 炭黑
  '150 10% 15%', // 墨绿
] as const;

// 终端文字色预设
export const TERMINAL_TEXT_PRESETS = [
  '0 0% 88%',    // 浅白
  '0 0% 15%',    // 深黑（白色终端用）
  '120 60% 70%', // 浅绿
  '50 100% 70%', // 金黄
] as const;
