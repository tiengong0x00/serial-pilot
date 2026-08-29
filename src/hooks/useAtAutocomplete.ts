import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { type AtCommand } from "@/lib/atCommands";
import { useCommandLibrary } from "@/stores/commandLibraryStore";

/** 触发模式 */
export type TriggerMode = "at-prefix" | "always";

/**
 * AT 命令自动完成状态管理。
 *
 * 从命令库 store 模糊搜索匹配候选命令（命令/分类/描述多字段），维护键盘导航的选中索引。
 * 命令库运行时加载（.exe/../commands/*.json），查找为纯内存操作，零 IPC/零磁盘。
 *
 * @param input 当前输入值
 * @param triggerMode 触发模式：
 *   - "at-prefix"（默认）：仅输入以 "AT" 开头时匹配（发送框、命令内容框）
 *   - "always"：任意非空输入即匹配（URC pattern 框）
 */
export function useAtAutocomplete(input: string, triggerMode: TriggerMode = "at-prefix") {
  const [selectedIndex, setSelectedIndex] = useState(0);
  // 初始挂载若已有内容（如编辑已存在的命令），默认抑制面板，直到用户实际编辑后再启用；
  // 空输入（新建命令）则不抑制，用户输入即可触发。
  const [dismissed, setDismissed] = useState(() => input.trim().length > 0);
  // 记录抑制时对应的输入值：初始为挂载值，输入变化后重新启用
  const dismissedFor = useRef<string>(input);
  // 防抖后的查询词
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // 从 store 取匹配函数（内存数组模糊搜索）
  const match = useCommandLibrary((s) => s.match);
  const loaded = useCommandLibrary((s) => s.loaded);

  // 防抖：输入停顿 150ms 后才触发搜索
  useEffect(() => {
    const trimmed = input.trim();
    // 最小触发长度：≥2 字符（避免单字符返回海量结果）
    if (trimmed.length < 2) {
      setDebouncedQuery("");
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 150);

    return () => clearTimeout(timer);
  }, [input]);

  // 候选列表：模糊搜索（≥2 字符触发）
  const candidates = useMemo<AtCommand[]>(() => {
    if (debouncedQuery.length < 2) return [];
    return match(debouncedQuery);
    // loaded 作为依赖：命令库加载完成后重新计算候选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, triggerMode, match, loaded]);

  // 输入变化后，若与关闭时的值不同则重新启用
  if (dismissed && input !== dismissedFor.current) {
    setDismissed(false);
  }

  // 是否显示候选面板：有候选、未被关闭、且不是已完全匹配单个命令
  const isOpen = useMemo(() => {
    if (dismissed || candidates.length === 0) return false;
    // 输入已精确等于唯一候选时不再提示
    if (candidates.length === 1 && candidates[0].command.toUpperCase() === input.trim().toUpperCase()) {
      return false;
    }
    return true;
  }, [dismissed, candidates, input]);

  // 候选变化时重置选中项到顶部
  const candidatesKey = candidates.map((c) => c.command).join("|");
  const prevKey = useRef(candidatesKey);
  if (prevKey.current !== candidatesKey) {
    prevKey.current = candidatesKey;
    if (selectedIndex !== 0) setSelectedIndex(0);
  }

  const moveDown = useCallback(() => {
    setSelectedIndex((i) => (candidates.length === 0 ? 0 : (i + 1) % candidates.length));
  }, [candidates.length]);

  const moveUp = useCallback(() => {
    setSelectedIndex((i) => (candidates.length === 0 ? 0 : (i - 1 + candidates.length) % candidates.length));
  }, [candidates.length]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    dismissedFor.current = input;
  }, [input]);

  /** 获取当前选中的候选命令 */
  const getSelected = useCallback((): AtCommand | null => {
    return candidates[selectedIndex] ?? null;
  }, [candidates, selectedIndex]);

  return {
    candidates,
    selectedIndex,
    isOpen,
    moveDown,
    moveUp,
    dismiss,
    getSelected,
    setSelectedIndex,
  };
}
