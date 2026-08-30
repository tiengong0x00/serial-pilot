import { useMemo } from "react";
import { diffLines, diffChars } from "diff";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TerminalMessage } from "@/types/serial";

interface DiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  p1Messages: TerminalMessage[];
  p2Messages: TerminalMessage[];
}

/**
 * 将消息数组转为纯数据文本（剔除时间戳、TX/RX 标记）
 */
function messagesToPlainText(messages: TerminalMessage[]): string {
  return messages
    .map((msg) => {
      // 优先用 text 字段，没有则尝试 UTF-8 解码 data
      if (msg.text) return msg.text;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(msg.data);
      } catch {
        // 解码失败则转 hex
        return Array.from(msg.data)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
      }
    })
    .join("\n");
}

/**
 * 拆分 diff part 的文本为行数组，去掉因结尾换行符产生的空尾元素
 */
function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * 行级 diff + 行内字符高亮的渲染组件
 */
function DiffView({ p1Text, p2Text }: { p1Text: string; p2Text: string }) {
  const rows = useMemo(() => {
    const lineDiff = diffLines(p1Text, p2Text);
    const result: Array<{ left: JSX.Element | null; right: JSX.Element | null }> = [];

    let i = 0;
    while (i < lineDiff.length) {
      const part = lineDiff[i];

      if (!part.added && !part.removed) {
        // 公共行：左右都显示
        const lines = splitLines(part.value);
        lines.forEach((line) => {
          const elem = <div className="whitespace-pre-wrap break-all px-2 py-0.5">{line || " "}</div>;
          result.push({ left: elem, right: elem });
        });
        i++;
      } else if (part.removed && i + 1 < lineDiff.length && lineDiff[i + 1].added) {
        // 配对的删除+新增 → 修改行，做行内字符高亮
        const removedLines = splitLines(part.value);
        const addedLines = splitLines(lineDiff[i + 1].value);
        const maxLen = Math.max(removedLines.length, addedLines.length);

        for (let j = 0; j < maxLen; j++) {
          const leftLine = removedLines[j] ?? "";
          const rightLine = addedLines[j] ?? "";

          if (leftLine && rightLine) {
            // 两行都存在，做字符级 diff
            const charDiff = diffChars(leftLine, rightLine);
            const leftElem = (
              <div className="bg-red-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                {charDiff.map((c, idx) =>
                  c.removed ? (
                    <span key={idx} className="bg-red-500/50">
                      {c.value}
                    </span>
                  ) : c.added ? null : (
                    <span key={idx}>{c.value}</span>
                  )
                )}
              </div>
            );
            const rightElem = (
              <div className="bg-green-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                {charDiff.map((c, idx) =>
                  c.added ? (
                    <span key={idx} className="bg-green-500/50">
                      {c.value}
                    </span>
                  ) : c.removed ? null : (
                    <span key={idx}>{c.value}</span>
                  )
                )}
              </div>
            );
            result.push({ left: leftElem, right: rightElem });
          } else if (leftLine) {
            // 只有左侧
            result.push({
              left: <div className="bg-red-500/20 whitespace-pre-wrap break-all px-2 py-0.5">{leftLine}</div>,
              right: null,
            });
          } else {
            // 只有右侧
            result.push({
              left: null,
              right: <div className="bg-green-500/20 whitespace-pre-wrap break-all px-2 py-0.5">{rightLine}</div>,
            });
          }
        }
        i += 2; // 跳过配对的两个 part
      } else if (part.removed) {
        // 单独删除（无配对新增）
        const lines = splitLines(part.value);
        lines.forEach((line) => {
          result.push({
            left: <div className="bg-red-500/20 whitespace-pre-wrap break-all px-2 py-0.5">{line || " "}</div>,
            right: null,
          });
        });
        i++;
      } else {
        // 单独新增（无配对删除）
        const lines = splitLines(part.value);
        lines.forEach((line) => {
          result.push({
            left: null,
            right: <div className="bg-green-500/20 whitespace-pre-wrap break-all px-2 py-0.5">{line || " "}</div>,
          });
        });
        i++;
      }
    }

    return result;
  }, [p1Text, p2Text]);

  return (
    <div className="flex flex-1 min-h-0 divide-x divide-border">
      {/* P1 左侧 */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {rows.map((row, idx) => (
          <div key={idx}>{row.left || <div className="px-2 py-0.5 text-muted-foreground/30">—</div>}</div>
        ))}
      </div>

      {/* P2 右侧 */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {rows.map((row, idx) => (
          <div key={idx}>{row.right || <div className="px-2 py-0.5 text-muted-foreground/30">—</div>}</div>
        ))}
      </div>
    </div>
  );
}

export function DiffDialog({
  open,
  onOpenChange,
  p1Messages,
  p2Messages,
}: DiffDialogProps) {
  const { t } = useTranslation();

  const p1Text = useMemo(() => messagesToPlainText(p1Messages), [p1Messages]);
  const p2Text = useMemo(() => messagesToPlainText(p2Messages), [p2Messages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle>{t("diff.title")}</DialogTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("diff.hint")}
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* 左右标题 */}
          <div className="flex divide-x divide-border border-b text-xs font-medium bg-muted/30">
            <div className="flex-1 px-3 py-2 text-blue-600">P1</div>
            <div className="flex-1 px-3 py-2 text-orange-600">P2</div>
          </div>

          {/* 对比视图 */}
          <DiffView p1Text={p1Text} p2Text={p2Text} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
