/**
 * 测试执行引擎 (v1 递归模型)
 * - 递归深度优先遍历用例树
 * - 4种失败策略：continue/end-round/retry-self/abort
 * - URC 处理：异步命令用长超时的普通命令等待响应 + 后台守护监听主动上报
 * - 停止立即中断并清理状态
 */

import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { useExecutionStore } from '@/stores/executionStore';
import type { CriticalEvent } from '@/stores/executionStore';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSerialStore } from '@/stores/serialStore';
import { useSerialCommands } from './useSerialCommands';
import type {
  TestCase,
  TestCommand,
  StandardCommand,
  ScriptCommand,
  CaseStatus,
} from '@/types/testCase';
import type { PortLabel, SerialDataPayload, FileSendProgressPayload } from '@/types/serial';
import {
  isCase,
  isCommand,
  isStandardCommand,
  isUrcGuard,
  isScriptCommand,
  replaceVariables,
  textToBytes,
  appendLineEnding,
  validateResponse,
  extractVariables,
  findCase,
  findCommand,
} from '@/lib/testCaseUtils';

/** 执行结果 */
type ExecResult = 'success' | 'failed' | 'interrupted' | 'end-round';

/** 延时工具 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * 格式化字节数为人类可读格式
 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 智能解析目标端口
 * - rootCase.targetPort 为 'P1' 或 'P2'：使用配置值（用户显式指定）
 * - rootCase.targetPort 为 undefined/null：自动模式（智能解析）
 *   - 单串口：使用已连接的端口（P1 或 P2）
 *   - 双串口：跟随发送区选择（P2→P2，其余→P1）
 *   - 都未连接：默认 P1
 */
function resolveTargetPort(rootCase: TestCase, connectionStatus: { p1_connected: boolean; p2_connected: boolean }): PortLabel {
  // 如果用户显式配置了端口，使用配置值
  if ('targetPort' in rootCase && (rootCase.targetPort === 'P1' || rootCase.targetPort === 'P2')) {
    return rootCase.targetPort as PortLabel;
  }

  // 自动模式：智能解析
  const p1Connected = connectionStatus.p1_connected;
  const p2Connected = connectionStatus.p2_connected;

  // 单串口：用已连接的那个
  if (p1Connected && !p2Connected) return 'P1';
  if (!p1Connected && p2Connected) return 'P2';

  // 双串口或都未连接：读取发送区 sendTarget（localStorage）
  const sendTarget = localStorage.getItem('serial_terminal_target') as 'P1' | 'P2' | 'ALL' | null;
  if (sendTarget === 'P2' && p2Connected) return 'P2';
  // ALL / P1 / 无值：默认 P1
  return 'P1';
}

/**
 * 递归收集用例树中所有命令实际用到的端口。
 * txPort/rxPort/listenPort 未设置的按默认口计入。
 */
function collectUsedPorts(
  caseList: TestCase[],
  parentTx: PortLabel,
  parentRx: PortLabel,
  acc: Set<PortLabel> = new Set(),
): Set<PortLabel> {
  for (const c of caseList) {
    if (!c.selected) continue;
    // 端口继承级联：tx/rx 各自独立，与执行引擎 runCase 保持一致
    const caseTx: PortLabel = c.txPort ?? parentTx;
    const caseRx: PortLabel = c.rxPort ?? parentRx;
    for (const child of c.children) {
      if (isCase(child)) {
        collectUsedPorts([child], caseTx, caseRx, acc);
      } else if (isCommand(child) && child.selected) {
        if (isStandardCommand(child)) {
          acc.add(child.txPort ?? caseTx);
          acc.add(child.rxPort ?? caseRx);
        } else if (isUrcGuard(child)) {
          acc.add(child.listenPort ?? caseRx);
        }
        // 脚本命令与串口无关，不计入
      }
    }
  }
  return acc;
}

/** 生成关键事件唯一 ID */
let eventIdCounter = 0;
function generateEventId(): string {
  eventIdCounter += 1;
  return `event_${Date.now()}_${eventIdCounter}`;
}

/** 格式化时长（毫秒 → 人类可读）- 暂未使用，导出供显示组件使用 */
export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hours = Math.floor(min / 60);

  if (hours > 0) {
    return `${hours}h ${min % 60}m ${sec % 60}s`;
  } else if (min > 0) {
    return `${min}m ${sec % 60}s`;
  } else {
    return `${sec}s`;
  }
}

/** 直接发送串口数据（绕过 hook，供引擎内部调用） */
async function writeSerial(
  portLabel: PortLabel,
  data: Uint8Array,
): Promise<{ bytes_written: number; timestamp: number }> {
  // 从设置读取分包参数
  const { filePacketSize, filePacketInterval } = useSettingsStore.getState();
  return invoke('write_serial_data', {
    portLabel,
    data: Array.from(data),
    filePacketSize,
    filePacketInterval,
  });
}

export function useTestExecution() {
  const {
    initExecution,
    start,
    stop,
    setVariable,
    registerGuard,
    unregisterGuard,
    addCriticalEvent,
    consumeGuardTrigger,
  } = useExecutionStore();
  const { cases, updateCase, updateCommand } = useTestCaseStore();
  const addMessage = useTerminalStore((s) => s.addMessage);
  const { sendAttachment, attachmentExists } = useSerialCommands();

  // 执行统计（用于生成关键事件）
  const statsRef = useRef({
    rootCaseName: '',
    totalRounds: 0,
    completedRounds: 0,
    successRounds: 0,
    failureRounds: 0,
    startTime: 0,
    failureList: [] as Array<{
      round: number;
      rootCase: string;
      subCase?: string;
      command?: string;
      level: 'root' | 'sub' | 'command';
      reason: string;
    }>,
  });

  // 执行结果输出到系统日志（SYS）。
  // 只记录关键节点（开始/完成/停止/错误），详细步骤（Sent/Validation）不再输出。
  // 不弹 Toast（避免刷屏），持久留痕于状态栏系统日志，超限由 FIFO 自动清理最早条目。
  const addLog = useCallback(
    (
      level: 'info' | 'success' | 'warning' | 'error',
      message: string,
      _cmdId?: string,
      _caseId?: string,
    ) => {
      const icon =
        level === 'success' ? '✅' : level === 'error' ? '❌' : level === 'warning' ? '⚠️' : 'ℹ️';
      addMessage({
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        type: 'SYS',
        port_label: 'P1',
        data: new Uint8Array(),
        timestamp: Date.now(),
        text: `${icon} ${message}`,
      });
    },
    [addMessage],
  );

  // 实时读取执行上下文（避免闭包快照读到过期变量池）
  const getContext = () => useExecutionStore.getState().context;

  const abortRef = useRef(false);
  const pausedRef = useRef(false);
  // 最近一次命令失败原因（供失败事件记录读取）
  const lastFailureReasonRef = useRef<string>('');

  // 运行时硬件信号状态（每轮重置为连接配置的初始值，命令执行时累积修改）
  const signalLevelsRef = useRef<{
    P1: { dtr: boolean; rts: boolean };
    P2: { dtr: boolean; rts: boolean };
  }>({
    P1: { dtr: true, rts: false },
    P2: { dtr: true, rts: false },
  });

  /** 设置 DTR 引脚电平（忽略虚拟串口或未连接端口的错误） */
  const applyDtr = async (port: PortLabel, level: boolean) => {
    try {
      await invoke('set_serial_dtr', { portLabel: port, level });
    } catch (e) {
      // 忽略虚拟端口或未连接的错误
    }
  };

  /** 设置 RTS 引脚电平（忽略虚拟串口或未连接端口的错误） */
  const applyRts = async (port: PortLabel, level: boolean) => {
    try {
      await invoke('set_serial_rts', { portLabel: port, level });
    } catch (e) {
      // 忽略虚拟端口或未连接的错误
    }
  };

  /**
   * 重置信号状态为连接配置的初始值（每轮开始时调用）。
   * 差异化恢复：仅当当前跟踪电平与基线不同时才发引脚命令，
   * 避免未使用信号功能时产生多余的串口调用。
   */
  const resetSignalLevels = async () => {
    const { p1Config, p2Config } = useSerialStore.getState();
    const baseline: Record<PortLabel, { dtr: boolean; rts: boolean }> = {
      P1: { dtr: p1Config.dtr, rts: p1Config.rts },
      P2: { dtr: p2Config.dtr, rts: p2Config.rts },
    };
    for (const port of ['P1', 'P2'] as PortLabel[]) {
      const cur = signalLevelsRef.current[port];
      const base = baseline[port];
      if (cur.dtr !== base.dtr) {
        cur.dtr = base.dtr;
        await applyDtr(port, base.dtr);
      }
      if (cur.rts !== base.rts) {
        cur.rts = base.rts;
        await applyRts(port, base.rts);
      }
    }
  };

  /** 停止执行（立即中断） */
  const stopExecution = useCallback(() => {
    abortRef.current = true;
    stop();
    addLog('info', 'Execution stopped by user');

    // 清理所有运行中/挂起的命令状态为 interrupted
    const clearStatuses = (caseList: TestCase[]) => {
      for (const c of caseList) {
        if (c.status === 'running') {
          updateCase(c.id, { status: 'interrupted' });
        }
        for (const child of c.children) {
          if (isCommand(child) && child.status === 'running') {
            updateCommand(c.id, child.id, { status: 'interrupted' });
          } else if (isCase(child)) {
            clearStatuses([child]);
          }
        }
      }
    };
    clearStatuses(cases);
  }, [stop, addLog, cases, updateCase, updateCommand]);

  /** 递归重置用例树状态为 pending（避免残留上次执行的 success/failed 图标） */
  const resetCaseStatuses = useCallback(
    (caseList: TestCase[]) => {
      for (const c of caseList) {
        if (c.status !== 'pending') {
          updateCase(c.id, { status: 'pending' });
        }
        for (const child of c.children) {
          if (isCommand(child) && child.status !== 'pending') {
            updateCommand(c.id, child.id, { status: 'pending' });
          } else if (isCase(child)) {
            resetCaseStatuses([child]);
          }
        }
      }
    },
    [updateCase, updateCommand],
  );

  /** 执行单条命令（处理 repeatCount + successThreshold） */
  const runCommand = useCallback(
    async (cmd: TestCommand, caseId: string, caseTx: PortLabel, caseRx: PortLabel): Promise<ExecResult> => {
      if (!getContext()) return 'interrupted';

      // 标准命令
      if (isStandardCommand(cmd)) {
        return await runStandardCommand(cmd, caseId, caseTx, caseRx);
      }

      // URC 后台守护（注册后立即返回成功，不阻塞）
      // 内联守护默认监听所属用例的接收口
      if (isUrcGuard(cmd)) {
        registerGuard({ ...cmd, listenPort: cmd.listenPort ?? caseRx });
        addLog('info', `Registered background guard: ${cmd.pattern}`, cmd.id, caseId);
        updateCommand(caseId, cmd.id, { status: 'success' });
        return 'success';
      }

      // 脚本命令
      if (isScriptCommand(cmd)) {
        return await runScriptCommand(cmd, caseId);
      }

      return 'success';
    },
    [registerGuard, addLog, updateCommand],
  );

  /**
   * 执行脚本命令：调用外部脚本，按退出码判定成败
   * - 参数支持 ${变量} 替换
   * - stdout/stderr 记入日志
   * - 退出码 0=成功，非 0=失败
   */
  const runScriptCommand = useCallback(
    async (cmd: ScriptCommand, caseId: string): Promise<ExecResult> => {
      const ctx = getContext();
      if (!ctx) return 'interrupted';

      updateCommand(caseId, cmd.id, { status: 'running' });

      // 命令字符串变量替换
      const replaceResult = replaceVariables(cmd.command, ctx.variables, ctx.sequenceCounters, true);
      const resolvedCommand = replaceResult.text;

      // 更新序列计数器（通过 store action）
      replaceResult.counterUpdates.forEach(({ key, value }) => {
        useExecutionStore.getState().updateSequenceCounter(key, value);
      });

      addLog('info', `Executing in ${cmd.scriptPath}: ${resolvedCommand}`, cmd.id, caseId);

      try {
        const result = await invoke<{
          exit_code: number;
          stdout: string;
          stderr: string;
          success: boolean;
          error?: string;
        }>('execute_script', {
          scriptPath: cmd.scriptPath,
          command: resolvedCommand,
          timeoutMs: cmd.timeout,
        });

        // 记录脚本输出
        if (result.stdout.trim()) {
          addLog('info', `[stdout] ${result.stdout.trim()}`, cmd.id, caseId);
        }
        if (result.stderr.trim()) {
          addLog('warning', `[stderr] ${result.stderr.trim()}`, cmd.id, caseId);
        }

        // 命令延时
        if (cmd.delay > 0) await sleep(cmd.delay);

        if (result.success) {
          updateCommand(caseId, cmd.id, { status: 'success' });
          return 'success';
        }

        // 脚本失败
        lastFailureReasonRef.current = `Script exit code ${result.exit_code}`;
        addLog('error', `Script failed: exit code ${result.exit_code}`, cmd.id, caseId);
        updateCommand(caseId, cmd.id, { status: 'failed' });
        return 'failed';
      } catch (err) {
        // 执行异常（脚本不存在/超时/启动失败）
        lastFailureReasonRef.current = `Script error: ${err}`;
        addLog('error', `Script execution error: ${err}`, cmd.id, caseId);
        updateCommand(caseId, cmd.id, { status: 'failed' });
        return 'failed';
      }
    },
    [addLog, updateCommand],
  );

  /**
   * 在超时窗口内累积串口响应
   * @param onReady  监听器注册完成后触发（此时才发送命令，消除"发送早于监听"的竞态）
   * @param matchCheck 每次收到数据检查一次，返回 true 则立即 resolve（无需等满超时）
   */
  const waitForResponse = useCallback(
    async (
      targetPort: PortLabel,
      timeout: number,
      onReady?: () => void | Promise<void>,
      matchCheck?: (buffer: string) => boolean,
    ): Promise<string> => {
      return new Promise((resolve) => {
        let buffer = '';
        let unlisten: (() => void) | null = null;
        let timeoutHandle: NodeJS.Timeout | null = null;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (unlisten) unlisten();
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(buffer);
        };

        // 超时处理：等满超时后返回已累积的全部数据
        timeoutHandle = setTimeout(finish, timeout);

        const decoder = new TextDecoder('utf-8', { fatal: false });

        // 先注册监听器，注册完成后再触发 onReady（发送命令）
        listen<SerialDataPayload>('serial_data', (event) => {
          const { port_label, data } = event.payload;
          if (port_label !== targetPort) return;

          buffer += decoder.decode(new Uint8Array(data), { stream: true });

          // 超时窗口内累积匹配：一旦命中期望内容立即返回
          if (matchCheck && matchCheck(buffer)) {
            finish();
          }
        }).then((fn) => {
          unlisten = fn;
          if (settled) {
            // 极端情况：超时已先触发，直接注销
            fn();
            return;
          }
          // 监听器就绪，安全发送命令
          if (onReady) Promise.resolve(onReady()).catch(() => {});
        });
      });
    },
    [],
  );

  /** 执行标准命令（含 repeatCount + successThreshold + 响应等待） */
  const runStandardCommand = useCallback(
    async (cmd: StandardCommand, caseId: string, caseTx: PortLabel, caseRx: PortLabel): Promise<ExecResult> => {
      if (abortRef.current) return 'interrupted';

      // 双串口路由：命令 txPort/rxPort 未设置则继承用例有效收发口
      const txPort: PortLabel = cmd.txPort ?? caseTx;
      const rxPort: PortLabel = cmd.rxPort ?? caseRx;

      // 应用硬件信号覆盖（DTR/RTS 作用于发送口，累积生效）
      if (cmd.advancedConfig?.dtr) {
        const level = cmd.advancedConfig.dtr === 'high' ? true : cmd.advancedConfig.dtr === 'low' ? false : signalLevelsRef.current[txPort].dtr;
        if (level !== signalLevelsRef.current[txPort].dtr) {
          signalLevelsRef.current[txPort].dtr = level;
          await applyDtr(txPort, level);
        }
      }
      if (cmd.advancedConfig?.rts) {
        const level = cmd.advancedConfig.rts === 'high' ? true : cmd.advancedConfig.rts === 'low' ? false : signalLevelsRef.current[txPort].rts;
        if (level !== signalLevelsRef.current[txPort].rts) {
          signalLevelsRef.current[txPort].rts = level;
          await applyRts(txPort, level);
        }
      }

      updateCommand(caseId, cmd.id, { status: 'running' });

      let successCount = 0;

      for (let attempt = 0; attempt < cmd.repeatCount; attempt++) {
        if (abortRef.current) {
          updateCommand(caseId, cmd.id, { status: 'interrupted' });
          return 'interrupted';
        }

        // 等待暂停
        while (pausedRef.current && !abortRef.current) {
          await sleep(100);
        }

        // 判断是文件发送还是普通命令
        if (cmd.fileData) {
          // ============ 文件发送模式 ============
          let sendError: unknown = null;
          try {
            if (cmd.fileData.id) {
              // 新模式：从缓存文件流式发送
              // 先检查附件是否存在
              const exists = await attachmentExists(cmd.fileData.id);
              if (!exists) {
                throw new Error(i18n.t('testCase.attachmentMissing', { name: cmd.fileData.name }));
              }

              const { name, size, id } = cmd.fileData;

              // 开始 TX 消息
              addMessage({
                id: `file-start-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'TX',
                port_label: txPort,
                data: new Uint8Array(),
                timestamp: Date.now(),
                text: i18n.t('terminal.fileSendStart', { name, size: formatBytes(size) }),
              });

              // 订阅进度事件，等待完成
              const startTs = performance.now();
              let lastSent = 0;
              const finished = await new Promise<{ cancelled: boolean; sent: number }>((resolve) => {
                let unlistenFn: (() => void) | null = null;
                void listen<FileSendProgressPayload>('file_send_progress', (evt) => {
                  const p = evt.payload;
                  if (p.port_label !== txPort) return;
                  lastSent = p.sent_bytes;
                  if (p.done || p.cancelled) {
                    if (unlistenFn) unlistenFn();
                    resolve({ cancelled: p.cancelled, sent: p.sent_bytes });
                  }
                }).then((fn) => { unlistenFn = fn; });

                // 触发后端流式发送
                void sendAttachment(txPort, id).catch((e) => {
                  if (unlistenFn) unlistenFn();
                  resolve({ cancelled: true, sent: lastSent });
                  throw e;
                });
              });

              // 结束 TX 消息
              const elapsedSec = (performance.now() - startTs) / 1000;
              if (finished.cancelled) {
                addMessage({
                  id: `file-cancel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  type: 'TX',
                  port_label: txPort,
                  data: new Uint8Array(),
                  timestamp: Date.now(),
                  text: i18n.t('terminal.fileSendCancelled', {
                    name,
                    sent: formatBytes(finished.sent),
                    total: formatBytes(size),
                  }),
                });
                throw new Error('File send cancelled');
              } else {
                const avgBps = elapsedSec > 0 ? size / elapsedSec : 0;
                addMessage({
                  id: `file-summary-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  type: 'TX',
                  port_label: txPort,
                  data: new Uint8Array(),
                  timestamp: Date.now(),
                  text: i18n.t('terminal.fileSentV2', {
                    name,
                    sent: formatBytes(finished.sent),
                    total: formatBytes(size),
                    elapsed: elapsedSec.toFixed(1),
                    rate: formatBytes(avgBps),
                  }),
                });
              }


            } else if (cmd.fileData.base64) {
              // 旧模式兼容：前端解码 base64 → 按 filePacketSize 分包 → 逐包发送
              const fileBytes = Uint8Array.from(atob(cmd.fileData.base64), (c) => c.charCodeAt(0));

              // 从设置中读取分包参数
              const { filePacketSize, filePacketInterval } = useSettingsStore.getState();
              const chunkSize = filePacketSize > 0 ? filePacketSize : fileBytes.length;

              // 分包发送
              for (let i = 0; i < fileBytes.length; i += chunkSize) {
                if (abortRef.current) {
                  updateCommand(caseId, cmd.id, { status: 'interrupted' });
                  return 'interrupted';
                }

                const chunk = fileBytes.slice(i, i + chunkSize);

                // 乐观渲染：先显示 TX 再发送
                const txTimestamp = Date.now();
                addMessage({
                  id: `tx_${txTimestamp}_${i}`,
                  type: 'TX',
                  port_label: txPort,
                  data: chunk,
                  timestamp: txTimestamp,
                  text: `[File ${cmd.fileData.name} chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(fileBytes.length / chunkSize)}]`,
                });

                await writeSerial(txPort, chunk);

                // 包间延时（最后一包无需等待）
                if (i + chunkSize < fileBytes.length && filePacketInterval > 0) {
                  await sleep(filePacketInterval);
                }
              }
            } else {
              throw new Error('Invalid fileData: neither id nor base64 present');
            }

            // 记录文件发送完成事件
            addCriticalEvent({
              id: generateEventId(),
              timestamp: Date.now(),
              type: 'variable-extracted',
              variableExtracted: {
                commandId: cmd.id,
                commandName: `File sent: ${cmd.fileData.name}`,
                variable: 'file_size',
                value: String(cmd.fileData.size),
              },
            });
          } catch (error) {
            sendError = error;
            addLog('error', `File send failed: ${error}`, cmd.id, caseId);
          }

          // 文件发送后仍需等待响应校验（如 +QFUPL: xxx）
          if (sendError) {
            updateCommand(caseId, cmd.id, { status: 'failed' });
            lastFailureReasonRef.current = `File send failed: ${sendError}`;
            return 'failed';
          }

          // 校验响应（复用普通命令的响应逻辑）
          if (cmd.validation === 'none') {
            successCount++;
          } else {
            const response = await waitForResponse(
              rxPort,
              cmd.timeout,
              async () => {}, // 文件已发送，无需再次发送
              (buf) =>
                validateResponse(buf, cmd.validation, cmd.validationPattern, cmd.validationMode)
                  .valid,
            );

            const result = validateResponse(
              response,
              cmd.validation,
              cmd.validationPattern,
              cmd.validationMode,
            );

            if (result.valid) {
              successCount++;

              // 提取变量
              if (cmd.extractConfig && getContext()) {
                const vars = extractVariables(response, cmd.extractConfig);
                for (const [key, value] of Object.entries(vars)) {
                  setVariable(key, value);
                  addCriticalEvent({
                    id: generateEventId(),
                    timestamp: Date.now(),
                    type: 'variable-extracted',
                    variableExtracted: {
                      commandId: cmd.id,
                      commandName: cmd.content,
                      variable: key,
                      value,
                    },
                  });
                }
              }
            } else {
              lastFailureReasonRef.current = `Validation failed (timeout ${cmd.timeout}ms)`;
            }
          }
        } else {
          // ============ 普通命令模式（现有逻辑） ============
          // 变量替换
          const replaceResult = replaceVariables(
            cmd.content,
            getContext()?.variables || {},
            getContext()?.sequenceCounters,
            true
          );
          const content = replaceResult.text;

          // 更新序列计数器
          replaceResult.counterUpdates.forEach(({ key, value }) => {
            useExecutionStore.getState().updateSequenceCounter(key, value);
          });

          const fullContent = appendLineEnding(content, cmd.lineEnding);
          const data = textToBytes(fullContent, cmd.dataFormat);

          // 发送并回显（供 onReady 或直接调用）
          let sendError: unknown = null;
          const sendCommand = async () => {
            try {
              // 乐观渲染：立即显示 TX
              const txTimestamp = Date.now();
              addMessage({
                id: `tx_${txTimestamp}`,
                type: 'TX',
                port_label: txPort,
                data,
                timestamp: txTimestamp,
                text: new TextDecoder().decode(data),
              });

              // 后台发送
              await writeSerial(txPort, data);
              // 不再记录详细日志：addLog('info', `Sent: ${content}`, cmd.id, caseId);
            } catch (error) {
              sendError = error;
              // 发送失败仍然记录
              addLog('error', `Send failed: ${error}`, cmd.id, caseId);
            }
          };

          // 校验响应
          if (cmd.validation === 'none') {
            // 无需响应，直接发送
            await sendCommand();
            if (sendError) {
              updateCommand(caseId, cmd.id, { status: 'failed' });
              return 'failed';
            }
            successCount++;
          } else {
            // 先注册监听器 → 就绪后发送 → 超时窗口内累积匹配（消除竞态、支持多行累积）
            const response = await waitForResponse(
              rxPort,
              cmd.timeout,
              sendCommand,
              (buf) =>
                validateResponse(buf, cmd.validation, cmd.validationPattern, cmd.validationMode)
                  .valid,
            );

            if (sendError) {
              updateCommand(caseId, cmd.id, { status: 'failed' });
              lastFailureReasonRef.current = `Send failed: ${sendError}`;
              return 'failed';
            }

            const result = validateResponse(
              response,
              cmd.validation,
              cmd.validationPattern,
              cmd.validationMode,
            );

            if (result.valid) {
              successCount++;
              // 不再记录详细验证日志

              // 提取变量并作为关键事件记录
              if (cmd.extractConfig && getContext()) {
                const vars = extractVariables(response, cmd.extractConfig);
                for (const [key, value] of Object.entries(vars)) {
                  setVariable(key, value);
                  // 变量提取作为关键事件
                  addCriticalEvent({
                    id: generateEventId(),
                    timestamp: Date.now(),
                    type: 'variable-extracted',
                    variableExtracted: {
                      commandId: cmd.id,
                      commandName: cmd.content,
                      variable: key,
                      value,
                    },
                  });
                }
              }
            } else {
              // 不再记录详细验证失败日志
              lastFailureReasonRef.current = `Validation failed (timeout ${cmd.timeout}ms)`;
            }
          }
        }

        // 达标即停
        if (cmd.stopWhenReached && successCount >= cmd.successThreshold) {
          break;
        }

        // 重试间隔（复用命令延时）
        if (attempt < cmd.repeatCount - 1) {
          await sleep(cmd.delay);
        }
      }

      // 判定最终结果
      const finalSuccess = successCount >= cmd.successThreshold;
      updateCommand(caseId, cmd.id, { status: finalSuccess ? 'success' : 'failed' });

      if (finalSuccess) {
        await sleep(cmd.delay);
        return 'success';
      } else {
        if (!lastFailureReasonRef.current) {
          lastFailureReasonRef.current = `Failed to reach success threshold (${successCount}/${cmd.successThreshold})`;
        }
        return 'failed';
      }
    },
    [abortRef, pausedRef, updateCommand, addLog, setVariable, addMessage, waitForResponse, addCriticalEvent],
  );

  /** 执行 URC 内联等待（阻塞等待匹配或超时） */
  /** 递归执行用例（深度优先 + runCount + 失败策略） */
  const runCase = useCallback(
    async (
      testCase: TestCase,
      parentTx: PortLabel,
      parentRx: PortLabel,
      _parentId: string | null = null,
    ): Promise<ExecResult> => {
      if (abortRef.current) return 'interrupted';
      if (!testCase.selected) {
        updateCase(testCase.id, { status: 'skipped' });
        return 'success'; // 未勾选视为成功（不阻断流程）
      }

      // 端口继承级联：tx/rx 各自独立继承父级
      const caseTx: PortLabel = testCase.txPort ?? parentTx;
      const caseRx: PortLabel = testCase.rxPort ?? parentRx;

      // 注册本用例的守护（case级，仅注册一次）
      // 未显式设置 listenPort 的，注册时解析为本用例有效口，保证继承
      const caseGuards = testCase.children.filter(isCommand).filter(isUrcGuard).filter((g) => g.scope === 'case');
      for (const guard of caseGuards) {
        registerGuard({ ...guard, listenPort: guard.listenPort ?? caseRx });
      }

      let finalResult: ExecResult = 'success';
      let selfRetries = 0;

      // retry-self 循环
      while (selfRetries <= (testCase.maxSelfRetries ?? 1)) {
        updateCase(testCase.id, { status: 'running' });

        let roundFailed = false;

        // runCount 循环
        for (let round = 0; round < testCase.runCount; round++) {
          if (abortRef.current) {
            finalResult = 'interrupted';
            break;
          }

          // 每个用例每轮开始：重置序列计数器（使子用例循环中的序列独立计数）
          useExecutionStore.getState().resetSequenceCounters();

          // 根用例每轮开始：重置硬件信号为连接配置初始值（粘滞继承的锚点）
          if (_parentId === null) {
            await resetSignalLevels();
          }

          // 遍历子项（下标驱动，支持跳转）
          let childIndex = 0;
          while (childIndex < testCase.children.length) {
            if (abortRef.current) {
              finalResult = 'interrupted';
              break;
            }

            // 暂停检测
            while (pausedRef.current && !abortRef.current) {
              await sleep(100);
            }

            const child = testCase.children[childIndex];
            let childResult: ExecResult;

            if (isCase(child)) {
              // 递归执行子用例（传本用例有效收发口作为其父级默认口）
              childResult = await runCase(child, caseTx, caseRx, testCase.id);
            } else if (isCommand(child)) {
              // 跳过未勾选的命令
              if (!child.selected) {
                updateCommand(testCase.id, child.id, { status: 'skipped' });
                childIndex++;
                continue;
              }

              // 跳过守护（守护已注册，不阻塞）
              if (isUrcGuard(child)) {
                childIndex++;
                continue;
              }

              // 执行命令（传本用例有效收发口作为命令默认口）
              childResult = await runCommand(child, testCase.id, caseTx, caseRx);
            } else {
              childIndex++;
              continue;
            }

            // === 命令边界：消费守护触发 ===
            const trigger = consumeGuardTrigger();
            if (trigger) {
              const ctx = getContext();
              const triggeredGuard = ctx?.activeGuards.get(trigger.guardId);

              // 发出守护触发关键事件
              if (triggeredGuard) {
                addCriticalEvent({
                  id: generateEventId(),
                  timestamp: trigger.triggeredAt,
                  type: 'guard-trigger',
                  guardTrigger: {
                    guardId: trigger.guardId,
                    pattern: triggeredGuard.pattern,
                    action: trigger.action,
                  },
                });
              }

              // 处理守护动作
              if (trigger.action === 'abort') {
                finalResult = 'failed';
                addLog('warning', `URC guard triggered: abort execution (guard: ${trigger.guardId})`);
                break;
              } else if (trigger.action === 'restart-round') {
                addLog('info', `URC guard triggered: restart current round (guard: ${trigger.guardId})`);
                childIndex = 0; // 重置到本轮开头
                continue;
              } else if (trigger.action === 'fail-current') {
                addLog('warning', `URC guard triggered: fail current round (guard: ${trigger.guardId})`);
                roundFailed = true;
                break;
              } else if (trigger.action === 'jump-to') {
                // 跳转：目标以 id 引用，运行时解析为同用例内下标（存活于重排/删除）
                const targetId = triggeredGuard?.jumpTargetId;
                const jumpMode = triggeredGuard?.jumpMode ?? 'goto';
                const targetIndex = targetId
                  ? testCase.children.findIndex(
                      (c) => isCommand(c) && !isUrcGuard(c) && c.id === targetId,
                    )
                  : -1;

                if (targetIndex < 0) {
                  // 目标失效（未配置/已删除/非可执行命令）→ 兜底：不跳转，正常继续
                  addLog('warning', `URC guard jump target not found, continue normally (guard: ${trigger.guardId})`);
                } else if (jumpMode === 'call') {
                  // call：跑完目标单条命令（含校验/等待），忽略其成功后动作，回原位继续
                  const target = testCase.children[targetIndex] as StandardCommand | ScriptCommand;
                  addLog('info', `URC guard jump (call) → ${target.content || target.id} (guard: ${trigger.guardId})`);
                  await runCommand(target, testCase.id, caseTx, caseRx);
                  // 不采用目标的成功/失败动作，直接回到触发命令的下一条（正常 fall-through）
                } else {
                  // goto：直接跳转，不返回
                  const target = testCase.children[targetIndex] as StandardCommand | ScriptCommand;
                  addLog('info', `URC guard jump (goto) → ${target.content || target.id} (guard: ${trigger.guardId})`);
                  childIndex = targetIndex;
                  continue;
                }
              } else if (trigger.action === 'capture-only' || trigger.action === 'log-only') {
                // 不影响控制流，仅记录
                addLog('info', `URC guard triggered: ${trigger.action} (guard: ${trigger.guardId})`);
              }
            }

            // 处理子项失败
            if (childResult === 'failed') {
              const onFailure = isCommand(child) ? child.onFailure : child.onFailure;

              // 仅在标准命令失败的最内层记录，避免子用例向上传播时重复记录
              if (isCommand(child) && isStandardCommand(child)) {
                const roundIndex = statsRef.current.completedRounds + 1;
                const reason = lastFailureReasonRef.current || 'Execution failed';
                const rootName = statsRef.current.rootCaseName || testCase.name;
                const rootId = cases[0]?.id ?? testCase.id;
                // 当前用例非根用例时，它是子用例
                const subTestCase = _parentId !== null
                  ? { id: testCase.id, name: testCase.name, path: testCase.name }
                  : undefined;
                const failureEvent: CriticalEvent = {
                  id: generateEventId(),
                  timestamp: Date.now(),
                  type: 'failure',
                  failure: {
                    roundIndex,
                    rootTestCase: { id: rootId, name: rootName },
                    subTestCase,
                    command: {
                      id: child.id,
                      name: child.content,
                      type: 'command',
                    },
                    failureLevel: 'command',
                    reason,
                  },
                };
                addCriticalEvent(failureEvent);
                statsRef.current.failureList.push({
                  round: roundIndex,
                  rootCase: rootName,
                  subCase: subTestCase?.name,
                  command: child.content,
                  level: 'command',
                  reason,
                });
                lastFailureReasonRef.current = ''; // 消费后清空
              }

              if (onFailure === 'continue') {
                // 继续下一个子项
                childIndex++;
                continue;
              } else if (onFailure === 'end-round') {
                // 结束本轮，进入下一轮（若有）
                roundFailed = true;
                break;
              } else if (onFailure === 'goto' && isCommand(child) && isStandardCommand(child)) {
                // 失败跳转：按 id → 同用例下标解析，不回到跳转前位置，按目标命令继续
                const targetId = child.gotoTargetId;
                const targetIndex = targetId
                  ? testCase.children.findIndex(
                      (c) => isCommand(c) && !isUrcGuard(c) && c.id === targetId,
                    )
                  : -1;
                if (targetIndex < 0) {
                  // 目标失效 → 兜底：不跳转，正常继续下一条
                  addLog('warning', `Command failure goto target not found, continue normally: ${child.content}`);
                  childIndex++;
                  continue;
                }
                const target = testCase.children[targetIndex] as StandardCommand | ScriptCommand;
                addLog('info', `Command failed, goto → ${target.content || target.id}: ${child.content}`);
                childIndex = targetIndex;
                continue;
              } else if (onFailure === 'retry-self' && isCase(child)) {
                // 用例级 retry-self：重头来（但这是在子用例内部，已由递归处理）
                // 这里不需要额外处理，子用例自己会重试
              } else if (onFailure === 'abort') {
                finalResult = 'failed';
                break;
              }
            } else if (childResult === 'interrupted') {
              finalResult = 'interrupted';
              break;
            } else if (childResult === 'end-round') {
              roundFailed = true;
              break;
            }

            // 正常情况下，推进到下一个子项
            childIndex++;
          }

          // 根用例：每轮结束更新统计与进度事件（进度刷新，不追加新行）
          if (_parentId === null && !abortRef.current) {
            const roundSucceeded = !roundFailed && finalResult !== 'failed';
            statsRef.current.completedRounds += 1;
            if (roundSucceeded) {
              statsRef.current.successRounds += 1;
            } else {
              statsRef.current.failureRounds += 1;
            }

            const total = statsRef.current.totalRounds;
            const completed = statsRef.current.completedRounds;
            // 智能间隔：每完成 10% 或至少每 N 轮刷新一次，末轮必刷新
            const interval = Math.max(1, Math.floor(total / 10));
            if (completed % interval === 0 || completed >= total) {
              addCriticalEvent({
                id: generateEventId(),
                timestamp: Date.now(),
                type: 'progress',
                progress: {
                  completed,
                  total,
                  success: statsRef.current.successRounds,
                  failure: statsRef.current.failureRounds,
                  remaining: Math.max(0, total - completed),
                },
              });
            }
          }

          if (finalResult === 'interrupted' || finalResult === 'failed') {
            break;
          }

          // 本轮失败 + 用例失败策略
          if (roundFailed) {
            if (testCase.onFailure === 'continue') {
              // 记录失败，继续下一轮
              roundFailed = false;
              continue;
            } else if (testCase.onFailure === 'end-round') {
              // 无意义（已是轮级别），直接结束循环
              finalResult = 'end-round';
              break;
            } else if (testCase.onFailure === 'retry-self') {
              // 重头执行本用例（退出 runCount，进入外层 retry 循环）
              finalResult = 'failed'; // 标记失败，触发 retry
              break;
            } else if (testCase.onFailure === 'abort') {
              finalResult = 'failed';
              break;
            }
          }
        }

        // retry-self 处理
        if (finalResult === 'failed' && testCase.onFailure === 'retry-self' && selfRetries < (testCase.maxSelfRetries ?? 1)) {
          selfRetries++;
          addLog('info', `Case retry (${selfRetries}/${testCase.maxSelfRetries ?? 1}): ${testCase.name}`, undefined, testCase.id);
          finalResult = 'success'; // 重置，进入下次循环
          continue;
        }

        // 结束 retry 循环
        break;
      }

      // 注销本用例的守护
      for (const guard of caseGuards) {
        unregisterGuard(guard.id);
      }

      // 更新最终状态
      const status: CaseStatus =
        finalResult === 'success' ? 'success' :
        finalResult === 'interrupted' ? 'interrupted' : 'failed';
      updateCase(testCase.id, { status });

      return finalResult;
    },
    [
      abortRef,
      pausedRef,
      cases,
      updateCase,
      updateCommand,
      runCommand,
      registerGuard,
      unregisterGuard,
      addLog,
      addCriticalEvent,
      consumeGuardTrigger,
    ],
  );

  /** 启动执行（入口） */
  const startExecution = useCallback(
    async (targetPort?: PortLabel) => {
      const rootCase = cases[0];
      if (!rootCase) {
        addLog('error', 'No test cases, please load or create a case first');
        return;
      }

      // 验证根用例是否选中
      if (!rootCase.selected) {
        addLog('error', 'Root case not selected, right-click the root case and choose "Enable"');
        return;
      }

      // 智能解析目标端口（优先传参，其次根用例配置，最后智能选择）
      const { connectionStatus } = useSerialStore.getState();
      const effectivePort = targetPort || resolveTargetPort(rootCase, connectionStatus);

      // 收集用例树中所有用到的端口，校验连接状态
      const usedPorts = collectUsedPorts([rootCase], effectivePort, effectivePort);
      const disconnectedPorts: PortLabel[] = [];
      for (const port of usedPorts) {
        const connected = port === 'P1' ? connectionStatus.p1_connected : connectionStatus.p2_connected;
        if (!connected) disconnectedPorts.push(port);
      }
      if (disconnectedPorts.length > 0) {
        addLog('error', `Required ports not connected: ${disconnectedPorts.join(', ')}. Please connect them before starting execution.`);
        return;
      }

      // 重置所有状态为 pending（清空上次执行残留的图标）
      resetCaseStatuses([rootCase]);

      // 如果 context 未初始化（或目标端口变了），重新初始化
      const ctx = getContext();
      if (!ctx || ctx.targetPort !== effectivePort) {
        initExecution(effectivePort);
        addLog('info', `Initialize execution context, target port: ${effectivePort}`);
      }

      abortRef.current = false;
      pausedRef.current = false;
      start();

      addLog('info', `Start execution: ${rootCase.name}`);

      // 初始化执行统计
      statsRef.current = {
        rootCaseName: rootCase.name,
        totalRounds: rootCase.runCount,
        completedRounds: 0,
        successRounds: 0,
        failureRounds: 0,
        startTime: Date.now(),
        failureList: [],
      };

      // 添加开始事件
      addCriticalEvent({
        id: generateEventId(),
        timestamp: Date.now(),
        type: 'start',
        start: {
          rootCaseName: rootCase.name,
          totalRounds: rootCase.runCount,
        },
      });

      // 根用例有效收发口 = 根用例 txPort/rxPort（若设置）或解析的目标口
      const rootTx: PortLabel = rootCase.txPort ?? effectivePort;
      const rootRx: PortLabel = rootCase.rxPort ?? effectivePort;

      // 注册根级守护（全程监听），默认监听根接收口
      const rootGuards = rootCase.children.filter(isCommand).filter(isUrcGuard).filter((g) => g.scope === 'root');
      for (const guard of rootGuards) {
        registerGuard({ ...guard, listenPort: guard.listenPort ?? rootRx });
      }

      try {
        const result = await runCase(rootCase, rootTx, rootRx, null);

        const duration = Date.now() - statsRef.current.startTime;

        if (result === 'success') {
          addLog('success', 'Execution completed');
        } else if (result === 'interrupted') {
          addLog('warning', 'Execution interrupted');
        } else {
          addLog('error', 'Execution failed');
        }

        // 添加完成事件
        addCriticalEvent({
          id: generateEventId(),
          timestamp: Date.now(),
          type: 'complete',
          summary: {
            rootCaseName: rootCase.name,
            duration,
            totalRounds: statsRef.current.totalRounds,
            successCount: statsRef.current.successRounds,
            failureCount: statsRef.current.failureRounds,
            subCaseCount: 0, // TODO: 需要在执行时统计
            commandCount: 0, // TODO: 需要在执行时统计
            guardHitCount: 0, // TODO: 需要在守护触发时统计
            failureList: statsRef.current.failureList,
          },
        });
      } catch (error) {
        addLog('error', `Execution error: ${error}`);
      } finally {
        // 注销根级守护
        for (const guard of rootGuards) {
          unregisterGuard(guard.id);
        }

        stop();
      }
    },
    [cases, initExecution, abortRef, pausedRef, start, stop, addLog, addCriticalEvent, registerGuard, unregisterGuard, runCase],
  );

  /** 暂停执行 */
  const pauseExecution = useCallback(() => {
    pausedRef.current = true;
    useExecutionStore.getState().pause();
    addLog('info', 'Execution paused');
  }, [addLog]);

  /** 恢复执行 */
  const resumeExecution = useCallback(() => {
    pausedRef.current = false;
    useExecutionStore.getState().resume();
    addLog('info', 'Execution resumed');
  }, [addLog]);

  /** 运行单个用例（不递归到父级，独立执行） */
  const runSingleCase = useCallback(
    async (caseId: string, targetPort?: PortLabel) => {
      const targetCase = findCase(cases, caseId);
      if (!targetCase) {
        addLog('error', `Case not found: ${caseId}`);
        return;
      }

      // 智能解析目标端口
      const { connectionStatus } = useSerialStore.getState();
      const rootCase = cases[0];
      const effectivePort = targetPort || (rootCase ? resolveTargetPort(rootCase, connectionStatus) : 'P1');

      // 清理所有用例的状态（避免之前运行的用例状态残留）
      if (rootCase) {
        resetCaseStatuses([rootCase]);
      }

      // 初始化上下文
      const ctx = getContext();
      if (!ctx || ctx.targetPort !== effectivePort) {
        initExecution(effectivePort);
        addLog('info', `Initialize execution context, target port: ${effectivePort}`);
      }

      abortRef.current = false;
      pausedRef.current = false;
      start();

      addLog('info', `Run single case: ${targetCase.name}`);

      try {
        const result = await runCase(targetCase, effectivePort, effectivePort, null);
        if (result === 'success') {
          addLog('success', 'Case execution completed');
        } else if (result === 'interrupted') {
          addLog('warning', 'Case execution interrupted');
        } else {
          addLog('error', 'Case execution failed');
        }
      } catch (error) {
        addLog('error', `Case execution error: ${error}`);
      } finally {
        stop();
      }
    },
    [cases, initExecution, start, stop, addLog, runCase, resetCaseStatuses],
  );

  /** 运行单个命令（包装为临时用例执行） */
  const runSingleCommand = useCallback(
    async (caseId: string, commandId: string, targetPort?: PortLabel) => {
      const found = findCommand(cases, commandId);
      if (!found) {
        addLog('error', `Command not found: ${commandId}`);
        return;
      }

      // 智能解析目标端口
      const { connectionStatus } = useSerialStore.getState();
      const rootCase = cases[0];
      const effectivePort = targetPort || (rootCase ? resolveTargetPort(rootCase, connectionStatus) : 'P1');

      // 检查目标端口连接状态
      const isConnected = effectivePort === 'P1' ? connectionStatus.p1_connected : connectionStatus.p2_connected;
      if (!isConnected) {
        toast.error(i18n.t('terminal.portNotConnected', { port: effectivePort }));
        return;
      }

      // 重置该命令状态为 pending
      if (found.command.status !== 'pending') {
        updateCommand(caseId, commandId, { status: 'pending' });
      }

      // 初始化上下文
      const ctx = getContext();
      if (!ctx || ctx.targetPort !== effectivePort) {
        initExecution(effectivePort);
        addLog('info', `Initialize execution context, target port: ${effectivePort}`);
      } else {
        // 上下文已存在，刷新全局变量以获取最新值
        useExecutionStore.getState().refreshGlobalVariables();
        addLog('info', `Refreshed global variables for single command execution`);
      }

      abortRef.current = false;
      pausedRef.current = false;
      start();

      const cmdLabel = isStandardCommand(found.command)
        ? found.command.content
        : isScriptCommand(found.command)
          ? found.command.scriptPath
          : found.command.pattern;
      addLog('info', `Run single command: ${cmdLabel}`);

      try {
        const result = await runCommand(found.command, caseId, effectivePort, effectivePort);
        if (result === 'success') {
          addLog('success', 'Command execution completed');
        } else if (result === 'interrupted') {
          addLog('warning', 'Command execution interrupted');
        } else {
          addLog('error', 'Command execution failed');
        }
      } catch (error) {
        addLog('error', `Command execution error: ${error}`);
      } finally {
        stop();
      }
    },
    [cases, initExecution, start, stop, addLog, runCommand],
  );

  /**
   * 快速发送命令（裸发送模式）
   * - 用于树形区行右侧运行按钮的"点射"语义
   * - 忽略所有配置：不等命令延时、不校验响应、不重复、不提取变量、不更新状态
   * - 文件仍按分包设置发送，内容追加行结束符
   */
  const quickSendCommand = useCallback(
    async (cmd: StandardCommand, targetPort?: PortLabel) => {
      // 智能解析目标端口
      const { connectionStatus } = useSerialStore.getState();
      const rootCase = cases[0];
      const effectivePort = targetPort || (rootCase ? resolveTargetPort(rootCase, connectionStatus) : 'P1');

      // 检查目标端口连接状态
      const isConnected = effectivePort === 'P1' ? connectionStatus.p1_connected : connectionStatus.p2_connected;
      if (!isConnected) {
        toast.error(i18n.t('terminal.portNotConnected', { port: effectivePort }));
        return;
      }

      // 确保执行上下文存在，并刷新全局变量
      const ctx = getContext();
      if (!ctx || ctx.targetPort !== effectivePort) {
        initExecution(effectivePort);
      } else {
        // 上下文已存在，刷新全局变量以获取最新值
        useExecutionStore.getState().refreshGlobalVariables();
      }

      try {
        if (cmd.fileData) {
          // ============ 文件快速发送 ============
          if (cmd.fileData.id) {
            // 新模式：从缓存文件流式发送
            const exists = await attachmentExists(cmd.fileData.id);
            if (!exists) {
              throw new Error(i18n.t('testCase.attachmentMissing', { name: cmd.fileData.name }));
            }

            const { name, size, id } = cmd.fileData;

            // 开始 TX 消息
            addMessage({
              id: `file-start-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'TX',
              port_label: effectivePort,
              data: new Uint8Array(),
              timestamp: Date.now(),
              text: i18n.t('terminal.fileSendStart', { name, size: formatBytes(size) }),
            });

            // 订阅进度事件，等待完成
            const startTs = performance.now();
            let lastSent = 0;
            const finished = await new Promise<{ cancelled: boolean; sent: number }>((resolve) => {
              let unlistenFn: (() => void) | null = null;
              void listen<FileSendProgressPayload>('file_send_progress', (evt) => {
                const p = evt.payload;
                if (p.port_label !== effectivePort) return;
                lastSent = p.sent_bytes;
                if (p.done || p.cancelled) {
                  if (unlistenFn) unlistenFn();
                  resolve({ cancelled: p.cancelled, sent: p.sent_bytes });
                }
              }).then((fn) => { unlistenFn = fn; });

              // 触发后端流式发送
              void sendAttachment(effectivePort, id).catch((e) => {
                if (unlistenFn) unlistenFn();
                resolve({ cancelled: true, sent: lastSent });
                throw e;
              });
            });

            // 结束 TX 消息
            const elapsedSec = (performance.now() - startTs) / 1000;
            if (finished.cancelled) {
              addMessage({
                id: `file-cancel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'TX',
                port_label: effectivePort,
                data: new Uint8Array(),
                timestamp: Date.now(),
                text: i18n.t('terminal.fileSendCancelled', {
                  name,
                  sent: formatBytes(finished.sent),
                  total: formatBytes(size),
                }),
              });
              throw new Error('File send cancelled');
            } else {
              const avgBps = elapsedSec > 0 ? size / elapsedSec : 0;
              addMessage({
                id: `file-summary-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'TX',
                port_label: effectivePort,
                data: new Uint8Array(),
                timestamp: Date.now(),
                text: i18n.t('terminal.fileSentV2', {
                  name,
                  sent: formatBytes(finished.sent),
                  total: formatBytes(size),
                  elapsed: elapsedSec.toFixed(1),
                  rate: formatBytes(avgBps),
                }),
              });
            }

            addLog('info', `Quick sent file: ${name} (${size} bytes)`);
          } else if (cmd.fileData.base64) {
            // 旧模式兼容：前端解码 base64 分包发送
            const fileBytes = Uint8Array.from(atob(cmd.fileData.base64), (c) => c.charCodeAt(0));
            const { filePacketSize, filePacketInterval } = useSettingsStore.getState();
            const chunkSize = filePacketSize > 0 ? filePacketSize : fileBytes.length;

            // 分包发送（不校验响应）
            for (let i = 0; i < fileBytes.length; i += chunkSize) {
              const chunk = fileBytes.slice(i, i + chunkSize);

              // 乐观渲染：先显示 TX 再发送
              const txTimestamp = Date.now();
              addMessage({
                id: `tx_${txTimestamp}_${i}`,
                type: 'TX',
                port_label: effectivePort,
                data: chunk,
                timestamp: txTimestamp,
                text: `[File ${cmd.fileData.name} chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(fileBytes.length / chunkSize)}]`,
              });

              await writeSerial(effectivePort, chunk);

              // 包间延时（最后一包无需等待）
              if (i + chunkSize < fileBytes.length && filePacketInterval > 0) {
                await sleep(filePacketInterval);
              }
            }

            addLog('info', `Quick sent file: ${cmd.fileData.name} (${fileBytes.length} bytes)`);
          } else {
            throw new Error('Invalid fileData: neither id nor base64 present');
          }
        } else {
          // ============ 普通命令快速发送 ============
          const replaceResult = replaceVariables(
            cmd.content,
            getContext()?.variables || {},
            getContext()?.sequenceCounters,
            true
          );
          const content = replaceResult.text;

          // 更新序列计数器
          replaceResult.counterUpdates.forEach(({ key, value }) => {
            useExecutionStore.getState().updateSequenceCounter(key, value);
          });
          const fullContent = appendLineEnding(content, cmd.lineEnding);
          const data = textToBytes(fullContent, cmd.dataFormat);

          // 乐观渲染：先显示 TX 再发送
          const txTimestamp = Date.now();
          addMessage({
            id: `tx_${txTimestamp}`,
            type: 'TX',
            port_label: effectivePort,
            data,
            timestamp: txTimestamp,
            text: new TextDecoder().decode(data),
          });

          await writeSerial(effectivePort, data);

          addLog('info', `Quick sent: ${content}`);
        }
      } catch (error) {
        addLog('error', `Quick send failed: ${error}`);
      }
    },
    [addLog, addMessage, getContext],
  );

  return {
    startExecution,
    stopExecution,
    pauseExecution,
    resumeExecution,
    runSingleCase,
    runSingleCommand,
    quickSendCommand,
  };
}

