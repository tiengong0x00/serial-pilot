import { useState, useCallback, useMemo, useRef } from "react";
import { useCommandLibrary, type TemplateCandidate } from "@/stores/commandLibraryStore";
import { longestCommonPrefix, getRemainingHint, stripOptionalBrackets } from "@/lib/commandTemplate";

/** 触发模式 */
export type TriggerMode = "at-prefix" | "always";

/** Tab 补全结果 */
export interface TabResult {
  /** 补全后的完整文本 */
  text: string;
  /** 若含占位符，第一个占位符的高亮区间（供 setSelectionRange） */
  highlight?: { start: number; end: number };
  /** 是否因歧义暂停（未补全，等待更多输入） */
  ambiguous?: boolean;
}

/**
 * AT 命令自动完成状态管理。
 *
 * 从命令库 store 模糊搜索匹配模板候选（cmd/desc/keywords/templates[].s），
 * 维护键盘导航选中索引，并提供 Tab 补全（公共前缀 + 歧义暂停 + 占位符高亮）
 * 与灰显「剩余期望」计算。
 */
export function useAtAutocomplete(input: string, triggerMode: TriggerMode = "at-prefix") {
  // -1 表示无任何候选被选中（默认态）：此时 Enter 发送输入原文，不补全。
  // 用户主动按 ↑/↓ 后才进入 >=0 的选中态。
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(() => input.trim().length > 0);
  const dismissedFor = useRef<string>(input);

  const matchTemplates = useCommandLibrary((s) => s.matchTemplates);
  const prefixTemplates = useCommandLibrary((s) => s.prefixTemplates);
  const loaded = useCommandLibrary((s) => s.loaded);

  // 实时匹配：每次输入即时计算候选，不做防抖（命令库在内存中，遍历开销很低）
  const query = input.trim();
  const candidates = useMemo<TemplateCandidate[]>(() => {
    if (query.length < 2) return [];
    return matchTemplates(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, triggerMode, matchTemplates, loaded]);

  // 输入变化后，若与关闭时的值不同则重新启用
  if (dismissed && input !== dismissedFor.current) {
    setDismissed(false);
  }

  // 是否显示候选面板：有候选、未关闭、且不是已精确等于唯一候选
  const isOpen = useMemo(() => {
    if (dismissed || candidates.length === 0) return false;
    if (candidates.length === 1 && candidates[0].s.toUpperCase() === input.trim().toUpperCase()) {
      return false;
    }
    return true;
  }, [dismissed, candidates, input]);

  // 候选变化时重置到无选中态（-1）：新候选默认不选中，Enter 仍发原文
  const candidatesKey = candidates.map((c) => c.s).join("|");
  const prevKey = useRef(candidatesKey);
  if (prevKey.current !== candidatesKey) {
    prevKey.current = candidatesKey;
    if (selectedIndex !== -1) setSelectedIndex(-1);
  }

  // ↓：无选中(-1)时进入首条(0)，否则循环下移
  const moveDown = useCallback(() => {
    setSelectedIndex((i) => (candidates.length === 0 ? -1 : (i + 1 + candidates.length) % candidates.length));
  }, [candidates.length]);

  // ↑：无选中(-1)时进入末条，否则循环上移
  const moveUp = useCallback(() => {
    setSelectedIndex((i) => {
      if (candidates.length === 0) return -1;
      if (i <= 0) return candidates.length - 1;
      return i - 1;
    });
  }, [candidates.length]);

  // 关闭候选面板。forValue：针对哪个输入值关闭（默认当前 input）。
  // 历史命令导航需传入即将切入的新值，否则下一帧 input 变化会触发
  // "重新启用"逻辑，导致刚关闭的面板又弹出。
  const dismiss = useCallback((forValue?: string) => {
    setDismissed(true);
    dismissedFor.current = forValue ?? input;
  }, [input]);

  /** 获取当前选中的模板候选 */
  const getSelected = useCallback((): TemplateCandidate | null => {
    return candidates[selectedIndex] ?? null;
  }, [candidates, selectedIndex]);

  /**
   * Tab 补全（功能2）：
   * 1. 取 s 以当前输入为前缀的所有模板，算最长公共前缀。
   * 2. 公共前缀 == 当前输入 → 歧义暂停（返回 ambiguous，不补全）。
   * 3. 否则补到公共前缀；若含 <占位符>，返回第一个占位符高亮区间。
   */
  const getTabCompletion = useCallback((): TabResult | null => {
    const cur = input;
    const trimmed = cur.trim();
    if (trimmed.length === 0) return null;

    const matches = prefixTemplates(trimmed);
    if (matches.length === 0) return null;

    const prefix = longestCommonPrefix(matches.map((m) => m.s));
    if (!prefix) return null;

    // 公共前缀不比当前输入长 → 有歧义（多分支且无更多公共部分），暂停
    if (prefix.toLowerCase() === trimmed.toLowerCase() && matches.length > 1) {
      return { text: cur, ambiguous: true };
    }
    // 唯一候选且已完全等于输入 → 无需补全
    if (matches.length === 1 && prefix.toLowerCase() === trimmed.toLowerCase()) {
      return null;
    }

    // 补到公共前缀；检测第一个占位符高亮
    const phStart = prefix.indexOf("<");
    if (phStart !== -1) {
      const phEnd = prefix.indexOf(">", phStart + 1);
      if (phEnd !== -1) {
        return { text: prefix, highlight: { start: phStart, end: phEnd + 1 } };
      }
    }
    return { text: prefix };
  }, [input, prefixTemplates]);

  /**
   * 灰显「剩余期望」（附加算法）：
   * 用当前选中候选（或唯一前缀候选）的模板做前缀通配符匹配，
   * 返回应在光标后灰显的剩余文本；无则返回 ""。
   */
  const ghostHint = useMemo<string>(() => {
    const trimmed = input.trim();
    if (trimmed.length < 2) return "";
    // 用当前选中候选（候选已是占位符感知排序，首项即最贴切）算剩余期望。
    // 选中项与输入冲突（hint 为 null）时，回退到第一个能给出合法灰显的候选。
    const sel = candidates[selectedIndex];
    if (sel) {
      const h = getRemainingHint(trimmed, stripOptionalBrackets(sel.s));
      if (h) return h;
    }
    for (const c of candidates) {
      const h = getRemainingHint(trimmed, stripOptionalBrackets(c.s));
      if (h) return h;
    }
    return "";
  }, [input, candidates, selectedIndex]);

  return {
    candidates,
    selectedIndex,
    isOpen,
    moveDown,
    moveUp,
    dismiss,
    getSelected,
    setSelectedIndex,
    getTabCompletion,
    ghostHint,
  };
}
