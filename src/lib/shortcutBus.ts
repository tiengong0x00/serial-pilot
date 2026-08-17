/**
 * 快捷键事件总线
 *
 * 快捷键动作分散在多个组件（终端发送/清空、连接刷新等），
 * 用 window CustomEvent 解耦：useShortcuts 负责键盘 → 语义动作的转换并派发，
 * 各组件通过 onShortcut 订阅自己关心的动作。
 */

/** 所有可绑定快捷键的语义动作 */
export type ShortcutAction =
  | "send" // 发送数据
  | "clearLog" // 清空日志
  | "toggleFormat" // 切换显示格式（文本/HEX）
  | "refreshPorts" // 刷新串口列表
  | "openSettings"; // 打开设置

const EVENT_PREFIX = "sp:shortcut:";

/** 派发一个快捷键动作 */
export function emitShortcut(action: ShortcutAction): void {
  window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${action}`));
}

/** 订阅一个快捷键动作，返回取消订阅函数 */
export function onShortcut(action: ShortcutAction, handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener(`${EVENT_PREFIX}${action}`, listener);
  return () => window.removeEventListener(`${EVENT_PREFIX}${action}`, listener);
}

/** 快捷键定义：键位组合 → 动作 + 描述（描述用于设置面板展示） */
export interface ShortcutBinding {
  action: ShortcutAction;
  /** 展示用的键位文本，如 "Ctrl+Enter" */
  keys: string;
  /** i18n key，用于展示动作说明 */
  labelKey: string;
}

/** 全局快捷键绑定表 */
export const SHORTCUT_BINDINGS: ShortcutBinding[] = [
  { action: "send", keys: "Ctrl+Enter", labelKey: "shortcuts.send" },
  { action: "clearLog", keys: "Ctrl+L", labelKey: "shortcuts.clearLog" },
  { action: "toggleFormat", keys: "Ctrl+H", labelKey: "shortcuts.toggleFormat" },
  { action: "refreshPorts", keys: "Ctrl+R", labelKey: "shortcuts.refreshPorts" },
  { action: "openSettings", keys: "Ctrl+,", labelKey: "shortcuts.openSettings" },
];
