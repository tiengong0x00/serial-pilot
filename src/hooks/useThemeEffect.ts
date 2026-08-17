import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * 主题副作用 Hook
 *
 * 统一处理：
 * 1. 主题模式（light/dark/system）→ 切换 <html> 的 .dark 类
 *    - system 模式跟随 OS 深浅色，并实时响应系统切换
 * 2. 终端背景色 → 覆盖 CSS 变量 --terminal-bg
 *
 * 挂载于 App 顶层，任意设置变更即时生效。
 */
export function useThemeEffect() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const terminalBgColor = useSettingsStore((s) => s.terminalBgColor);
  const terminalTextColor = useSettingsStore((s) => s.terminalTextColor);
  const terminalOpacity = useSettingsStore((s) => s.terminalOpacity);
  const backgroundImage = useSettingsStore((s) => s.backgroundImage);

  // 主题模式：切换 .dark 类
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const dark = themeMode === "dark" || (themeMode === "system" && mq.matches);
      root.classList.toggle("dark", dark);
    };

    apply();

    // 仅 system 模式需要监听系统变化
    if (themeMode === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [themeMode]);

  // 终端背景色：覆盖 CSS 变量，背景图模式下应用透明度
  useEffect(() => {
    const root = document.documentElement;
    if (terminalBgColor) {
      // 背景图激活时用 hsla 支持透明度，否则用 hsl 不透明
      if (backgroundImage) {
        const alpha = terminalOpacity / 100;
        root.style.setProperty("--terminal-bg", `${terminalBgColor} / ${alpha}`);
      } else {
        root.style.setProperty("--terminal-bg", terminalBgColor);
      }
    } else {
      root.style.removeProperty("--terminal-bg");
    }
  }, [terminalBgColor, terminalOpacity, backgroundImage]);

  // 终端文字色：覆盖 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    if (terminalTextColor) {
      root.style.setProperty("--terminal-text", terminalTextColor);
    } else {
      root.style.removeProperty("--terminal-text");
    }
  }, [terminalTextColor]);
}
