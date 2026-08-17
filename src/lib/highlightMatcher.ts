import type { HighlightRule, HighlightMatch } from '../types/terminal';

/**
 * 正则表达式缓存，避免重复编译
 */
const regexCache = new Map<string, RegExp | null>();

/**
 * 获取或编译正则表达式
 */
function getRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) {
    return regexCache.get(pattern)!;
  }

  try {
    const regex = new RegExp(pattern, 'g');
    regexCache.set(pattern, regex);
    return regex;
  } catch {
    // 非法正则表达式，缓存 null
    regexCache.set(pattern, null);
    return null;
  }
}

/**
 * 清除正则缓存（规则变更时调用）
 */
export function clearRegexCache(): void {
  regexCache.clear();
}

/**
 * 在文本中查找所有匹配项
 */
export function findMatches(text: string, rules: HighlightRule[]): HighlightMatch[] {
  const matches: HighlightMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) {
      continue;
    }

    if (rule.matchType === 'text') {
      // 固定文本匹配
      const searchText = rule.caseSensitive ? text : text.toLowerCase();
      const searchPattern = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();

      let startIndex = 0;
      while (true) {
        const index = searchText.indexOf(searchPattern, startIndex);
        if (index === -1) break;

        matches.push({
          start: index,
          end: index + rule.pattern.length,
          rule,
        });

        startIndex = index + rule.pattern.length;
      }
    } else {
      // 正则表达式匹配
      const regex = getRegex(rule.pattern);
      if (!regex) continue;

      // 重置 lastIndex，确保从头开始匹配
      regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          rule,
        });

        // 防止零宽度匹配导致无限循环
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }
  }

  // 按起始位置排序，位置相同时按规则顺序（先匹配的优先）
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // 规则顺序已在遍历时保证，这里保持稳定排序
    return 0;
  });

  // 合并重叠区域：优先级高的（先匹配的）覆盖后面的
  const merged: HighlightMatch[] = [];
  for (const match of matches) {
    if (merged.length === 0) {
      merged.push(match);
      continue;
    }

    const last = merged[merged.length - 1];
    // 如果当前匹配完全在上一个匹配的范围内或之前，跳过
    if (match.end <= last.end) {
      continue;
    }

    // 如果有部分重叠，截断当前匹配
    if (match.start < last.end) {
      merged.push({
        ...match,
        start: last.end,
      });
    } else {
      // 无重叠，直接添加
      merged.push(match);
    }
  }

  return merged;
}

/**
 * 将文本和匹配结果转换为渲染片段
 */
export interface TextSegment {
  text: string;
  highlight?: HighlightRule;
}

export function segmentText(text: string, matches: HighlightMatch[]): TextSegment[] {
  if (matches.length === 0) {
    return [{ text }];
  }

  const segments: TextSegment[] = [];
  let lastEnd = 0;

  for (const match of matches) {
    // 添加匹配前的普通文本
    if (match.start > lastEnd) {
      segments.push({ text: text.slice(lastEnd, match.start) });
    }

    // 添加高亮文本
    segments.push({
      text: text.slice(match.start, match.end),
      highlight: match.rule,
    });

    lastEnd = match.end;
  }

  // 添加最后一段普通文本
  if (lastEnd < text.length) {
    segments.push({ text: text.slice(lastEnd) });
  }

  return segments;
}
