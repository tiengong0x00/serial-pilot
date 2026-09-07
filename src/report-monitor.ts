/**
 * 报告监控器
 * 监听测试执行状态并自动管理报告
 */

import { useExecutionStore } from './stores/executionStore';

export function initReportMonitor() {
  // 订阅执行状态变化
  const unsubscribe = useExecutionStore.subscribe((state, prevState) => {
    // 检测测试开始
    if (!prevState.isRunning && state.isRunning) {
      // 测试开始
    }

    // 检测测试结束
    if (prevState.isRunning && !state.isRunning) {
      // 测试结束
    }
  });

  return unsubscribe;
}
