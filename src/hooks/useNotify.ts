import { useCallback } from "react";
import { toast } from "sonner";
import { useTerminalStore } from "@/stores/terminalStore";
import type { PortLabel } from "@/types/serial";

export type NotifyLevel = "info" | "success" | "warning" | "error";

interface NotifyOptions {
  /** 是否同时写入终端系统日志（默认 true） */
  log?: boolean;
  /** 关联端口标签（写入日志时使用） */
  portLabel?: PortLabel;
  /** Toast 是否弹出（默认 true） */
  toast?: boolean;
}

/**
 * 统一的通知 Hook
 *
 * 一次调用可同时：
 * 1. 弹出右上角 Toast（临时提示）
 * 2. 写入终端系统日志（SYS，持久显示于状态栏与日志对话框）
 *
 * 这样操作反馈既有即时可见的 Toast，又在系统日志中留痕可回溯。
 */
export function useNotify() {
  const addMessage = useTerminalStore((s) => s.addMessage);

  const notify = useCallback(
    (level: NotifyLevel, message: string, options: NotifyOptions = {}) => {
      const { log = true, portLabel, toast: showToast = true } = options;

      // 弹出 Toast
      if (showToast) {
        switch (level) {
          case "success":
            toast.success(message);
            break;
          case "warning":
            toast.warning(message);
            break;
          case "error":
            toast.error(message);
            break;
          default:
            toast.info(message);
        }
      }

      // 写入系统日志
      if (log) {
        addMessage({
          id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: "SYS",
          port_label: portLabel ?? "P1",
          data: new Uint8Array(),
          timestamp: Date.now(),
          text: message,
        });
      }
    },
    [addMessage]
  );

  return {
    notify,
    info: useCallback((msg: string, opts?: NotifyOptions) => notify("info", msg, opts), [notify]),
    success: useCallback((msg: string, opts?: NotifyOptions) => notify("success", msg, opts), [notify]),
    warning: useCallback((msg: string, opts?: NotifyOptions) => notify("warning", msg, opts), [notify]),
    error: useCallback((msg: string, opts?: NotifyOptions) => notify("error", msg, opts), [notify]),
  };
}
