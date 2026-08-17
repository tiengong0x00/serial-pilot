import { invoke } from "@tauri-apps/api/core";
import type { TerminalMessage } from "@/types/serial";

/** 格式化时间戳为 HH:mm:ss.SSS */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

/** 把一条消息的数据解码为可读文本 */
function decodeContent(msg: TerminalMessage): string {
  if (msg.text !== undefined) return msg.text;
  if (msg.data && msg.data.length > 0) {
    try {
      return new TextDecoder("utf-8").decode(msg.data);
    } catch {
      // 解码失败时回退为十六进制
      return Array.from(msg.data)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
    }
  }
  return "";
}

/**
 * 将消息列表格式化为纯文本日志
 *
 * 格式：[HH:mm:ss.SSS] [端口] [类型] 内容
 * 例如：[14:30:18.466] [P1] [TX] AT+CGMR
 *
 * @param messages 消息列表
 * @param includePortLabel 是否包含端口标识（分栏单端口导出时可省略）
 */
export function formatMessagesToText(
  messages: TerminalMessage[],
  includePortLabel = true
): string {
  return messages
    .map((msg) => {
      const time = formatTime(msg.timestamp);
      const port = includePortLabel ? `[${msg.port_label}] ` : "";
      const content = decodeContent(msg);
      return `[${time}] ${port}[${msg.type}] ${content}`;
    })
    .join("\n");
}

/** 生成带时间戳的日志文件名，例如 serial-log-20260812-143022.txt */
export function generateLogFilename(suffix?: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const suffixPart = suffix ? `-${suffix}` : "";
  return `serial-log-${stamp}${suffixPart}.txt`;
}

/** 触发浏览器下载文本文件 */
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 保存日志到文件系统（软件执行路径下的 logs/ 目录）
 *
 * @param content 日志内容
 * @param filename 文件名（只需文件名，不含路径）
 * @returns 保存的完整路径
 */
export async function saveLogToFile(content: string, filename: string): Promise<string> {
  return await invoke<string>("save_log_file", { filename, content });
}
