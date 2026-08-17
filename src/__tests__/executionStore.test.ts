import { describe, it, expect, beforeEach } from 'vitest';
import { useExecutionStore } from '@/stores/executionStore';
import type { UrcGuardCommand } from '@/types/testCase';

/** 创建守护命令辅助函数 */
function createGuard(
  id: string,
  pattern: string,
  action: UrcGuardCommand['action'] = 'log-only',
  scope: 'root' | 'case' = 'root',
): UrcGuardCommand {
  return {
    id,
    type: 'urc-guard',
    name: `守护_${id}`,
    content: '',
    dataFormat: 'utf8',
    lineEnding: 'none',
    preDelay: 0,
    postDelay: 0,
    selected: true,
    status: 'pending',
    pattern,
    matchMode: 'contains',
    scope,
    action,
    rearm: 'continuous',
  };
}

describe('executionStore (v1 递归模型)', () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  describe('初始化与执行上下文', () => {
    it('应正确初始化执行上下文', () => {
      useExecutionStore.getState().initExecution('P1');

      const context = useExecutionStore.getState().context;
      expect(context).toBeDefined();
      expect(context?.targetPort).toBe('P1');
      expect(Object.keys(context?.variables ?? {})).toHaveLength(0);
      expect(context?.activeGuards.size).toBe(0);
      expect(context?.startTime).toBeGreaterThan(0);
    });

    it('可指定目标端口 P2', () => {
      const { initExecution } = useExecutionStore.getState();
      initExecution('P2');

      expect(useExecutionStore.getState().context?.targetPort).toBe('P2');
    });

    it('初始化应清空之前的状态', () => {
      const { initExecution, setVariable, addLog, start } = useExecutionStore.getState();

      // 第一次初始化并设置状态
      initExecution('P1');
      start();
      setVariable('old', 'value');
      addLog('info', '旧日志');

      // 再次初始化
      initExecution('P2');

      const state = useExecutionStore.getState();
      expect(state.context?.targetPort).toBe('P2');
      expect(state.context?.variables).toEqual({});
      expect(state.logs).toHaveLength(0);
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
    });
  });

  describe('变量管理', () => {
    beforeEach(() => {
      useExecutionStore.getState().initExecution('P1');
    });

    it('应设置和获取变量', () => {
      const { setVariable, getVariable } = useExecutionStore.getState();

      setVariable('rssi', '25');
      setVariable('ber', '0');

      expect(getVariable('rssi')).toBe('25');
      expect(getVariable('ber')).toBe('0');
      expect(getVariable('nonexistent')).toBeUndefined();
    });

    it('变量应支持覆盖', () => {
      const { setVariable, getVariable } = useExecutionStore.getState();

      setVariable('value', 'old');
      expect(getVariable('value')).toBe('old');

      setVariable('value', 'new');
      expect(getVariable('value')).toBe('new');
    });

    it('未初始化时设置变量应无效', () => {
      useExecutionStore.getState().reset();
      const { setVariable, getVariable } = useExecutionStore.getState();

      setVariable('test', 'value');
      expect(getVariable('test')).toBeUndefined();
    });
  });

  describe('守护注册管理', () => {
    beforeEach(() => {
      useExecutionStore.getState().initExecution('P1');
    });

    it('应注册守护命令', () => {
      const { registerGuard, getActiveGuards } = useExecutionStore.getState();
      const guard1 = createGuard('g1', 'ERROR', 'abort');
      const guard2 = createGuard('g2', 'OK', 'log-only');

      registerGuard(guard1);
      registerGuard(guard2);

      const guards = getActiveGuards();
      expect(guards).toHaveLength(2);
      expect(guards.find((g) => g.id === 'g1')).toBeDefined();
      expect(guards.find((g) => g.id === 'g2')).toBeDefined();
    });

    it('应防止重复注册相同ID的守护', () => {
      const { registerGuard, getActiveGuards } = useExecutionStore.getState();
      const guard1 = createGuard('g1', 'ERROR', 'abort');
      const guard1Dup = createGuard('g1', 'WARN', 'log-only'); // 相同ID

      registerGuard(guard1);
      registerGuard(guard1Dup);

      const guards = getActiveGuards();
      expect(guards).toHaveLength(1);
      expect(guards[0].pattern).toBe('ERROR'); // 应保留第一次注册的
    });

    it('应注销守护命令', () => {
      const { registerGuard, unregisterGuard, getActiveGuards } =
        useExecutionStore.getState();
      const guard1 = createGuard('g1', 'ERROR');
      const guard2 = createGuard('g2', 'OK');

      registerGuard(guard1);
      registerGuard(guard2);
      expect(getActiveGuards()).toHaveLength(2);

      unregisterGuard('g1');
      const guards = getActiveGuards();
      expect(guards).toHaveLength(1);
      expect(guards[0].id).toBe('g2');
    });

    it('注销不存在的守护不应报错', () => {
      const { unregisterGuard, getActiveGuards } = useExecutionStore.getState();

      expect(() => unregisterGuard('nonexistent')).not.toThrow();
      expect(getActiveGuards()).toHaveLength(0);
    });

    it('未初始化时注册守护应无效', () => {
      useExecutionStore.getState().reset();
      const { registerGuard, getActiveGuards } = useExecutionStore.getState();
      const guard = createGuard('g1', 'ERROR');

      registerGuard(guard);
      expect(getActiveGuards()).toHaveLength(0);
    });
  });

  describe('守护触发通道', () => {
    beforeEach(() => {
      useExecutionStore.getState().initExecution('P1');
    });

    it('应设置和消费守护触发', () => {
      const { setGuardTrigger, consumeGuardTrigger } = useExecutionStore.getState();
      const trigger = {
        guardId: 'g1',
        action: 'abort' as const,
        triggeredAt: Date.now(),
      };

      setGuardTrigger(trigger);
      expect(useExecutionStore.getState().guardTrigger).toEqual(trigger);

      const consumed = consumeGuardTrigger();
      expect(consumed).toEqual(trigger);
      expect(useExecutionStore.getState().guardTrigger).toBeNull();
    });

    it('消费空触发应返回null', () => {
      const { consumeGuardTrigger } = useExecutionStore.getState();

      const result = consumeGuardTrigger();
      expect(result).toBeNull();
    });

    it('重复消费应返回null', () => {
      const { setGuardTrigger, consumeGuardTrigger } = useExecutionStore.getState();
      const trigger = {
        guardId: 'g1',
        action: 'log-only' as const,
        triggeredAt: Date.now(),
      };

      setGuardTrigger(trigger);
      consumeGuardTrigger();

      const secondConsume = consumeGuardTrigger();
      expect(secondConsume).toBeNull();
    });

    it('新触发应覆盖旧触发', () => {
      const { setGuardTrigger, consumeGuardTrigger } = useExecutionStore.getState();
      const trigger1 = {
        guardId: 'g1',
        action: 'log-only' as const,
        triggeredAt: 1000,
      };
      const trigger2 = {
        guardId: 'g2',
        action: 'abort' as const,
        triggeredAt: 2000,
      };

      setGuardTrigger(trigger1);
      setGuardTrigger(trigger2);

      const consumed = consumeGuardTrigger();
      expect(consumed?.guardId).toBe('g2');
    });
  });

  describe('当前命令追踪', () => {
    beforeEach(() => {
      useExecutionStore.getState().initExecution('P1');
    });

    it('应设置当前命令ID', () => {
      const { setCurrentCommand } = useExecutionStore.getState();

      setCurrentCommand('cmd_123');
      expect(useExecutionStore.getState().currentCommandId).toBe('cmd_123');

      setCurrentCommand('cmd_456');
      expect(useExecutionStore.getState().currentCommandId).toBe('cmd_456');
    });

    it('应允许清空当前命令ID', () => {
      const { setCurrentCommand } = useExecutionStore.getState();

      setCurrentCommand('cmd_123');
      setCurrentCommand(null);
      expect(useExecutionStore.getState().currentCommandId).toBeNull();
    });
  });

  describe('执行日志', () => {
    beforeEach(() => {
      useExecutionStore.getState().initExecution('P1');
    });

    it('应添加日志条目', () => {
      const { addLog } = useExecutionStore.getState();

      addLog('info', '测试日志');
      addLog('error', '错误日志');

      // 头插：最新日志在数组头部
      const currentLogs = useExecutionStore.getState().logs;
      expect(currentLogs).toHaveLength(2);
      expect(currentLogs[0].level).toBe('error');
      expect(currentLogs[0].message).toBe('错误日志');
      expect(currentLogs[1].level).toBe('info');
      expect(currentLogs[1].message).toBe('测试日志');
    });

    it('日志应包含时间戳和唯一ID', () => {
      const { addLog } = useExecutionStore.getState();
      const before = Date.now();

      addLog('info', '测试');

      const log = useExecutionStore.getState().logs[0];
      expect(log.timestamp).toBeGreaterThanOrEqual(before);
      expect(log.timestamp).toBeLessThanOrEqual(Date.now());
      expect(log.id).toBeDefined();
    });

    it('应支持关联命令ID和用例ID', () => {
      const { addLog } = useExecutionStore.getState();

      addLog('success', '命令成功', 'cmd_123', 'case_456');

      const log = useExecutionStore.getState().logs[0];
      expect(log.commandId).toBe('cmd_123');
      expect(log.caseId).toBe('case_456');
    });

    it('clearLogs 应清空日志', () => {
      const { addLog, clearLogs } = useExecutionStore.getState();

      addLog('info', '日志1');
      addLog('info', '日志2');
      expect(useExecutionStore.getState().logs).toHaveLength(2);

      clearLogs();
      expect(useExecutionStore.getState().logs).toHaveLength(0);
    });
  });

  describe('执行状态控制', () => {
    beforeEach(() => {
      useExecutionStore.getState().initExecution('P1');
    });

    it('start 应设置运行状态', () => {
      const { start } = useExecutionStore.getState();

      start();

      const state = useExecutionStore.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(false);
    });

    it('pause 应设置暂停状态', () => {
      const { start, pause } = useExecutionStore.getState();

      start();
      pause();

      const state = useExecutionStore.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(true);
    });

    it('resume 应恢复运行', () => {
      const { start, pause, resume } = useExecutionStore.getState();

      start();
      pause();
      resume();

      const state = useExecutionStore.getState();
      expect(state.isRunning).toBe(true);
      expect(state.isPaused).toBe(false);
    });

    it('stop 应停止执行并清除当前命令', () => {
      const { start, setCurrentCommand, stop } = useExecutionStore.getState();

      start();
      setCurrentCommand('cmd_123');
      stop();

      const state = useExecutionStore.getState();
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.currentCommandId).toBeNull();
    });
  });

  describe('reset', () => {
    it('应重置所有状态', () => {
      const {
        initExecution,
        start,
        setVariable,
        addLog,
        registerGuard,
        setCurrentCommand,
        setGuardTrigger,
        reset,
      } = useExecutionStore.getState();

      // 设置一些状态
      initExecution('P2');
      start();
      setVariable('test', 'value');
      addLog('info', '日志');
      registerGuard(createGuard('g1', 'ERROR'));
      setCurrentCommand('cmd_123');
      setGuardTrigger({ guardId: 'g1', action: 'abort', triggeredAt: Date.now() });

      // 重置
      reset();

      const state = useExecutionStore.getState();
      expect(state.context).toBeNull();
      expect(state.isRunning).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.currentCommandId).toBeNull();
      expect(state.guardTrigger).toBeNull();
      expect(state.logs).toHaveLength(0);
    });
  });
});
