import { useMemo } from "react";
import type { HighlightRule } from "@/types/terminal";
import { findMatches, segmentText } from "@/lib/highlightMatcher";

/**
 * 高亮文本渲染组件
 *
 * 根据传入的高亮规则，将文本切分为片段并对匹配部分应用样式。
 * 无匹配时直接渲染纯文本，避免额外开销。
 */
export function HighlightedText({
  text,
  rules,
  className,
}: {
  text: string;
  rules: HighlightRule[];
  className?: string;
}) {
  const segments = useMemo(() => {
    // 无启用规则时快速返回
    const activeRules = rules.filter((r) => r.enabled && r.pattern);
    if (activeRules.length === 0) {
      return null;
    }
    const matches = findMatches(text, activeRules);
    if (matches.length === 0) {
      return null;
    }
    return segmentText(text, matches);
  }, [text, rules]);

  // 无高亮命中：直接渲染纯文本
  if (!segments) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (!seg.highlight) {
          return <span key={i}>{seg.text}</span>;
        }
        const { style } = seg.highlight;
        return (
          <span
            key={i}
            style={{
              color: style.color || undefined,
              backgroundColor: style.backgroundColor || undefined,
              fontWeight: style.fontWeight === "bold" ? "bold" : undefined,
              fontStyle: style.fontStyle === "italic" ? "italic" : undefined,
            }}
          >
            {seg.text}
          </span>
        );
      })}
    </span>
  );
}
