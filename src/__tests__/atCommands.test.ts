import { describe, it, expect } from "vitest";
import { AtCommandTrie, type AtCommand } from "@/lib/atCommands";

describe("AtCommandTrie 前缀匹配（运行时构建）", () => {
  const testCommands: AtCommand[] = [
    { command: 'AT', category: 'general', description: '测试通信' },
    { command: 'AT+CSQ', category: 'info', description: '查询信号' },
    { command: 'AT+CGREG', category: 'network', description: '查询GPRS注册' },
    { command: 'AT+CGMI', category: 'info', description: '查询制造商' },
  ];

  it("从传入命令数组构建 Trie", () => {
    const trie = new AtCommandTrie(testCommands);
    expect(trie).toBeDefined();
  });

  it("空前缀返回空数组", () => {
    const trie = new AtCommandTrie(testCommands);
    expect(trie.search("")).toEqual([]);
  });

  it("匹配 AT 前缀返回所有命令", () => {
    const trie = new AtCommandTrie(testCommands);
    const indices = trie.search("AT");
    expect(indices.length).toBe(4);
  });

  it("大小写不敏感", () => {
    const trie = new AtCommandTrie(testCommands);
    const upper = trie.search("AT+CSQ");
    const lower = trie.search("at+csq");
    expect(upper).toEqual(lower);
    expect(upper.length).toBeGreaterThan(0);
  });

  it("精确前缀缩小候选范围", () => {
    const trie = new AtCommandTrie(testCommands);
    const all = trie.search("AT");
    const cgm = trie.search("AT+C");
    expect(cgm.length).toBeLessThan(all.length);
    expect(cgm.length).toBe(3); // AT+CSQ, AT+CGREG, AT+CGMI
  });

  it("无匹配前缀返回空", () => {
    const trie = new AtCommandTrie(testCommands);
    expect(trie.search("XYZ")).toEqual([]);
  });

  it("match 方法返回命令对象", () => {
    const trie = new AtCommandTrie(testCommands);
    const results = trie.match("AT+CSQ");
    expect(results.length).toBe(1);
    expect(results[0].command).toBe("AT+CSQ");
    expect(results[0].description).toBe("查询信号");
  });

  it("match 限制候选数量", () => {
    const trie = new AtCommandTrie(testCommands);
    const results = trie.match("AT", 2);
    expect(results.length).toBe(2);
  });

  it("去除首尾空格后匹配", () => {
    const trie = new AtCommandTrie(testCommands);
    const results = trie.match("  AT+CSQ  ");
    expect(results.some((c) => c.command === "AT+CSQ")).toBe(true);
  });
});
