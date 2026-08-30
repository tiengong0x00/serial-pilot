import { useMemo, useState } from "react";
import { diffLines, diffChars } from "diff";
import { useTranslation } from "react-i18next";
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
interface DiffLine {
  text: string; // 行内容（可能含残留的 \r）
  nl: boolean; // 该行原本是否以 \n 结尾
}

function splitLines(value: string): DiffLine[] {
  const parts = value.split("\n");
  // split("\n") 后，除最后一段外每段都对应一个以 \n 结尾的行
  const endsWithNl = parts.length > 0 && parts[parts.length - 1] === "";
  if (endsWithNl) parts.pop();
  return parts.map((text, idx) => ({
    text,
    // 非最后一段必有 \n；最后一段仅当原串以 \n 结尾时才有
    nl: idx < parts.length - 1 || endsWithNl,
  }));
}

/**
 * 将不可见字符替换为可见符号（VS Code 风格 Unicode Control Pictures）
 * 仅处理行内字符：\r → ␍，空格 → ·，\t → →
 * （\n 已被分行消费，由行尾的 nl 标记单独渲染 ␊）
 */
function visualize(text: string, show: boolean): string {
  if (!show) return text;
  return text
    .replace(/\r/g, "␍")
    .replace(/\t/g, "→")
    .replace(/ /g, "·");
}

const NL_SYMBOL = "␊"; // U+240A，行尾换行标记

/**
 * 行级 diff + 行内字符高亮的渲染组件
 */
function DiffView({ p1Text, p2Text, showWhitespace }: { p1Text: string; p2Text: string; showWhitespace: boolean }) {
  const rows = useMemo(() => {
    const lineDiff = diffLines(p1Text, p2Text);
    const result: Array<{ left: JSX.Element | null; right: JSX.Element | null }> = [];

    // 行尾换行标记（淡色，可视化开启时显示）
    const nlMark = (nl: boolean) =>
      showWhitespace && nl ? <span className="text-muted-foreground/40">{NL_SYMBOL}</span> : null;

    let i = 0;
    while (i < lineDiff.length) {
      const part = lineDiff[i];

      if (!part.added && !part.removed) {
        // 公共行：左右都显示
        const lines = splitLines(part.value);
        lines.forEach((line) => {
          const elem = (
            <div className="whitespace-pre-wrap break-all px-2 py-0.5">
              {visualize(line.text, showWhitespace) || " "}
              {nlMark(line.nl)}
            </div>
          );
          result.push({ left: elem, right: elem });
        });
        i++;
      } else if (part.removed && i + 1 < lineDiff.length && lineDiff[i + 1].added) {
        // 配对的删除+新增 → 修改行，做行内字符高亮
        const removedLines = splitLines(part.value);
        const addedLines = splitLines(lineDiff[i + 1].value);
        const maxLen = Math.max(removedLines.length, addedLines.length);

        for (let j = 0; j < maxLen; j++) {
          const leftLine = removedLines[j] ?? null;
          const rightLine = addedLines[j] ?? null;

          if (leftLine && rightLine) {
            // 两行都存在，做字符级 diff（在原始文本上算，渲染时可视化）
            const charDiff = diffChars(leftLine.text, rightLine.text);
            const leftElem = (
              <div className="bg-red-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                {charDiff.map((c, idx) =>
                  c.removed ? (
                    <span key={idx} className="bg-red-500/50">
                      {visualize(c.value, showWhitespace)}
                    </span>
                  ) : c.added ? null : (
                    <span key={idx}>{visualize(c.value, showWhitespace)}</span>
                  )
                )}
                {nlMark(leftLine.nl)}
              </div>
            );
            const rightElem = (
              <div className="bg-green-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                {charDiff.map((c, idx) =>
                  c.added ? (
                    <span key={idx} className="bg-green-500/50">
                      {visualize(c.value, showWhitespace)}
                    </span>
                  ) : c.removed ? null : (
                    <span key={idx}>{visualize(c.value, showWhitespace)}</span>
                  )
                )}
                {nlMark(rightLine.nl)}
              </div>
            );
            result.push({ left: leftElem, right: rightElem });
          } else if (leftLine) {
            // 只有左侧
            result.push({
              left: (
                <div className="bg-red-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                  {visualize(leftLine.text, showWhitespace) || " "}
                  {nlMark(leftLine.nl)}
                </div>
              ),
              right: null,
            });
          } else if (rightLine) {
            // 只有右侧
            result.push({
              left: null,
              right: (
                <div className="bg-green-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                  {visualize(rightLine.text, showWhitespace) || " "}
                  {nlMark(rightLine.nl)}
                </div>
              ),
            });
          }
        }
        i += 2; // 跳过配对的两个 part
      } else if (part.removed) {
        // 单独删除（无配对新增）
        const lines = splitLines(part.value);
        lines.forEach((line) => {
          result.push({
            left: (
              <div className="bg-red-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                {visualize(line.text, showWhitespace) || " "}
                {nlMark(line.nl)}
              </div>
            ),
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
            right: (
              <div className="bg-green-500/20 whitespace-pre-wrap break-all px-2 py-0.5">
                {visualize(line.text, showWhitespace) || " "}
                {nlMark(line.nl)}
              </div>
            ),
          });
        });
        i++;
      }
    }

    return result;
  }, [p1Text, p2Text, showWhitespace]);

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
  const [showWhitespace, setShowWhitespace] = useState(false);

  const p1Text = useMemo(() => messagesToPlainText(p1Messages), [p1Messages]);
  const p2Text = useMemo(() => messagesToPlainText(p2Messages), [p2Messages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle>{t("diff.title")}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t("diff.hint")}
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* 左右标题 + 可视化开关 */}
          <div className="flex divide-x divide-border border-b text-xs font-medium bg-muted/30">
            <div className="flex-1 px-3 py-2 text-blue-600">P1</div>
            <div className="flex-1 px-3 py-2 text-orange-600 flex items-center justify-between">
              <span>P2</span>
              <label className="flex items-center gap-1.5 text-xs font-normal text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={showWhitespace}
                  onChange={(e) => setShowWhitespace(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span className="select-none">显示空白符</span>
              </label>
            </div>
          </div>

          {/* 对比视图 */}
          <DiffView p1Text={p1Text} p2Text={p2Text} showWhitespace={showWhitespace} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
