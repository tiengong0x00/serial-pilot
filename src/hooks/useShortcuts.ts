import { useEffect } from "react";
import { emitShortcut, onShortcut, type ShortcutAction } from "@/lib/shortcutBus";

/**
 * 全局快捷键监听（挂载一次即可，通常在根页面）。
 *
 * 负责捕获键盘组合键并转换为语义动作，通过事件总线派发。
 * 具体动作由各组件用 useShortcutAction 订阅。
 *
 * 支持的快捷键：
 * - Ctrl+Enter：发送数据
 * - Ctrl+L：清空日志
 * - Ctrl+H：切换显示格式
 * - Ctrl+R：刷新串口
 * - Ctrl+,：打开设置
 */
export function useShortcuts(handlers?: { onOpenSettings?: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 仅处理 Ctrl（或 Mac 上的 Cmd）组合键
      if (!e.ctrlKey && !e.metaKey) return;

      // 判断焦点是否在输入框内：部分快捷键仍需生效（如 Ctrl+Enter 发送）
      const key = e.key.toLowerCase();

      switch (key) {
        case "enter":
          e.preventDefault();
          emitShortcut("send");
          break;
        case "l":
          e.preventDefault();
          emitShortcut("clearLog");
          break;
        case "h":
          e.preventDefault();
          emitShortcut("toggleFormat");
          break;
        case "r":
          e.preventDefault();
          emitShortcut("refreshPorts");
          break;
        case ",":
          e.preventDefault();
          emitShortcut("openSettings");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // openSettings 由根页面直接处理（需要访问 setSettingsOpen）
  useEffect(() => {
    if (!handlers?.onOpenSettings) return;
    return onShortcut("openSettings", handlers.onOpenSettings);
  }, [handlers?.onOpenSettings]);
}

/**
 * 订阅单个快捷键动作（组件内使用）。
 * @param action 要监听的动作
 * @param handler 触发时的回调（用 ref 或稳定引用避免频繁重订阅）
 */
export function useShortcutAction(action: ShortcutAction, handler: () => void) {
  useEffect(() => {
    return onShortcut(action, handler);
  }, [action, handler]);
}
