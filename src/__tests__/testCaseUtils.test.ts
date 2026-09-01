import { describe, it, expect } from 'vitest';
import {
  createCase,
  createCommand,
  createRootCase,
  convertCommandType,
  exportToFile,
  parseImportFile,
  reassignIds,
  findCase,
  findCommand,
  walkCases,
  matchPattern,
  extractVariables,
  replaceVariables,
  validateResponse,
  isCase,
  isCommand,
  isStandardCommand,
  isUrcGuard,
} from '@/lib/testCaseUtils';
import type { TestCommand, UrcGuardCommand, StandardCommand, ExtractConfig } from '@/types/testCase';

/** 构造一个带命令内容的普通命令 */
function cmd(content: string): TestCommand {
  const c = createCommand('command');
  c.content = content;
  return c;
}

describe('testCaseUtils', () => {
  describe('工厂函数', () => {
    it('createCommand 默认创建普通命令', () => {
      const c = createCommand();
      expect(c.type).toBe('command');
      expect(c.selected).toBe(true);
      expect(c.status).toBe('pending');
      expect(c.id).toMatch(/^cmd_/);
    });

    it('createCommand 可创建守护命令', () => {
      expect(createCommand('urc-guard').type).toBe('urc-guard');
    });

    it('createCase 返回带空 children 的用例', () => {
      const c = createCase('用例A');
      expect(c.name).toBe('用例A');
      expect(c.children).toEqual([]);
      expect(c.runCount).toBe(1);
      expect(c.selected).toBe(true);
      expect(c.id).toMatch(/^case_/);
    });

    it('createRootCase 默认 targetPort 为 undefined（自动模式）', () => {
      const root = createRootCase('根测试');
      expect(root.name).toBe('根测试');
      expect('targetPort' in root).toBe(true); // 携带该字段以标识根用例
      expect(root.targetPort).toBeUndefined();
      expect(root.children).toEqual([]);
    });
  });

  describe('类型守卫', () => {
    it('应区分命令与用例', () => {
      const c = createCase('用例');
      const command = createCommand('command');
      expect(isCase(c)).toBe(true);
      expect(isCommand(c)).toBe(false);
      expect(isCommand(command)).toBe(true);
      expect(isCase(command)).toBe(false);
    });

    it('应区分命令类型', () => {
      expect(isStandardCommand(createCommand('command'))).toBe(true);
      expect(isUrcGuard(createCommand('urc-guard'))).toBe(true);
      expect(isStandardCommand(createCommand('urc-guard'))).toBe(false);
    });
  });

  describe('walkCases', () => {
    it('应深度优先遍历所有用例（跳过命令子项）', () => {
      const root = createCase('根用例');
      const sub = createCase('子用例');
      sub.children = [cmd('AT+CSQ')];
      root.children = [cmd('AT'), cmd('AT+GMR'), sub];

      const visited: Array<{ name: string; parent: string | null }> = [];
      walkCases([root], (c, parent) => {
        visited.push({ name: c.name, parent: parent?.name ?? null });
      });

      expect(visited).toEqual([
        { name: '根用例', parent: null },
        { name: '子用例', parent: '根用例' },
      ]);
    });

    it('回调返回 false 应提前终止遍历', () => {
      const root = createCase('根');
      const sub = createCase('子');
      root.children = [sub];

      const visited: string[] = [];
      walkCases([root], (c) => {
        visited.push(c.name);
        return false;
      });
      expect(visited).toEqual(['根']);
    });
  });

  describe('查找', () => {
    it('findCase 应按 ID 递归查找', () => {
      const root = createCase('根');
      const sub = createCase('子');
      root.children = [sub];
      expect(findCase([root], sub.id)?.name).toBe('子');
      expect(findCase([root], 'nonexistent')).toBeNull();
    });

    it('findCommand 应返回命令及其所属用例', () => {
      const root = createCase('根');
      const target = cmd('AT+CSQ');
      root.children = [cmd('AT'), target];
      const result = findCommand([root], target.id);
      expect(result?.command.content).toBe('AT+CSQ');
      expect(result?.owner.id).toBe(root.id);
    });

    it('findCommand 应能在子用例中查找', () => {
      const root = createCase('根');
      const sub = createCase('子');
      const target = cmd('AT+COPS?');
      sub.children = [target];
      root.children = [cmd('AT'), sub];
      const result = findCommand([root], target.id);
      expect(result?.command.content).toBe('AT+COPS?');
      expect(result?.owner.id).toBe(sub.id);
    });
  });

  describe('导入导出', () => {
    it('应导出为标准文件结构（单根）', () => {
      const root = createRootCase('测试用例');
      root.children = [cmd('AT')];
      const exported = exportToFile(root);

      expect(exported.version).toBe('2.0');
      expect(exported.rootCase.name).toBe('测试用例');
      expect(exported.rootCase.children).toHaveLength(1);
      expect(exported.createdAt).toBeTruthy();
    });

    it('导入应重新分配 ID 并重置运行状态', () => {
      const root = createRootCase('导入测试');
      root.children = [cmd('AT+CSQ')];
      root.status = 'success';
      root.selected = true;

      const json = JSON.stringify(exportToFile(root));
      const imported = parseImportFile(json);

      // v2 单根返回长度 1
      expect(imported).toHaveLength(1);
      expect(imported[0].name).toBe('导入测试');

      // ID 重新分配（不同于原始）
      expect(imported[0].id).not.toBe(root.id);
      expect(imported[0].children[0].id).not.toBe(root.children[0].id);
      expect(imported[0].id).toMatch(/^case_/);
      expect(imported[0].children[0].id).toMatch(/^cmd_/);

      // 运行状态被重置
      expect(imported[0].status).toBe('pending');
      // 根用例 selected 强制为 true（执行引擎依赖）
      expect(imported[0].selected).toBe(true);
    });

    it('导入非法 JSON 应抛出错误', () => {
      expect(() => parseImportFile('not json')).toThrow();
      expect(() => parseImportFile('{}')).toThrow('Unrecognized');
    });

    it('导入应递归重分配子用例内命令的 ID', () => {
      const root = createRootCase('嵌套导入');
      const sub = createCase('子用例');
      const subCmd = cmd('AT+CSQ');
      sub.children = [subCmd];
      root.children = [cmd('AT'), sub];

      const json = JSON.stringify(exportToFile(root));
      const imported = parseImportFile(json);

      const importedSub = imported[0].children[1];
      expect(isCase(importedSub)).toBe(true);
      if (isCase(importedSub)) {
        expect(importedSub.name).toBe('子用例');
        expect(importedSub.children[0].id).not.toBe(subCmd.id);
        expect(importedSub.children[0].id).toMatch(/^cmd_/);
      }
    });

    it('导入应保留子用例的 selected 状态', () => {
      const root = createRootCase('测试 selected 保留');
      const sub1 = createCase('已启用子用例');
      sub1.selected = true;
      const sub2 = createCase('已禁用子用例');
      sub2.selected = false;
      root.children = [sub1, sub2];

      const json = JSON.stringify(exportToFile(root));
      const imported = parseImportFile(json);

      // 根用例强制启用
      expect(imported[0].selected).toBe(true);

      // 子用例保留原始 selected 状态
      const importedSub1 = imported[0].children[0];
      const importedSub2 = imported[0].children[1];
      expect(isCase(importedSub1)).toBe(true);
      expect(isCase(importedSub2)).toBe(true);
      if (isCase(importedSub1) && isCase(importedSub2)) {
        expect(importedSub1.selected).toBe(true);
        expect(importedSub2.selected).toBe(false);
      }
    });
  });

  describe('reassignIds', () => {
    it('应递归重分配 ID 且不污染源对象', () => {
      const root = createCase('SrcCase');
      const sub = createCase('SubCase');
      const c0 = cmd('AT');
      const subCmd = cmd('AT+CSQ');
      sub.children = [subCmd];
      root.children = [c0, sub];

      const originalRootId = root.id;
      const originalCmdId = c0.id;
      const originalSubCmdId = subCmd.id;

      const copy = reassignIds(root);

      // 源对象保持原样
      expect(root.id).toBe(originalRootId);
      expect(root.children[0].id).toBe(originalCmdId);

      // 副本全部为新 ID
      expect(copy.id).not.toBe(originalRootId);
      expect(copy.children[0].id).not.toBe(originalCmdId);

      // 递归子用例内命令也重分配
      const copiedSub = copy.children[1];
      expect(isCase(copiedSub)).toBe(true);
      if (isCase(copiedSub)) {
        expect(copiedSub.children[0].id).not.toBe(originalSubCmdId);
      }
    });
  });

  describe('导入补齐默认值（方案 A：只填关键参数）', () => {
    it('v2 最小 JSON 应补齐命令默认值', () => {
      const json = JSON.stringify({
        version: '2.0',
        rootCase: {
          name: 'Minimal',
          targetPort: 'P1',
          children: [{ type: 'command', name: 'AT', content: 'AT' }],
        },
      });

      const [root] = parseImportFile(json);
      const c = root.children[0] as StandardCommand;
      expect(c.type).toBe('command');
      expect(c.dataFormat).toBe('utf8');
      expect(c.lineEnding).toBe('crlf');
      expect(c.repeatCount).toBe(1);
      expect(c.successThreshold).toBe(1);
      expect(c.stopWhenReached).toBe(true);
      expect(c.timeout).toBe(2000);
      expect(c.validation).toBe('standard');
      expect(c.onFailure).toBe('abort');
      expect(c.delay).toBe(0);
    });

    it('type 缺省时应按标准命令补齐', () => {
      const json = JSON.stringify({
        version: '2.0',
        rootCase: { name: 'M', targetPort: 'P1', children: [{ content: 'AT' }] },
      });
      const [root] = parseImportFile(json);
      const c = root.children[0] as StandardCommand;
      expect(c.type).toBe('command');
      expect(c.timeout).toBe(2000);
    });

    it('已填字段不应被默认值覆盖（含 false / 0 等合法值）', () => {
      const json = JSON.stringify({
        version: '2.0',
        rootCase: {
          name: 'Keep',
          targetPort: 'P2',
          children: [
            {
              type: 'command',
              content: 'AT',
              repeatCount: 5,
              stopWhenReached: false,
              delay: 0,
              timeout: 9000,
              validation: 'none',
            },
          ],
        },
      });
      const [root] = parseImportFile(json);
      const c = root.children[0] as StandardCommand;
      expect(c.repeatCount).toBe(5);
      expect(c.stopWhenReached).toBe(false);
      expect(c.delay).toBe(0);
      expect(c.timeout).toBe(9000);
      expect(c.validation).toBe('none');
    });

    it('urc-guard 缺省时应补齐守护默认值', () => {
      const json = JSON.stringify({
        version: '2.0',
        rootCase: {
          name: 'G',
          targetPort: 'P1',
          children: [{ type: 'urc-guard', pattern: '+CREG: 0' }],
        },
      });
      const [root] = parseImportFile(json);
      const g = root.children[0] as UrcGuardCommand;
      expect(g.matchMode).toBe('contains');
      expect(g.scope).toBe('case');
      expect(g.action).toBe('fail-current');
      expect(g.rearm).toBe('continuous');
    });

    it('根用例缺省字段应补齐，缺 targetPort 时默认 P1', () => {
      const json = JSON.stringify({
        version: '2.0',
        rootCase: { name: 'R', children: [{ type: 'command', content: 'AT' }] },
      });
      const [root] = parseImportFile(json);
      expect((root as { targetPort?: string }).targetPort).toBe('P1');
      expect(root.runCount).toBe(1);
      expect(root.onFailure).toBe('abort');
      expect(root.isExpanded).toBe(true);
      expect(root.status).toBe('pending');
    });
  });

  describe('extractVariables', () => {
    it('regex 模式应按捕获组提取变量', () => {
      const config: ExtractConfig = {
        enabled: true,
        parseType: 'regex',
        parsePattern: '\\+CSQ: (\\d+),(\\d+)',
        parameterMap: { rssi: '1', ber: '2' },
      };
      expect(extractVariables('+CSQ: 25,99', config)).toEqual({ rssi: '25', ber: '99' });
    });

    it('split 模式应按分片索引提取变量', () => {
      const config: ExtractConfig = {
        enabled: true,
        parseType: 'split',
        parsePattern: ',',
        parameterMap: { first: '0', second: '1' },
      };
      expect(extractVariables('a,b,c', config)).toEqual({ first: 'a', second: 'b' });
    });

    it('未启用时返回空对象', () => {
      const config: ExtractConfig = {
        enabled: false,
        parseType: 'regex',
        parsePattern: '.*',
        parameterMap: { x: '0' },
      };
      expect(extractVariables('anything', config)).toEqual({});
    });
  });

  describe('replaceVariables', () => {
    it('应替换提取型变量', () => {
      const vars = { token: 'abc123', id: '999' };
      expect(replaceVariables('AT+CMD=${token},${id}', vars)).toBe('AT+CMD=abc123,999');
    });

    it('应支持同一变量多次出现', () => {
      const vars = { x: 'A' };
      expect(replaceVariables('${x}${x}${x}', vars)).toBe('AAA');
    });

    it('未定义的变量保持原样', () => {
      const vars = { a: '1' };
      expect(replaceVariables('${a} ${b}', vars)).toBe('1 ${b}');
    });

    it('应生成随机可见字符串 ${rand:str:N}', () => {
      const result = replaceVariables('${rand:str:8}', {});
      expect(result).toHaveLength(8);
      expect(result).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('应生成随机 HEX 字符串 ${rand:hex:N}，输出 2N 个大写 HEX 字符', () => {
      const result = replaceVariables('${rand:hex:8}', {});
      expect(result).toHaveLength(16); // 8 字节 → 16 个 hex 字符
      expect(result).toMatch(/^[0-9A-F]+$/);
    });

    it('rand 函数每次调用应生成不同值', () => {
      const r1 = replaceVariables('${rand:hex:4}', {});
      const r2 = replaceVariables('${rand:hex:4}', {});
      // 概率上几乎不可能相同（4 字节 = 2^32 种可能）
      expect(r1).not.toBe(r2);
    });

    it('N=0 时生成空字符串', () => {
      expect(replaceVariables('${rand:str:0}', {})).toBe('');
      expect(replaceVariables('${rand:hex:0}', {})).toBe('');
    });

    it('应混合替换提取变量和生成变量', () => {
      const vars = { cmd: 'SEND' };
      const result = replaceVariables('${cmd}:${rand:hex:2}', vars);
      expect(result).toMatch(/^SEND:[0-9A-F]{4}$/);
    });

    it('长度参数可用提取变量（先字典后函数展开）', () => {
      const vars = { len: '4' };
      const result = replaceVariables('${rand:hex:${len}}', vars);
      expect(result).toMatch(/^[0-9A-F]{8}$/); // 4 字节 → 8 个 hex 字符
    });

    it('应支持序列生成器 ${seq:start:step}', () => {
      const counters = new Map<string, number>();
      const r1 = replaceVariables('AT+TEST=${seq:60:20}', {}, counters);
      const r2 = replaceVariables('AT+TEST=${seq:60:20}', {}, counters);
      const r3 = replaceVariables('AT+TEST=${seq:60:20}', {}, counters);
      expect(r1).toBe('AT+TEST=60');
      expect(r2).toBe('AT+TEST=80');
      expect(r3).toBe('AT+TEST=100');
    });

    it('序列生成器应支持上限 ${seq:start:step:max}', () => {
      const counters = new Map<string, number>();
      const r1 = replaceVariables('${seq:10:5:20}', {}, counters);
      const r2 = replaceVariables('${seq:10:5:20}', {}, counters);
      const r3 = replaceVariables('${seq:10:5:20}', {}, counters);
      const r4 = replaceVariables('${seq:10:5:20}', {}, counters);
      expect(r1).toBe('10');
      expect(r2).toBe('15');
      expect(r3).toBe('20');
      expect(r4).toBe('20'); // 达到上限，保持 20
    });

    it('多个不同的序列生成器应独立计数', () => {
      const counters = new Map<string, number>();
      const r1 = replaceVariables('id=${seq:1:1} val=${seq:100:10}', {}, counters);
      const r2 = replaceVariables('id=${seq:1:1} val=${seq:100:10}', {}, counters);
      expect(r1).toBe('id=1 val=100');
      expect(r2).toBe('id=2 val=110');
    });

    it('序列生成器应支持负数和负步长', () => {
      const counters = new Map<string, number>();
      const r1 = replaceVariables('${seq:100:-10}', {}, counters);
      const r2 = replaceVariables('${seq:100:-10}', {}, counters);
      const r3 = replaceVariables('${seq:100:-10}', {}, counters);
      expect(r1).toBe('100');
      expect(r2).toBe('90');
      expect(r3).toBe('80');
    });

    it('序列生成器不传入 counters 时应被忽略', () => {
      const result = replaceVariables('AT+TEST=${seq:60:20}', {});
      expect(result).toBe('AT+TEST=${seq:60:20}'); // 未处理，保持原样
    });
  });

  describe('matchPattern', () => {
    it('应支持各种匹配模式', () => {
      expect(matchPattern('hello world', 'world', 'contains')).toBe(true);
      expect(matchPattern('hello', 'hello', 'exact')).toBe(true);
      expect(matchPattern('hello', 'world', 'exact')).toBe(false);
      expect(matchPattern('hello world', 'hello', 'startsWith')).toBe(true);
      expect(matchPattern('hello world', 'world', 'endsWith')).toBe(true);
      expect(matchPattern('+CSQ: 25,99', '\\+CSQ: \\d+', 'regex')).toBe(true);
    });
  });

  describe('validateResponse', () => {
    it('none 校验永远通过', () => {
      expect(validateResponse('anything', 'none').valid).toBe(true);
    });

    it('standard 校验遇 OK 通过、遇 ERROR 失败', () => {
      expect(validateResponse('OK\r\n', 'standard').valid).toBe(true);
      expect(validateResponse('ERROR\r\n', 'standard').valid).toBe(false);
    });

    it('custom 校验使用给定模式与匹配方式', () => {
      expect(validateResponse('+CSQ: 25,99', 'custom', '+CSQ', 'contains').valid).toBe(true);
      expect(validateResponse('nope', 'custom', '+CSQ', 'contains').valid).toBe(false);
    });

    it('custom 校验缺少模式时失败', () => {
      const result = validateResponse('anything', 'custom');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('convertCommandType', () => {
    it('应保留通用字段（id/name/description/content/dataFormat等）', () => {
      const source = createCommand('command') as StandardCommand;
      source.id = 'cmd_test_123';
      source.name = '查询信号';
      source.description = '测试描述';
      source.content = 'AT+CSQ';
      source.dataFormat = 'hex';
      source.lineEnding = 'lf';
      source.delay = 150;
      source.selected = false;
      source.status = 'success';

      const converted = convertCommandType(source, 'urc-guard') as UrcGuardCommand;

      expect(converted.type).toBe('urc-guard');
      expect(converted.id).toBe('cmd_test_123');
      expect(converted.name).toBe('查询信号');
      expect(converted.description).toBe('测试描述');
      expect(converted.content).toBe('AT+CSQ');
      expect(converted.dataFormat).toBe('hex');
      expect(converted.lineEnding).toBe('lf');
      expect(converted.delay).toBe(150);
      expect(converted.selected).toBe(false);
      expect(converted.status).toBe('success');
    });

    it('command → urc-guard 应保留 extractConfig', () => {
      const source = createCommand('command') as StandardCommand;
      source.extractConfig = {
        enabled: true,
        parseType: 'regex',
        parsePattern: '(\\d+)',
        parameterMap: { val: '1' },
      };

      const converted = convertCommandType(source, 'urc-guard') as UrcGuardCommand;

      expect(converted.extractConfig).toEqual(source.extractConfig);
    });

    it('urc-guard → command 应重置为 command 专属字段', () => {
      const source = createCommand('urc-guard') as UrcGuardCommand;
      source.pattern = '+REBOOT';
      source.scope = 'root';
      source.action = 'abort';

      const converted = convertCommandType(source, 'command') as StandardCommand;

      expect(converted.type).toBe('command');
      expect('pattern' in converted).toBe(false); // command 没有 pattern
      expect(converted.repeatCount).toBe(1); // command 的默认字段
      expect(converted.validation).toBe('standard');
    });
  });
});

