/**
 * 执行状态管理 (v1 递归模型)
 * - 删除 pc/instructions/idToIndex（已无需扁平化）
 * - 保留运行标志、变量池、日志
 * - 后台守护注册表（防重复注册）
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { ExecutionContext, UrcGuardCommand, UrcGuardAction } from '@/types/testCase';
import type { PortLabel } from '@/types/serial';
import { useSettingsStore } from './settingsStore';

// Enable Map/Set support in Immer
enableMapSet();

/** 守护命中通知：由 URC 监听器写入，执行引擎轮询消费 */
export interface GuardTrigger {
  guardId: string;
  action: UrcGuardAction;
  triggeredAt: number;
}

export interface ExecutionLog {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  commandId?: string;
  caseId?: string;
}

/** 关键事件：用于摘要视图，区别于详细日志 */
export interface CriticalEvent {
  id: string;
  timestamp: number;
  type: 'start' | 'progress' | 'failure' | 'guard-trigger' | 'complete' | 'variable-extracted';

  // 开始事件
  start?: {
    rootCaseName: string;
    totalRounds: number;
  };

  // 进度事件（会被刷新，不追加新行）
  progress?: {
    completed: number;
    total: number;
    success: number;
    failure: number;
    remaining: number;
  };

  // 失败事件
  failure?: {
    roundIndex: number;
    rootTestCase: {
      id: string;
      name: string;
    };
    subTestCase?: {
      id: string;
      name: string;
      path: string;
    };
    command?: {
      id: string;
      name: string;
      type: 'command' | 'urc-guard';
    };
    failureLevel: 'root' | 'sub' | 'command';
    reason: string;
    details?: string;
  };

  // 守护触发事件
  guardTrigger?: {
    guardId: string;
    pattern: string;
    action: string;
  };

  // 变量提取事件
  variableExtracted?: {
    commandId: string;
    commandName: string;
    variable: string;
    value: string;
  };

  // 完成摘要
  summary?: {
    rootCaseName: string;
    duration: number;
    totalRounds: number;
    successCount: number;
    failureCount: number;
    subCaseCount: number;
    commandCount: number;
    guardHitCount: number;
    failureList: Array<{
      round: number;
      rootCase: string;
      subCase?: string;
      command?: string;
      level: 'root' | 'sub' | 'command';
      reason: string;
    }>;
  };
}

interface ExecutionState {
  // 执行上下文（v1：无 pc/instructions）
  context: ExecutionContext | null;

  // 运行状态
  isRunning: boolean;
  isPaused: boolean;
  currentCommandId: string | null;

  // 守护触发通知（监听器→引擎单向通道）
  guardTrigger: GuardTrigger | null;

  // 执行日志（详细）
  logs: ExecutionLog[];

  // 关键事件（摘要）
  criticalEvents: CriticalEvent[];

  // Actions
  initExecution: (targetPort: PortLabel) => void;

  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;

  setVariable: (key: string, value: string) => void;
  getVariable: (key: string) => string | undefined;

  // 序列计数器管理
  resetSequenceCounters: () => void;
  updateSequenceCounter: (key: string, value: number) => void;
  getSequenceCounter: (key: string) => number | undefined;

  // 守护注册（防重复）
  registerGuard: (guard: UrcGuardCommand) => void;
  unregisterGuard: (guardId: string) => void;
  getActiveGuards: () => UrcGuardCommand[];

  // 守护触发通道
  setGuardTrigger: (trigger: GuardTrigger) => void;
  consumeGuardTrigger: () => GuardTrigger | null;

  setCurrentCommand: (commandId: string | null) => void;

  addLog: (
    level: ExecutionLog['level'],
    message: string,
    commandId?: string,
    caseId?: string,
  ) => void;
  clearLogs: () => void;

  // 关键事件管理
  addCriticalEvent: (event: CriticalEvent) => void;
  clearCriticalEvents: () => void;

  reset: () => void;
}

let logIdCounter = 0;

export const useExecutionStore = create<ExecutionState>()(
  immer((set, get) => ({
    context: null,
    isRunning: false,
    isPaused: false,
    currentCommandId: null,
    guardTrigger: null,
    logs: [],
    criticalEvents: [],

    initExecution: (targetPort) => {
      // 获取启用的全局变量
      const globalVariables = useSettingsStore.getState().getEnabledVariables();

      set((state) => {
        state.context = {
          variables: { ...globalVariables }, // 初始化时加载全局变量
          targetPort,
          startTime: Date.now(),
          activeGuards: new Map(),
          sequenceCounters: new Map(),
        };
        state.isRunning = false;
        state.isPaused = false;
        state.currentCommandId = null;
        state.guardTrigger = null;
        state.logs = [];
        state.criticalEvents = [];
      });
    },

    start: () => {
      set((state) => {
        state.isRunning = true;
        state.isPaused = false;
      });
    },

    pause: () => {
      set((state) => {
        state.isPaused = true;
      });
    },

    resume: () => {
      set((state) => {
        state.isPaused = false;
      });
    },

    stop: () => {
      set((state) => {
        state.isRunning = false;
        state.isPaused = false;
        state.currentCommandId = null;
      });
    },

    setVariable: (key, value) => {
      set((state) => {
        if (state.context) {
          state.context.variables[key] = value;
        }
      });
    },

    getVariable: (key) => {
      return get().context?.variables[key];
    },

    resetSequenceCounters: () => {
      set((state) => {
        if (state.context) {
          state.context.sequenceCounters.clear();
        }
      });
    },

    updateSequenceCounter: (key, value) => {
      set((state) => {
        if (state.context) {
          state.context.sequenceCounters.set(key, value);
        }
      });
    },

    getSequenceCounter: (key) => {
      return get().context?.sequenceCounters.get(key);
    },

    registerGuard: (guard) => {
      set((state) => {
        if (state.context && !state.context.activeGuards.has(guard.id)) {
          state.context.activeGuards.set(guard.id, guard);
        }
      });
    },

    unregisterGuard: (guardId) => {
      set((state) => {
        if (state.context) {
          state.context.activeGuards.delete(guardId);
        }
      });
    },

    getActiveGuards: () => {
      const guards = get().context?.activeGuards;
      return guards ? Array.from(guards.values()) : [];
    },

    setGuardTrigger: (trigger) => {
      set((state) => {
        state.guardTrigger = trigger;
      });
    },

    consumeGuardTrigger: () => {
      const trigger = get().guardTrigger;
      if (trigger) {
        set((state) => {
          state.guardTrigger = null;
        });
      }
      return trigger;
    },

    setCurrentCommand: (commandId) => {
      set((state) => {
        state.currentCommandId = commandId;
      });
    },

    addLog: (level, message, commandId, caseId) => {
      set((state) => {
        logIdCounter += 1;
        state.logs.unshift({
          id: `log_${Date.now()}_${logIdCounter}`,
          timestamp: Date.now(),
          level,
          message,
          commandId,
          caseId,
        });
      });
    },

    clearLogs: () => {
      set((state) => {
        state.logs = [];
      });
    },

    addCriticalEvent: (event) => {
      set((state) => {
        // 进度事件：刷新（替换上一条 progress），不追加新行
        if (event.type === 'progress') {
          const lastProgressIdx = state.criticalEvents
            .map((e) => e.type)
            .lastIndexOf('progress');
          if (lastProgressIdx >= 0) {
            state.criticalEvents[lastProgressIdx] = event;
            return;
          }
        }
        // start / failure / guard-trigger / complete：追加新行
        state.criticalEvents.push(event);
      });
    },

    clearCriticalEvents: () => {
      set((state) => {
        state.criticalEvents = [];
      });
    },

    reset: () => {
      set((state) => {
        state.context = null;
        state.isRunning = false;
        state.isPaused = false;
        state.currentCommandId = null;
        state.guardTrigger = null;
        state.logs = [];
        state.criticalEvents = [];
      });
    },
  })),
);
