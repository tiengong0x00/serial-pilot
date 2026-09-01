/**
 * 执行引擎测试 (v1 递归模型)
 * - 工具函数：变量替换、校验、提取
 * - Hook集成测试：递归遍历、失败策略、循环、跳过逻辑
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTestExecution } from '@/hooks/useTestExecution';
import { useExecutionStore } from '@/stores/executionStore';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useSerialStore } from '@/stores/serialStore';
import {
  replaceVariables,
  validateResponse,
  extractVariables,
  matchPattern,
  createCase,
  createCommand,
  createRootCase,
} from '@/lib/testCaseUtils';
import type { ExtractConfig, StandardCommand } from '@/types/testCase';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** 构造标准命令（窄化联合类型，便于设置 validation/onFailure 等字段） */
function mkCommand(content: string): StandardCommand {
  const cmd = createCommand('command') as StandardCommand;
  cmd.content = content;
  cmd.validation = 'none'; // 默认无需等待响应，测试可覆盖
  return cmd;
}

// ============ 工具函数测试（纯逻辑，无依赖） ============

describe('执行引擎工具函数', () => {
  describe('replaceVariables', () => {
    it('应替换单个变量', () => {
      const variables = { rssi: '25' };
      const result = replaceVariables('AT+CSQ=${rssi}', variables);
      expect(result).toBe('AT+CSQ=25');
    });

    it('应替换多个变量', () => {
      const variables = { rssi: '25', ber: '0' };
      const result = replaceVariables('AT+CSQ=${rssi},${ber}', variables);
      expect(result).toBe('AT+CSQ=25,0');
    });

    it('应替换同一变量的多次出现', () => {
      const variables = { value: 'test' };
      const result = replaceVariables('${value} and ${value}', variables);
      expect(result).toBe('test and test');
    });

    it('未定义的变量应保持原样', () => {
      const variables = { rssi: '25' };
      const result = replaceVariables('AT+CSQ=${rssi},${ber}', variables);
      expect(result).toBe('AT+CSQ=25,${ber}');
    });

    it('空变量对象应返回原文本', () => {
      const result = replaceVariables('AT+CSQ=${rssi}', {});
      expect(result).toBe('AT+CSQ=${rssi}');
    });

    it('没有变量占位符应返回原文本', () => {
      const variables = { rssi: '25' };
      const result = replaceVariables('AT+GMR', variables);
      expect(result).toBe('AT+GMR');
    });
  });

  describe('validateResponse', () => {
    it('none 校验应总是返回 true', () => {
      const result = validateResponse('anything', 'none');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('standard 校验应检测 OK', () => {
      expect(validateResponse('OK\r\n', 'standard').valid).toBe(true);
      expect(validateResponse('AT+GMR\r\nOK\r\n', 'standard').valid).toBe(true);
    });

    it('standard 校验应拒绝 ERROR', () => {
      expect(validateResponse('ERROR\r\n', 'standard').valid).toBe(false);
      expect(validateResponse('+CME ERROR: 3\r\n', 'standard').valid).toBe(false);
      expect(validateResponse('+CMS ERROR: 500\r\n', 'standard').valid).toBe(false);
    });

    it('custom 校验 + contains 模式', () => {
      expect(validateResponse('+CSQ: 25,0\r\nOK', 'custom', '+CSQ', 'contains').valid).toBe(true);
      expect(validateResponse('ERROR\r\n', 'custom', '+CSQ', 'contains').valid).toBe(false);
    });

    it('custom 校验 + exact 模式（忽略首尾空白）', () => {
      expect(validateResponse(' OK\r\n', 'custom', 'OK', 'exact').valid).toBe(true);
      expect(validateResponse('OK', 'custom', ' OK ', 'exact').valid).toBe(true);
      expect(validateResponse('OK\r\n', 'custom', 'ERROR', 'exact').valid).toBe(false);
    });

    it('custom 校验 + regex 模式', () => {
      const result1 = validateResponse('+CSQ: 25,0', 'custom', '\\+CSQ: \\d+,\\d+', 'regex');
      expect(result1.valid).toBe(true);

      const result2 = validateResponse('ERROR', 'custom', '\\+CSQ: \\d+,\\d+', 'regex');
      expect(result2.valid).toBe(false);
    });

    it('custom 校验 + 非法正则应返回 false', () => {
      const result = validateResponse('text', 'custom', '[invalid(', 'regex');
      expect(result.valid).toBe(false);
    });

    it('custom 校验缺少 pattern 应返回错误', () => {
      const result = validateResponse('text', 'custom');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing');
    });
  });

  describe('matchPattern', () => {
    it('contains 模式', () => {
      expect(matchPattern('+CSQ: 25,0\r\nOK', '+CSQ', 'contains')).toBe(true);
      expect(matchPattern('ERROR', '+CSQ', 'contains')).toBe(false);
    });

    it('exact 模式（trim 两端空白）', () => {
      expect(matchPattern('  OK  \r\n', 'OK', 'exact')).toBe(true);
      expect(matchPattern('OK\r\n', 'ERROR', 'exact')).toBe(false);
    });

    it('startsWith 模式', () => {
      expect(matchPattern('  +CSQ: 25,0', '+CSQ', 'startsWith')).toBe(true);
      expect(matchPattern('OK\r\n+CSQ', '+CSQ', 'startsWith')).toBe(false);
    });

    it('endsWith 模式', () => {
      expect(matchPattern('AT+CSQ\r\nOK  ', 'OK', 'endsWith')).toBe(true);
      expect(matchPattern('OK\r\nERROR', 'OK', 'endsWith')).toBe(false);
    });

    it('regex 模式', () => {
      expect(matchPattern('+CSQ: 25,0', '\\+CSQ: \\d+,\\d+', 'regex')).toBe(true);
      expect(matchPattern('ERROR', '\\+CSQ: \\d+,\\d+', 'regex')).toBe(false);
    });

    it('非法正则应返回 false', () => {
      expect(matchPattern('text', '[invalid(', 'regex')).toBe(false);
    });
  });

  describe('extractVariables', () => {
    describe('regex 模式', () => {
      it('应通过捕获组提取变量', () => {
        const text = '+CSQ: 25,0\r\nOK\r\n';
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'regex',
          parsePattern: '\\+CSQ: (\\d+),(\\d+)',
          parameterMap: { rssi: '1', ber: '2' },
        };
        const result = extractVariables(text, config);
        expect(result).toEqual({ rssi: '25', ber: '0' });
      });

      it('不匹配时应返回空对象', () => {
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'regex',
          parsePattern: '\\+CSQ: (\\d+),(\\d+)',
          parameterMap: { rssi: '1', ber: '2' },
        };
        const result = extractVariables('ERROR', config);
        expect(result).toEqual({});
      });

      it('部分捕获组缺失时应只提取存在的', () => {
        const text = '+CSQ: 25';
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'regex',
          parsePattern: '\\+CSQ: (\\d+)',
          parameterMap: { rssi: '1', ber: '2' },
        };
        const result = extractVariables(text, config);
        expect(result).toEqual({ rssi: '25' });
      });

      it('非法正则应返回空对象', () => {
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'regex',
          parsePattern: '[invalid(',
          parameterMap: { key: '1' },
        };
        const result = extractVariables('text', config);
        expect(result).toEqual({});
      });
    });

    describe('split 模式', () => {
      it('应通过分隔符提取变量', () => {
        const text = '25,0,99';
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'split',
          parsePattern: ',',
          parameterMap: { rssi: '0', ber: '1', extra: '2' },
        };
        const result = extractVariables(text, config);
        expect(result).toEqual({ rssi: '25', ber: '0', extra: '99' });
      });

      it('应 trim 提取的值', () => {
        const text = '25 , 0 , 99';
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'split',
          parsePattern: ',',
          parameterMap: { rssi: '0', ber: '1' },
        };
        const result = extractVariables(text, config);
        expect(result).toEqual({ rssi: '25', ber: '0' });
      });

      it('索引超出范围应忽略', () => {
        const text = '25,0';
        const config: ExtractConfig = {
          enabled: true,
          parseType: 'split',
          parsePattern: ',',
          parameterMap: { rssi: '0', ber: '1', missing: '99' },
        };
        const result = extractVariables(text, config);
        expect(result).toEqual({ rssi: '25', ber: '0' });
      });
    });

    it('disabled 配置应返回空对象', () => {
      const config: ExtractConfig = {
        enabled: false,
        parseType: 'regex',
        parsePattern: '(\\d+)',
        parameterMap: { key: '1' },
      };
      const result = extractVariables('123', config);
      expect(result).toEqual({});
    });

    it('空 parameterMap 应返回空对象', () => {
      const config: ExtractConfig = {
        enabled: true,
        parseType: 'regex',
        parsePattern: '\\+CSQ: (\\d+),(\\d+)',
        parameterMap: {},
      };
      const result = extractVariables('+CSQ: 25,0', config);
      expect(result).toEqual({});
    });
  });
});

// ============ Hook 集成测试（递归执行、失败策略、循环） ============

describe('useTestExecution Hook (递归模型)', () => {
  beforeEach(() => {
    // 重置所有 store
    useExecutionStore.getState().reset();
    useTestCaseStore.getState().reset();
    useTerminalStore.getState().clearMessages();

    // 端口连接校验：测试环境标记 P1/P2 均已连接，否则 startExecution 会提前返回
    useSerialStore.setState({
      connectionStatus: { p1_connected: true, p2_connected: true },
    });

    // Mock Tauri invoke: 默认成功返回
    vi.mocked(invoke).mockResolvedValue({
      bytes_written: 10,
      timestamp: Date.now(),
    });

    // Mock Tauri listen: 默认空监听器（不触发数据）
    vi.mocked(listen).mockResolvedValue(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('基础执行流程', () => {
    it('应执行简单的单命令用例', async () => {
      // 构造测试用例
      const root = createRootCase('测试1');
      const cmd1 = mkCommand('AT');
      root.children = [cmd1];

      // 设置 store
      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());

      // 启动执行
      await result.current.startExecution('P1');

      // 等待执行完成
      await waitFor(
        () => {
          expect(useExecutionStore.getState().isRunning).toBe(false);
        },
        { timeout: 3000 }
      );

      // 验证命令已成功
      const updatedRoot = useTestCaseStore.getState().cases[0];
      const updatedCmd = updatedRoot.children[0];
      expect(updatedCmd).toMatchObject({ status: 'success' });
      expect(updatedRoot.status).toBe('success');

      // 验证发送了命令
      expect(invoke).toHaveBeenCalledWith(
        'write_serial_data',
        expect.objectContaining({
          portLabel: 'P1',
        })
      );
    });

    it('应执行多个命令（顺序执行）', async () => {
      const root = createRootCase('测试2');
      root.children = [mkCommand('AT'), mkCommand('AT+GMR'), mkCommand('AT+CSQ')];

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 验证所有命令都执行了
      expect(invoke).toHaveBeenCalledTimes(3);
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'success' });
      expect(updatedRoot.children[1]).toMatchObject({ status: 'success' });
      expect(updatedRoot.children[2]).toMatchObject({ status: 'success' });
    });
  });

  describe('递归遍历（子用例）', () => {
    it('应递归执行子用例中的命令', async () => {
      const root = createRootCase('根用例');
      const cmd1 = mkCommand('AT');

      const subCase = createCase('子用例');
      const cmd2 = mkCommand('AT+GMR');
      subCase.children = [cmd2];

      root.children = [cmd1, subCase];

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 验证递归执行
      expect(invoke).toHaveBeenCalledTimes(2);
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'success' }); // cmd1
      expect((updatedRoot.children[1] as any).status).toBe('success'); // subCase
      expect((updatedRoot.children[1] as any).children[0]).toMatchObject({ status: 'success' }); // cmd2
    });
  });

  describe('跳过逻辑', () => {
    it('应跳过 selected=false 的用例', async () => {
      const root = createRootCase('根用例');
      const subCase = createCase('跳过的子用例');
      subCase.selected = false;
      subCase.children = [mkCommand('AT')];
      root.children = [subCase];

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 子用例被跳过，命令不执行
      expect(invoke).not.toHaveBeenCalled();
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect((updatedRoot.children[0] as any).status).toBe('skipped');
    });

    it('应跳过 selected=false 的命令', async () => {
      const root = createRootCase('根用例');
      const cmd1 = mkCommand('AT');
      cmd1.selected = true;

      const cmd2 = mkCommand('AT+GMR');
      cmd2.selected = false;

      const cmd3 = mkCommand('AT+CSQ');
      cmd3.selected = true;

      root.children = [cmd1, cmd2, cmd3];

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 只执行了 cmd1 和 cmd3
      expect(invoke).toHaveBeenCalledTimes(2);
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'success' });
      expect(updatedRoot.children[1]).toMatchObject({ status: 'skipped' });
      expect(updatedRoot.children[2]).toMatchObject({ status: 'success' });
    });
  });

  describe('失败策略 - 命令级', () => {
    it('onFailure=abort 应立即终止', async () => {
      const root = createRootCase('失败终止');
      const cmd1 = mkCommand('AT');
      const cmd2 = mkCommand('FAIL');
      cmd2.onFailure = 'abort';
      const cmd3 = mkCommand('AT+CSQ');
      root.children = [cmd1, cmd2, cmd3];

      // Mock cmd2 发送失败
      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        if (args.data && new TextDecoder().decode(new Uint8Array(args.data)).includes('FAIL')) {
          return Promise.reject(new Error('发送失败'));
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // cmd1 成功，cmd2 失败，cmd3 未执行
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'success' });
      expect(updatedRoot.children[1]).toMatchObject({ status: 'failed' });
      expect(updatedRoot.children[2]).toMatchObject({ status: 'pending' }); // 未执行
      expect(updatedRoot.status).toBe('failed');
    });

    it('onFailure=continue 应跳过失败继续执行', async () => {
      const root = createRootCase('失败继续');
      const cmd1 = mkCommand('AT');
      const cmd2 = mkCommand('FAIL');
      cmd2.onFailure = 'continue';
      const cmd3 = mkCommand('AT+CSQ');
      root.children = [cmd1, cmd2, cmd3];

      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        if (args.data && new TextDecoder().decode(new Uint8Array(args.data)).includes('FAIL')) {
          return Promise.reject(new Error('发送失败'));
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // cmd1 成功，cmd2 失败但继续，cmd3 成功
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'success' });
      expect(updatedRoot.children[1]).toMatchObject({ status: 'failed' });
      expect(updatedRoot.children[2]).toMatchObject({ status: 'success' });
      expect(updatedRoot.status).toBe('success');
    });

    it('onFailure=goto 应跳转到目标命令（阶段3）', async () => {
      const root = createRootCase('失败跳转');
      const cmd1 = mkCommand('AT');
      const cmd2 = mkCommand('FAIL');
      const cmd3 = mkCommand('AT+GMR');
      const cmd4 = mkCommand('AT+CSQ');
      root.children = [cmd1, cmd2, cmd3, cmd4];

      // cmd2 失败后跳转到 cmd4（跳过 cmd3）
      cmd2.onFailure = 'goto';
      cmd2.gotoTargetId = cmd4.id;

      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        const data = args?.data
          ? new TextDecoder().decode(new Uint8Array(args.data))
          : '';
        if (data.includes('FAIL')) {
          return Promise.reject(new Error('发送失败'));
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // cmd1 成功 → cmd2 失败跳转 → cmd4（跳过 cmd3）
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'success' }); // cmd1
      expect(updatedRoot.children[1]).toMatchObject({ status: 'failed' });  // cmd2
      expect(updatedRoot.children[2]).toMatchObject({ status: 'pending' }); // cmd3 跳过
      expect(updatedRoot.children[3]).toMatchObject({ status: 'success' }); // cmd4

      const sentData = vi.mocked(invoke).mock.calls.map((call) => {
        const args = call[1] as any;
        return new TextDecoder().decode(new Uint8Array(args.data));
      });
      expect(sentData).toContain('AT\r\n');
      expect(sentData).toContain('AT+CSQ\r\n');
      expect(sentData).not.toContain('AT+GMR');
    });

    it('onFailure=goto 目标失效应兜底继续（阶段3）', async () => {
      const root = createRootCase('失败跳转兜底');
      const cmd1 = mkCommand('FAIL');
      const cmd2 = mkCommand('AT+GMR');
      root.children = [cmd1, cmd2];

      // cmd1 失败但 gotoTargetId 指向不存在的 id → 兜底正常继续
      cmd1.onFailure = 'goto';
      cmd1.gotoTargetId = 'nonexistent_id';

      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        const data = args?.data
          ? new TextDecoder().decode(new Uint8Array(args.data))
          : '';
        if (data.includes('FAIL')) {
          return Promise.reject(new Error('发送失败'));
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // cmd1 失败 → 目标失效 → 兜底继续 cmd2
      const updatedRoot = useTestCaseStore.getState().cases[0];
      expect(updatedRoot.children[0]).toMatchObject({ status: 'failed' });
      expect(updatedRoot.children[1]).toMatchObject({ status: 'success' });
    });
  });

  describe('URC 守护动作接线（阶段1）', () => {
    /**
     * 在指定命令发送时注入守护触发，模拟 URC 命中。
     * once=true 时只注入一次，避免 restart-round 等动作导致的无限循环。
     */
    function injectTriggerOnSend(
      matchText: string,
      action: 'abort' | 'restart-round' | 'fail-current' | 'capture-only' | 'log-only',
      guardId = 'g_test',
      once = false,
    ) {
      let injected = false;
      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        const data = args?.data
          ? new TextDecoder().decode(new Uint8Array(args.data))
          : '';
        if (data.includes(matchText) && (!once || !injected)) {
          injected = true;
          useExecutionStore.getState().setGuardTrigger({
            guardId,
            action,
            triggeredAt: Date.now(),
          });
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });
    }

    it('action=abort 应在命令边界立即终止', async () => {
      const root = createRootCase('守护终止');
      root.children = [mkCommand('AT'), mkCommand('AT+GMR'), mkCommand('AT+CSQ')];

      injectTriggerOnSend('AT\r', 'abort'); // 首条命令触发

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 首条发送后触发 abort：后续命令不执行
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(useTestCaseStore.getState().cases[0].status).toBe('failed');
    });

    it('action=fail-current 应结束本轮', async () => {
      const root = createRootCase('守护失败当前轮');
      root.children = [mkCommand('AT'), mkCommand('AT+GMR')];

      injectTriggerOnSend('AT\r', 'fail-current');

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 首条发送后本轮结束：第二条未执行
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('action=restart-round 应从本轮开头重新执行', async () => {
      const root = createRootCase('守护重启轮');
      root.children = [mkCommand('AT'), mkCommand('AT+GMR')];

      // 仅在第一次发送 AT 时注入触发，重启后不再注入 → 正常跑完
      injectTriggerOnSend('AT\r', 'restart-round', 'g_test', true);

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 第一次 AT 触发重启 → 重新从头：AT, AT+GMR（3 次发送）
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(useTestCaseStore.getState().cases[0].status).toBe('success');
    });

    it('action=log-only 不应影响控制流', async () => {
      const root = createRootCase('守护仅记录');
      root.children = [mkCommand('AT'), mkCommand('AT+GMR')];

      injectTriggerOnSend('AT\r', 'log-only');

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 两条命令均正常执行
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(useTestCaseStore.getState().cases[0].status).toBe('success');
    });

    it('action=jump-to (goto) 应直接跳转不返回', async () => {
      const root = createRootCase('守护跳转 goto');
      const cmdA = mkCommand('AT');
      const cmdB = mkCommand('AT+GMR');
      const cmdC = mkCommand('AT+CSQ');
      root.children = [cmdA, cmdB, cmdC];

      // 首条触发后跳转到 cmdC（跳过 cmdB）
      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        const data = args?.data
          ? new TextDecoder().decode(new Uint8Array(args.data))
          : '';
        if (data.includes('AT\r') && data.length < 5) {
          // 注入守护触发（模拟 URC 监听器设置）
          // 注册守护以便引擎查找
          useExecutionStore.getState().registerGuard({
            id: 'g_jump',
            type: 'urc-guard',
            name: 'jump_guard',
            content: '',
            dataFormat: 'utf8',
            lineEnding: 'none',
            delay: 0,
            selected: true,
            status: 'pending',
            pattern: '+JUMP',
            matchMode: 'contains',
            scope: 'root',
            action: 'jump-to',
            rearm: 'once',
            jumpTargetId: cmdC.id,
            jumpMode: 'goto',
          });
          useExecutionStore.getState().setGuardTrigger({
            guardId: 'g_jump',
            action: 'jump-to',
            triggeredAt: Date.now(),
          });
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // cmdA → 触发跳转 → cmdC（跳过 cmdB）
      expect(invoke).toHaveBeenCalledTimes(2);
      const sentData = vi.mocked(invoke).mock.calls.map((call) => {
        const args = call[1] as any;
        return new TextDecoder().decode(new Uint8Array(args.data));
      });
      expect(sentData).toContain('AT\r\n');
      expect(sentData).toContain('AT+CSQ\r\n');
      expect(sentData).not.toContain('AT+GMR');
    });

    it('action=jump-to (call) 应执行目标后回原位', async () => {
      const root = createRootCase('守护跳转 call');
      const cmdA = mkCommand('AT');
      const cmdB = mkCommand('AT+GMR');
      const cmdC = mkCommand('AT+CSQ');
      root.children = [cmdA, cmdB, cmdC];

      let firstATSeen = false;

      // cmdA 触发后调用 cmdB（提前执行），然后正常继续到 cmdB（会再执行一次）
      vi.mocked(invoke).mockImplementation((_cmd, args: any) => {
        const data = args?.data
          ? new TextDecoder().decode(new Uint8Array(args.data))
          : '';
        // 只在第一次发送 AT 时注入触发
        if (data.includes('AT\r') && data.length < 5 && !firstATSeen) {
          firstATSeen = true;
          useExecutionStore.getState().registerGuard({
            id: 'g_call',
            type: 'urc-guard',
            name: 'call_guard',
            content: '',
            dataFormat: 'utf8',
            lineEnding: 'none',
            delay: 0,
            selected: true,
            status: 'pending',
            pattern: '+CALL',
            matchMode: 'contains',
            scope: 'root',
            action: 'jump-to',
            rearm: 'once',
            jumpTargetId: cmdB.id,
            jumpMode: 'call',
          });
          useExecutionStore.getState().setGuardTrigger({
            guardId: 'g_call',
            action: 'jump-to',
            triggeredAt: Date.now(),
          });
        }
        return Promise.resolve({ bytes_written: 10, timestamp: Date.now() });
      });

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // cmdA → call cmdB (提前) → cmdB (正常顺序) → cmdC (正常顺序) = 4次
      expect(invoke).toHaveBeenCalledTimes(4);
      const sentData = vi.mocked(invoke).mock.calls.map((call) => {
        const args = call[1] as any;
        return new TextDecoder().decode(new Uint8Array(args.data));
      });
      expect(sentData[0]).toContain('AT\r\n');        // cmdA
      expect(sentData[1]).toContain('AT+GMR');        // call 插入 cmdB
      expect(sentData[2]).toContain('AT+GMR');        // 正常到 cmdB（再次）
      expect(sentData[3]).toContain('AT+CSQ');        // 正常到 cmdC
    });
  });

  describe('循环执行 - runCount', () => {
    it('runCount=2 应执行命令两轮', async () => {
      const root = createRootCase('循环测试');
      root.runCount = 2;
      root.children = [mkCommand('AT')];

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 命令执行了 2 次
      expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('子用例的 runCount 应独立生效', async () => {
      const root = createRootCase('嵌套循环');
      root.runCount = 1;

      const subCase = createCase('子用例');
      subCase.runCount = 3;
      subCase.children = [mkCommand('AT')];

      root.children = [subCase];

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 根用例执行 1 次，子用例内部循环 3 次
      expect(invoke).toHaveBeenCalledTimes(3);
    });
  });

  describe('停止与中断', () => {
    it('stopExecution 应中断执行', async () => {
      const root = createRootCase('停止测试');

      // 创建多个命令，延迟较长
      const commands = Array.from({ length: 10 }, () => {
        const cmd = mkCommand('AT');
        cmd.delay = 100; // 延迟便于中断
        return cmd;
      });
      root.children = commands;

      useTestCaseStore.setState({ cases: [root] });
      useExecutionStore.getState().initExecution('P1');

      const { result } = renderHook(() => useTestExecution());

      // 启动执行
      const execPromise = result.current.startExecution('P1');

      // 延迟后停止
      setTimeout(() => {
        result.current.stopExecution();
      }, 50);

      await execPromise;

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 执行被中断，不是所有命令都执行完
      expect(vi.mocked(invoke).mock.calls.length).toBeLessThan(10);
    });
  });

  describe('变量替换', () => {
    it('应替换命令中的变量', async () => {
      const root = createRootCase('变量测试');

      // 设置变量
      useExecutionStore.getState().initExecution('P1');
      useExecutionStore.getState().setVariable('imei', '123456789012345');

      root.children = [mkCommand('AT+CGSN=${imei}')];

      useTestCaseStore.setState({ cases: [root] });

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 验证发送的数据包含替换后的值
      expect(invoke).toHaveBeenCalledWith(
        'write_serial_data',
        expect.objectContaining({
          data: expect.any(Array),
        })
      );

      const callArgs = vi.mocked(invoke).mock.calls[0][1] as any;
      const sentData = new TextDecoder().decode(new Uint8Array(callArgs.data));
      expect(sentData).toContain('123456789012345');
      expect(sentData).not.toContain('${imei}');
    });
  });

  describe('文件发送', () => {
    it('应按分包设置发送文件内容（不加行尾符）', async () => {
      const root = createRootCase('文件发送测试');

      // 构造一个带 fileData 的命令
      const cmd = mkCommand('');
      cmd.fileData = {
        name: 'test.pem',
        size: 100,
        base64: btoa('A'.repeat(100)), // 100 字节的 'A'
      };

      root.children = [cmd];
      useTestCaseStore.setState({ cases: [root] });

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 验证 write_serial_data 被调用（分包发送，默认 filePacketSize=256，100字节会一次发完）
      expect(invoke).toHaveBeenCalledWith(
        'write_serial_data',
        expect.objectContaining({
          portLabel: 'P1',
          data: expect.any(Array),
        })
      );

      // 验证发送的数据是原始字节（不包含行尾符）
      const callArgs = vi.mocked(invoke).mock.calls[0][1] as any;
      const sentBytes = new Uint8Array(callArgs.data);
      expect(sentBytes.length).toBe(100);
      expect(new TextDecoder().decode(sentBytes)).toBe('A'.repeat(100));

      // 验证没有添加行尾符（CR/LF）
      expect(sentBytes[sentBytes.length - 1]).not.toBe(0x0d); // \r
      expect(sentBytes[sentBytes.length - 1]).not.toBe(0x0a); // \n
    });

    it('应按 filePacketSize 分包发送大文件', async () => {
      const root = createRootCase('大文件分包测试');

      // 构造 3KB 文件（默认 filePacketSize=256，会分成 12 包）
      const fileContent = 'B'.repeat(3072);
      const cmd = mkCommand('');
      cmd.fileData = {
        name: 'large.bin',
        size: 3072,
        base64: btoa(fileContent),
      };

      root.children = [cmd];
      useTestCaseStore.setState({ cases: [root] });

      const { result } = renderHook(() => useTestExecution());
      await result.current.startExecution('P1');

      await waitFor(() => {
        expect(useExecutionStore.getState().isRunning).toBe(false);
      });

      // 验证 write_serial_data 被调用了 12 次（12 个包）
      const calls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === 'write_serial_data'
      );
      expect(calls.length).toBe(12);

      // 验证每包大小：3072 / 256 = 12 包，每包 256 字节
      const sizes = calls.map((call) => (call[1] as any).data.length);
      expect(sizes).toEqual(Array(12).fill(256));
    });
  });
});
