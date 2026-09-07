/**
 * 测试报告集成模块
 * 在测试执行的关键点集成报告功能
 */

import { reportManager, TestRecord } from './report-manager';
import { toast } from 'sonner';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

// 防止重复触发通知
let notificationShown = false;

/**
 * 测试开始时初始化报告
 */
export async function initTestReport(testCaseName: string): Promise<void> {
  try {
    await reportManager.startReport(testCaseName);
    notificationShown = false;
  } catch (error) {
    console.error('[TestReport] 初始化报告失败:', error);
    throw error;
  }
}

/**
 * 记录测试命令执行结果
 */
export async function recordTestCommand(params: {
  testCaseName: string;
  sequenceNumber: string;
  iteration: number;
  commandName: string;
  action: string;
  sendData: string;
  receivedData: string;
  expectCondition: string;
  result: 'PASS' | 'FAIL';
  errorMsg?: string;
  duration: number;
  totalIterations?: number;
}): Promise<void> {
  // 应用采样策略
  const shouldRecord = reportManager.shouldRecordIteration(
    params.sequenceNumber,
    params.iteration,
    params.totalIterations || params.iteration,
    params.result === 'FAIL'
  );

  if (!shouldRecord) {
    return;
  }

  const record: TestRecord = {
    test_case: params.testCaseName,
    sequence_number: params.sequenceNumber,
    iteration: params.iteration,
    command_name: params.commandName,
    action: params.action,
    send_data: params.sendData,
    received_data: params.receivedData,
    expect_condition: params.expectCondition,
    result: params.result,
    error_msg: params.errorMsg || '',
    timestamp: new Date().toISOString(),
    duration: params.duration,
  };

  await reportManager.writeRecord(record);
}

/**
 * 测试完成时关闭报告并显示通知
 */
export async function finalizeTestReport(): Promise<void> {
  if (notificationShown) {
    return;
  }

  try {
    await reportManager.closeReport();
    notificationShown = true;

    const summary = reportManager.getSummary();
    const result = summary.failed === 0 ? 'PASS' : 'FAIL';

    // 自动保存 Excel 到 attachments 目录
    await autoSaveReport();

    // 使用 Sonner toast 显示完成通知
    const toastFn = result === 'PASS' ? toast.success : toast.error;
    toastFn(`测试${result === 'PASS' ? '通过' : '失败'}`, {
      duration: 10000,
      action: {
        label: '生成报告',
        onClick: handleGenerateReport,
      },
    });
  } catch (error) {
    console.error('[TestReport] 关闭报告失败:', error);
  }
}

/**
 * 自动保存报告到 attachments 目录
 */
async function autoSaveReport(): Promise<void> {
  try {
    // 获取 attachments 目录路径
    const attachmentsDir = await invoke<string>('get_attachments_dir');

    const summary = reportManager.getSummary();
    const result = summary.failed === 0 ? 'PASS' : 'FAIL';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');

    // 获取测试用例名
    const reportPath = reportManager.getReportPath();
    let caseName = 'test';
    if (reportPath) {
      const match = reportPath.match(/report_(.+?)_\d{8}_\d{6}\.csv/);
      if (match) {
        caseName = match[1].replace('.json', '');
      }
    }

    const filename = `${caseName}_report_${result}_${timestamp}.xlsx`;
    const excelPath = `${attachmentsDir}\\${filename}`;

    // 转换并保存
    await reportManager.convertToExcel(excelPath);

    // 清理旧报告，只保留最近 10 个
    await cleanupOldReports(attachmentsDir);
  } catch (error) {
    console.error('[TestReport] 自动保存报告失败:', error);
  }
}

/**
 * 清理旧报告，只保留最近 10 个 Excel 文件
 */
async function cleanupOldReports(dir: string): Promise<void> {
  try {
    await invoke('cleanup_old_excel_reports', { dir, keepCount: 10 });
  } catch (error) {
    console.error('[TestReport] 清理旧报告失败:', error);
  }
}

/**
 * 生成 Excel 报告
 */
async function handleGenerateReport(): Promise<void> {
  try {
    const summary = reportManager.getSummary();
    const result = summary.failed === 0 ? 'PASS' : 'FAIL';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');

    // 获取测试用例名（去掉 .json 后缀）
    const reportPath = reportManager.getReportPath();
    let caseName = 'test';
    if (reportPath) {
      const match = reportPath.match(/report_(.+?)_\d{8}_\d{6}\.csv/);
      if (match) {
        caseName = match[1].replace('.json', '');
      }
    }

    const defaultPath = `${caseName}_report_${result}_${timestamp}.xlsx`;

    const excelPath = await save({
      defaultPath,
      filters: [{
        name: 'Excel',
        extensions: ['xlsx'],
      }],
    });

    if (excelPath) {
      await reportManager.convertToExcel(excelPath);

      toast.success('报告生成成功', {
        description: `已保存到:\n${excelPath}`,
      });
    }
  } catch (error) {
    toast.error('报告生成失败', {
      description: String(error),
    });
  }
}

/**
 * 判断是否应该记录此次迭代（循环采样）
 */
export function shouldRecordIteration(
  commandId: string,
  current: number,
  total: number,
  failed: boolean
): boolean {
  return reportManager.shouldRecordIteration(commandId, current, total, failed);
}
