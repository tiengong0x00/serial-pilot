/**
 * CLI 适配器
 *
 * 为 CLI 模式提供前端接口，监听关键数据并推送给 Rust 端
 */

import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '@/stores/terminalStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { useSerialStore } from '@/stores/serialStore';
import type { PortLabel } from '@/types/serial';

// 声明全局 CLI 接口
declare global {
  interface Window {
    __CLI_MODE__: boolean;
    __CLI_READY__: boolean;
    __cliSendCommand: (options: CLISendOptions) => Promise<CLIResult>;
    __cliRunTestCase: (options: CLIRunOptions) => Promise<CLIResult>;
    __executeTestCase?: () => Promise<void>;
  }
}

interface CLISendOptions {
  command: string;
  port: string;
  baud: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  format?: 'text' | 'hex';
  lineEnding?: 'none' | 'lf' | 'cr' | 'crlf';
  listenMs?: number;
}

interface CLIRunOptions {
  testCaseFile: string;
  port?: string;
  baud?: number;
  verbose?: boolean;
}

interface CLIResult {
  success: boolean;
  error?: string;
}

let terminalUnsubscribe: (() => void) | null = null;
let executionUnsubscribe: (() => void) | null = null;
const sentMessageIds = new Set<string>(); // 记录已发送的消息 ID，避免重复
let lastLogEntry: any = null;

/**
 * 初始化 CLI 模式
 */
export function initCLIMode() {
  console.log('[CLI] ========================================');
  console.log('[CLI] initCLIMode() function called');
  console.log('[CLI] window.__CLI_MODE__:', window.__CLI_MODE__);
  console.log('[CLI] ========================================');

  if (!window.__CLI_MODE__) {
    console.log('[CLI] Not in CLI mode, skipping initialization');
    return;
  }

  console.log('[CLI] ========================================');
  console.log('[CLI] Initializing CLI adapter...');
  console.log('[CLI] window.__CLI_MODE__:', window.__CLI_MODE__);
  console.log('[CLI] ========================================');

  // 立即暴露 CLI 接口，即使 stores 还未准备好
  console.log('[CLI] Exposing global functions immediately...');

  window.__cliSendCommand = async (options: CLISendOptions): Promise<CLIResult> => {
    try {
      console.log('[CLI] __cliSendCommand called with options:', options);

      // 确保 stores 已经初始化
      const serialStore = useSerialStore.getState();
      const terminalStore = useTerminalStore.getState();

      console.log('[CLI] Stores retrieved successfully');
      console.log('[CLI] Serial store state:', {
        p1_connected: serialStore.connectionStatus.p1_connected,
        p2_connected: serialStore.connectionStatus.p2_connected,
      });

      // 1. 连接串口（如果未连接）
      const portLabel: PortLabel = 'P1';
      if (!serialStore.connectionStatus.p1_connected) {
        console.log('[CLI] Connecting to serial port:', options.port);
        await invoke('connect_serial_port', {
          portLabel,
          portName: options.port,
          config: {
            baud_rate: options.baud,
            data_bits: options.dataBits || 8,
            stop_bits: options.stopBits || 1,
            parity: options.parity || 'none',
            flow_control: 'none',
            dtr: false,
            rts: false,
          },
          filePacketSize: 1024,
        });

        console.log('[CLI] Starting serial listener...');
        await invoke('start_serial_listener', { portLabel });

        // 关键修复：更新前端 store 的连接状态
        console.log('[CLI] Updating connection status in store...');
        serialStore.setConnectionStatus({
          ...serialStore.connectionStatus,
          p1_connected: true,
        });
        serialStore.setPortName('P1', options.port);

        // 等待连接稳定
        await new Promise((resolve) => setTimeout(resolve, 200));
        console.log('[CLI] Serial port connected and listener started');
      } else {
        console.log('[CLI] Serial port already connected');
      }

      // 2. 发送命令（直接调用后端 API）
      console.log('[CLI] Preparing to send command...');
      const lineEnding = options.lineEnding || 'crlf';
      let commandWithEnding = options.command;

      // 添加行结束符
      if (lineEnding === 'lf') {
        commandWithEnding += '\n';
      } else if (lineEnding === 'cr') {
        commandWithEnding += '\r';
      } else if (lineEnding === 'crlf') {
        commandWithEnding += '\r\n';
      }

      // 转换为字节数组
      const encoder = new TextEncoder();
      const data = encoder.encode(commandWithEnding);

      console.log('[CLI] Sending data to serial port:', {
        command: options.command,
        lineEnding,
        dataLength: data.length,
      });

      // 发送数据
      await invoke('write_serial_data', {
        portLabel,
        data: Array.from(data),
        filePacketSize: 1024,
        filePacketInterval: 0,
      });

      console.log('[CLI] Data sent, adding to terminal...');

      // 记录到终端
      terminalStore.addMessage({
        id: `tx-${Date.now()}`,
        timestamp: Date.now(),
        port_label: portLabel,
        type: 'TX',
        data: data,
        text: options.command,
      });

      console.log('[CLI] Message added to terminal');

      // 3. 等待指定时间（监听串口数据）
      if (options.listenMs) {
        console.log(`[CLI] Waiting ${options.listenMs}ms for serial data...`);
        await new Promise((resolve) => setTimeout(resolve, options.listenMs));
        console.log('[CLI] Wait completed');
      }

      // 4. 通知完成
      console.log('[CLI] Emitting cli-command-complete event...');
      await emit('cli-command-complete', { success: true });
      console.log('[CLI] Event emitted successfully');

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[CLI] Send command error:', errorMsg);
      await emit('cli-command-complete', { success: false, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  };

  window.__cliRunTestCase = async (options: CLIRunOptions): Promise<CLIResult> => {
    try {
      console.log('[CLI] Run test case:', options);

      const testCaseStore = useTestCaseStore.getState();
      const serialStore = useSerialStore.getState();
      const executionStore = useExecutionStore.getState();

      // 1. 加载测试用例文件（CLI 专用函数，支持路径）
      const content = await invoke<string>('load_test_case_file_cli', {
        filepath: options.testCaseFile,
      });

      // 2. 加载到 store (使用 importJson 方法)
      testCaseStore.importJson(content, options.testCaseFile, true);

      // 3. 连接串口（如果指定且未连接）
      if (options.port) {
        const portLabel: PortLabel = 'P1';
        if (!serialStore.connectionStatus.p1_connected) {
          await invoke('connect_serial_port', {
            portLabel,
            portName: options.port,
            config: {
              baud_rate: options.baud || 115200,
              data_bits: 8,
              stop_bits: 1,
              parity: 'none',
              flow_control: 'none',
              dtr: false,
              rts: false,
            },
            filePacketSize: 1024,
          });

          // 启动监听器
          await invoke('start_serial_listener', { portLabel });

          // 关键修复：更新前端 store 的连接状态
          serialStore.setConnectionStatus({
            ...serialStore.connectionStatus,
            p1_connected: true,
          });
          serialStore.setPortName('P1', options.port);

          // 等待连接稳定
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // 4. 执行测试用例
      // 通过全局函数执行（由 App 组件注册）
      if (window.__executeTestCase) {
        await window.__executeTestCase();
      } else {
        throw new Error('Test execution function not available');
      }

      // 5. 获取执行结果
      const results = {
        success: executionStore.isRunning === false && executionStore.logs.some(log => log.level === 'success'),
        totalCommands: 0,
        successCommands: 0,
        failedCommands: 0,
      };

      // 6. 通知完成
      await emit('cli-test-complete', results);

      return { success: results.success };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[CLI] Run test case error:', errorMsg);
      await emit('cli-test-complete', { success: false, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  };

  // 标记 CLI 就绪
  window.__CLI_READY__ = true;

  console.log('[CLI] ========================================');
  console.log('[CLI] CLI functions exposed successfully');
  console.log('[CLI] __cliSendCommand:', typeof window.__cliSendCommand);
  console.log('[CLI] __cliRunTestCase:', typeof window.__cliRunTestCase);
  console.log('[CLI] ========================================');

  // 设置 store 订阅（用于推送数据到 Rust）
  console.log('[CLI] Setting up terminal store subscriber...');
  terminalUnsubscribe = useTerminalStore.subscribe((state) => {
    // 只推送新增的消息（基于消息 ID 去重）
    if (state.messages.length > 0) {
      const latestMessage = state.messages[state.messages.length - 1];

      // 只在第一次遇到这个消息 ID 时发送，避免分帧数据导致重复
      if (!sentMessageIds.has(latestMessage.id)) {
        sentMessageIds.add(latestMessage.id);
        console.log('[CLI] Emitting terminal data event for message:', latestMessage.id);

        emit('cli-terminal-data', {
          timestamp: latestMessage.timestamp,
          port: latestMessage.port_label,
          direction: latestMessage.type,
          data: Array.from(latestMessage.data),
          format: 'utf8',
        });
      }
    }
  });

  console.log('[CLI] Setting up execution store subscriber...');
  executionUnsubscribe = useExecutionStore.subscribe((state) => {
    // 只推送新增的日志
    if (state.logs.length > 0) {
      const latestLog = state.logs[state.logs.length - 1];

      if (latestLog !== lastLogEntry) {
        lastLogEntry = latestLog;
        console.log('[CLI] Emitting execution log event');

        emit('cli-execution-log', {
          timestamp: latestLog.timestamp,
          level: latestLog.level,
          message: latestLog.message,
          commandId: latestLog.commandId,
          caseId: latestLog.caseId,
        });
      }
    }
  });

  // 通知 Rust 端 CLI 已就绪
  console.log('[CLI] Attempting to emit cli-ready event...');
  emit('cli-ready', {})
    .then(() => {
      console.log('[CLI] cli-ready event emitted successfully');
    })
    .catch((error) => {
      console.error('[CLI] Failed to emit cli-ready event:', error);
    });
  console.log('[CLI] CLI adapter initialized successfully');
}

/**
 * 清理 CLI 模式
 */
export function cleanupCLIMode() {
  if (terminalUnsubscribe) {
    terminalUnsubscribe();
    terminalUnsubscribe = null;
  }

  if (executionUnsubscribe) {
    executionUnsubscribe();
    executionUnsubscribe = null;
  }
}
