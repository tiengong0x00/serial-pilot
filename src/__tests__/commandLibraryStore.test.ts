import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandLibrary } from '@/stores/commandLibraryStore';
import type { AtCommand } from '@/lib/atCommands';

/** 直接向 store 注入命令，绕过 Tauri invoke，测试纯匹配逻辑 */
function seed(commands: AtCommand[]) {
  useCommandLibrary.setState({ commands, loaded: true, error: null });
}

const CGDCONT: AtCommand = {
  cmd: 'AT+CGDCONT',
  desc: '定义PDP上下文(APN等)',
  keywords: ['PDP', 'APN', '上下文'],
  templates: [
    { s: 'AT+CGDCONT?', d: '读取' },
    { s: 'AT+CGDCONT=?', d: '测试' },
    { s: 'AT+CGDCONT=<cid>[,<PDP_type>[,<APN>[,<PDP_addr>[,<d_comp>[,<h_comp>]]]]]', d: '设置' },
    { s: 'AT+CGDCONT=1,"IP","cmnet"', d: '示例' },
    { s: 'AT+CGDCONT=1,"IPV6","cmnet"', d: '示例' },
  ],
};

const CEREG: AtCommand = {
  cmd: 'AT+CEREG',
  desc: 'EPS网络注册状态',
  keywords: ['注册', '网络', 'EPS'],
  templates: [
    { s: 'AT+CEREG?', d: '读取' },
    { s: 'AT+CEREG=<n>', d: '设置' },
  ],
};

describe('commandLibraryStore.matchTemplates（占位符感知）', () => {
  beforeEach(() => seed([CGDCONT, CEREG]));

  it('问题1/4：输入 AT+CGDCONT=1 同时返回占位符分支与具体示例', () => {
    const res = useCommandLibrary.getState().matchTemplates('AT+CGDCONT=1');
    const sList = res.map((r) => r.s);
    // 含占位符分支
    expect(sList.some((s) => s.startsWith('AT+CGDCONT=<cid>'))).toBe(true);
    // 含具体示例
    expect(sList).toContain('AT+CGDCONT=1,"IP","cmnet"');
    // 冲突项 =? / ? 被排除
    expect(sList).not.toContain('AT+CGDCONT=?');
    expect(sList).not.toContain('AT+CGDCONT?');
  });

  it('问题4：具体示例（字面前缀命中）排在占位符分支之前', () => {
    const res = useCommandLibrary.getState().matchTemplates('AT+CGDCONT=1');
    const exampleIdx = res.findIndex((r) => r.s === 'AT+CGDCONT=1,"IP","cmnet"');
    const branchIdx = res.findIndex((r) => r.s.startsWith('AT+CGDCONT=<cid>'));
    expect(exampleIdx).toBeGreaterThanOrEqual(0);
    expect(branchIdx).toBeGreaterThanOrEqual(0);
    expect(exampleIdx).toBeLessThan(branchIdx);
  });

  it('问题2/6：无关字符返回空（不匹配任何命令/描述/关键词）', () => {
    expect(useCommandLibrary.getState().matchTemplates('zzxq123')).toEqual([]);
  });

  it('问题6：正在输入某命令时只返回该命令的模板，不混入无关命令', () => {
    const res = useCommandLibrary.getState().matchTemplates('AT+CGDCONT=1');
    expect(res.every((r) => r.cmd === 'AT+CGDCONT')).toBe(true);
  });

  it('可选括号：填入非 cid=1 的完整参数仍匹配占位符分支', () => {
    // AT+CGDCONT=2,"IP","test.apn" 不匹配任何 =1 示例，但应匹配去括号后的占位符分支
    const res = useCommandLibrary.getState().matchTemplates('AT+CGDCONT=2,"IP","test.apn"');
    expect(res.length).toBe(1);
    expect(res[0].s.startsWith('AT+CGDCONT=<cid>')).toBe(true);
  });

  it('第二层：关键词/描述模糊搜索（非命令前缀时）', () => {
    // "注册" 不是任何模板的合法前缀 → 走第二层，命中 CEREG
    const res = useCommandLibrary.getState().matchTemplates('注册');
    expect(res.some((r) => r.cmd === 'AT+CEREG')).toBe(true);
  });

  it('字面前缀命中：AT+CE 返回 CEREG 模板', () => {
    const res = useCommandLibrary.getState().matchTemplates('AT+CE');
    expect(res.every((r) => r.cmd === 'AT+CEREG')).toBe(true);
    expect(res.length).toBe(2);
  });
});
