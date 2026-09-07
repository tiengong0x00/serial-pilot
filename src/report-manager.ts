/**
 * 测试报告管理器
 * 负责 CSV 报告的写入和 Excel 转换
 */

import { invoke } from '@tauri-apps/api/core';

export interface TestRecord {
  test_case: string;
  sequence_number: string;
  iteration: number;
  command_name: string;
  action: string;
  send_data: string;
  received_data: string;
  expect_condition: string;
  result: string;
  error_msg: string;
  timestamp: string;
  duration: number;
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
}

class ReportManager {
  private reportPath: string | null = null;
  private recordCount = 0;
  private passedCount = 0;
  private failedCount = 0;
  private samplingMap = new Map<string, Set<number>>(); // commandId -> Set<iteration>

  /**
   * 开始新的测试报告
   */
  async startReport(testCaseName: string): Promise<void> {
    try {
      this.reportPath = await invoke<string>('start_report', {
        testCase: testCaseName
      });

      this.recordCount = 0;
      this.passedCount = 0;
      this.failedCount = 0;
      this.samplingMap.clear();
    } catch (error) {
      console.error('[ReportManager] Failed to start report:', error);
      throw error;
    }
  }

  /**
   * 写入测试记录
   */
  async writeRecord(record: TestRecord): Promise<void> {
    if (!this.reportPath) {
      console.warn('[ReportManager] Report not started, skipping record');
      return;
    }

    try {
      await invoke('write_report_record', { record });

      this.recordCount++;
      if (record.result === 'PASS') {
        this.passedCount++;
      } else {
        this.failedCount++;
      }
    } catch (error) {
      console.error('[ReportManager] Failed to write record:', error);
      throw error;
    }
  }

  /**
   * 关闭报告
   */
  async closeReport(): Promise<void> {
    if (!this.reportPath) {
      console.warn('[ReportManager] Report not started');
      return;
    }

    try {
      await invoke('close_report');
    } catch (error) {
      console.error('[ReportManager] Failed to close report:', error);
      throw error;
    }
  }

  /**
   * 转换 CSV 为 Excel
   */
  async convertToExcel(excelPath: string): Promise<void> {
    if (!this.reportPath) {
      throw new Error('Report not started');
    }

    try {
      await invoke('convert_csv_to_excel', {
        csvPath: this.reportPath,
        excelPath
      });
    } catch (error) {
      console.error('[ReportManager] Failed to convert to Excel:', error);
      throw error;
    }
  }

  /**
   * 获取报告统计摘要
   */
  getSummary(): ReportSummary {
    return {
      total: this.recordCount,
      passed: this.passedCount,
      failed: this.failedCount
    };
  }

  /**
   * 获取报告路径
   */
  getReportPath(): string | null {
    return this.reportPath;
  }

  /**
   * 循环采样逻辑：决定是否记录当前迭代
   *
   * 策略：
   * - 第 1 次迭代：始终记录
   * - 第 2-10 次：全部记录
   * - 第 11-100 次：每 10 次记录一次
   * - 第 101-1000 次：每 100 次记录一次
   * - 第 1001+ 次：每 1000 次记录一次
   * - 失败的迭代：始终记录
   */
  shouldRecordIteration(
    _commandId: string,
    current: number,
    total: number,
    failed: boolean
  ): boolean {
    // 失败的迭代始终记录
    if (failed) {
      return true;
    }

    // 第一次迭代始终记录
    if (current === 1) {
      return true;
    }

    // 最后一次迭代始终记录
    if (current === total) {
      return true;
    }

    // 前 10 次全部记录
    if (current <= 10) {
      return true;
    }

    // 11-100 次：每 10 次记录一次
    if (current <= 100 && current % 10 === 0) {
      return true;
    }

    // 101-1000 次：每 100 次记录一次
    if (current <= 1000 && current % 100 === 0) {
      return true;
    }

    // 1001+ 次：每 1000 次记录一次
    if (current > 1000 && current % 1000 === 0) {
      return true;
    }

    return false;
  }
}

export const reportManager = new ReportManager();
