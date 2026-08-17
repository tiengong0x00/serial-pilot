import { describe, it, expect, beforeEach } from "vitest";
import { findMatches, segmentText, clearRegexCache } from "@/lib/highlightMatcher";
import type { HighlightRule } from "@/types/terminal";

function makeRule(overrides: Partial<HighlightRule>): HighlightRule {
  return {
    id: Math.random().toString(36),
    enabled: true,
    name: "test",
    matchType: "text",
    pattern: "",
    style: {},
    ...overrides,
  };
}

describe("highlightMatcher - findMatches", () => {
  beforeEach(() => clearRegexCache());

  it("固定文本匹配：找到所有出现位置", () => {
    const rules = [makeRule({ matchType: "text", pattern: "ERROR" })];
    const matches = findMatches("ERROR foo ERROR bar", rules);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ start: 0, end: 5 });
    expect(matches[1]).toMatchObject({ start: 10, end: 15 });
  });

  it("固定文本匹配：默认大小写不敏感", () => {
    const rules = [makeRule({ matchType: "text", pattern: "error" })];
    const matches = findMatches("ERROR", rules);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ start: 0, end: 5 });
  });

  it("固定文本匹配：区分大小写时不命中", () => {
    const rules = [makeRule({ matchType: "text", pattern: "error", caseSensitive: true })];
    const matches = findMatches("ERROR", rules);
    expect(matches).toHaveLength(0);
  });

  it("正则匹配：命中所有分组", () => {
    const rules = [makeRule({ matchType: "regex", pattern: "\\d+" })];
    const matches = findMatches("abc 123 def 456", rules);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ start: 4, end: 7 });
    expect(matches[1]).toMatchObject({ start: 12, end: 15 });
  });

  it("正则匹配：非法正则被忽略", () => {
    const rules = [makeRule({ matchType: "regex", pattern: "[invalid(" })];
    const matches = findMatches("test", rules);
    expect(matches).toHaveLength(0);
  });

  it("禁用规则不参与匹配", () => {
    const rules = [makeRule({ matchType: "text", pattern: "ERROR", enabled: false })];
    const matches = findMatches("ERROR", rules);
    expect(matches).toHaveLength(0);
  });

  it("空 pattern 不参与匹配", () => {
    const rules = [makeRule({ matchType: "text", pattern: "" })];
    const matches = findMatches("ERROR", rules);
    expect(matches).toHaveLength(0);
  });

  it("重叠区域：先匹配的规则优先，后者截断", () => {
    const rules = [
      makeRule({ matchType: "text", pattern: "ERROR", caseSensitive: true }),
      makeRule({ matchType: "text", pattern: "ROR", caseSensitive: true }),
    ];
    const matches = findMatches("ERROR", rules);
    // ERROR(0-5) 优先，ROR(2-5) 完全被覆盖，跳过
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ start: 0, end: 5 });
  });

  it("零宽度正则不导致无限循环", () => {
    const rules = [makeRule({ matchType: "regex", pattern: "a*" })];
    const matches = findMatches("aaa", rules);
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe("highlightMatcher - segmentText", () => {
  it("无匹配返回单个纯文本片段", () => {
    const segments = segmentText("hello world", []);
    expect(segments).toEqual([{ text: "hello world" }]);
  });

  it("正确切分匹配和非匹配片段", () => {
    const rule = makeRule({ matchType: "text", pattern: "world", caseSensitive: true });
    const matches = findMatches("hello world!", [rule]);
    const segments = segmentText("hello world!", matches);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ text: "hello " });
    expect(segments[1].text).toBe("world");
    expect(segments[1].highlight).toBeDefined();
    expect(segments[2]).toEqual({ text: "!" });
  });

  it("匹配在开头时无前置片段", () => {
    const rule = makeRule({ matchType: "text", pattern: "hello", caseSensitive: true });
    const matches = findMatches("hello world", [rule]);
    const segments = segmentText("hello world", matches);
    expect(segments[0].text).toBe("hello");
    expect(segments[0].highlight).toBeDefined();
  });
});
