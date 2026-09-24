import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { validateDsl } from "../../../lib/dsl";

interface DslEditorProps {
  value: string;
  onChange: (text: string) => void;
}

/**
 * 轻量 DSL 编辑器：行号栏 + textarea（软换行），底部实时语法状态栏。
 * 用隐藏镜像层测量每个逻辑行的实际高度，使换行的续行不额外占用行号
 * （一个逻辑行始终只对应一个行号），且长行软换行、不横向滚动。
 * 校验只调用 validateDsl（包一层 compileDsl），不引入重型编辑器。
 */
export const DslEditor = ({ value, onChange }: DslEditorProps) => {
  const { t } = useTranslation();
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const lines = useMemo(() => value.split("\n"), [value]);
  const validation = useMemo(() => validateDsl(value), [value]);
  const errLine = validation.ok ? undefined : validation.line;

  // 镜像层与编辑区同宽（clientWidth 已扣除滚动条），测量每逻辑行换行后的高度
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    const ta = taRef.current;
    if (!mirror || !ta) return;
    const measure = () => {
      mirror.style.width = ta.clientWidth + "px";
      const hs = Array.from(mirror.children).map((c) => (c as HTMLElement).offsetHeight);
      setLineHeights(hs);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [value]);

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1">
      <div className="relative flex flex-1 min-h-0 rounded-md border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary">
        {/* 行号栏：每个逻辑行按测量高度占位 */}
        <div
          ref={gutterRef}
          className="h-full shrink-0 select-none overflow-hidden bg-muted/40 text-right text-xs font-mono text-muted-foreground py-2 pl-2 pr-2 leading-5"
          style={{ scrollbarWidth: "none" }}
        >
          {lines.map((_, i) => {
            const ln = i + 1;
            const isErr = errLine === ln;
            return (
              <div
                key={ln}
                className={isErr ? "text-destructive font-bold" : ""}
                style={{ height: lineHeights[i] ?? 20 }}
              >
                {ln}
              </div>
            );
          })}
        </div>
        {/* 编辑区：软换行，长行不横向滚动 */}
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          className="flex-1 h-full px-3 py-2 text-xs bg-background font-mono leading-5 resize-none overflow-y-auto overflow-x-hidden break-words focus:outline-none"
        />
        {/* 隐藏镜像层：与编辑区同宽同字体同 padding，用于测量各逻辑行换行后的高度 */}
        <div
          ref={mirrorRef}
          aria-hidden
          className="absolute top-0 left-0 pointer-events-none invisible px-3 py-2 text-xs font-mono leading-5 whitespace-pre-wrap break-words"
        >
          {lines.map((line, i) => (
            <div key={i}>{line === "" ? "​" : line}</div>
          ))}
        </div>
      </div>
      {/* 实时语法状态（细行，贴编辑框下方） */}
      <div className="text-[11px] leading-none font-mono shrink-0">
        {validation.ok ? (
          <span className="text-green-600 dark:text-green-500">✓ {t("toolbox.protoSyntaxOk")}</span>
        ) : validation.line != null ? (
          <span className="text-destructive">
            ✗ {t("toolbox.protoSyntaxErrLine", { line: validation.line, msg: validation.message })}
          </span>
        ) : (
          <span className="text-destructive">
            ✗ {t("toolbox.protoSyntaxErr", { msg: validation.message })}
          </span>
        )}
      </div>
    </div>
  );
};
