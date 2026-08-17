import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useExecutionStore } from '@/stores/executionStore';
import { matchPattern, extractVariables } from '@/lib/testCaseUtils';
import type { SerialDataPayload } from '@/types/serial';
import type { UrcGuardCommand } from '@/types/testCase';
import { URC_GUARD_ACTION_PRIORITY } from '@/types/testCase';

/**
 * URC 后台守护监听器 Hook
 *
 * 在 v1 递归执行模型中，URC 后台守护由执行引擎注册到 ExecutionContext.activeGuards，
 * 本 hook 负责：
 * 1. 订阅 serial_data 事件
 * 2. 对每条接收数据检查所有活跃守护（getActiveGuards）
 * 3. 命中时提取变量、记录日志，并通过 setGuardTrigger 通知执行引擎
 * 4. 执行引擎根据 action 优先级和当前执行状态决定是否中断/重启
 *
 * 本 hook 不负责注册/注销守护（由执行引擎在进入/退出用例时管理），
 * 仅负责匹配和触发通知。
 */
export function useUrcListener() {
  const { getActiveGuards, setGuardTrigger, setVariable, addLog, context } = useExecutionStore();

  useEffect(() => {
    if (!context) return;

    const decoder = new TextDecoder('utf-8', { fatal: false });
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await listen<SerialDataPayload>('serial_data', (event) => {
        const { port_label, data } = event.payload;
        const text = decoder.decode(new Uint8Array(data), { stream: true });

        // 端口过滤下沉到守护级别（每个守护可监听不同端口，见下）

        const guards = getActiveGuards();
        if (guards.length === 0) return;

        // 收集所有命中的守护及其优先级
        const triggered: Array<{ guard: UrcGuardCommand; priority: number }> = [];

        for (const guard of guards) {
          // 守护监听口：listenPort 未设置则继承用例默认口
          const guardPort = guard.listenPort ?? context.targetPort;
          if (port_label !== guardPort) continue;
          if (matchPattern(text, guard.pattern, guard.matchMode)) {
            const priority = URC_GUARD_ACTION_PRIORITY[guard.action];
            triggered.push({ guard, priority });

            addLog('info', `🛡️ URC guard triggered: ${guard.pattern} → ${guard.action}`, guard.id);

            // 提取变量
            if (guard.extractConfig?.enabled) {
              const vars = extractVariables(text, guard.extractConfig);
              for (const [name, value] of Object.entries(vars)) {
                setVariable(name, value);
                addLog('success', `Extracted variable: ${name} = ${value}`);
              }
            }

            // rearm='once' 的守护触发后从注册表移除（执行引擎负责注销）
            // 这里仅记录，实际注销由执行引擎在下次检查时处理
          }
        }

        // 多守护同时命中：选优先级最高的通知执行引擎
        if (triggered.length > 0) {
          triggered.sort((a, b) => b.priority - a.priority);
          const winner = triggered[0].guard;
          setGuardTrigger({
            guardId: winner.id,
            action: winner.action,
            triggeredAt: Date.now(),
          });
        }
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [context, getActiveGuards, setGuardTrigger, setVariable, addLog]);
}
