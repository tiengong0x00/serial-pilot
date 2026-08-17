/**
 * 测试用例文件管理 Hook
 * 从可执行文件同级的 testcases/ 目录读取 JSON 用例文件。
 * - list：列出所有 .json 文件
 * - load：读取指定文件内容（返回原始 JSON 字符串）
 * - save：保存文件内容
 * - delete：删除文件
 * - rename：重命名文件
 *
 * currentFile 现在存储在全局 testCaseStore 中，跨组件卸载/重挂载保留状态
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState, useEffect } from 'react';
import { useTestCaseStore } from '@/stores/testCaseStore';

export function useTestCaseFiles() {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // currentFile 从全局 store 读取（组件重挂载时自动恢复）
  const currentFile = useTestCaseStore((s) => s.currentFile);
  const setCurrentFile = useTestCaseStore((s) => s.setCurrentFile);

  // 列出所有用例文件
  const refreshFiles = useCallback(async (): Promise<string[]> => {
    setLoading(true);
    setError('');
    try {
      const result = await invoke<string[]>('list_test_case_files');
      setFiles(result);
      return result;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // 读取指定文件内容
  const loadFile = useCallback(async (filename: string): Promise<string | null> => {
    setLoading(true);
    setError('');
    try {
      const json = await invoke<string>('load_test_case_file', { filename });
      setCurrentFile(filename);
      return json;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // 保存文件内容
  const saveFile = useCallback(async (filename: string, content: string): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      await invoke('save_test_case_file', { filename, content });
      setCurrentFile(filename);
      await refreshFiles(); // 刷新文件列表
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshFiles]);

  // 删除文件
  const deleteFile = useCallback(async (filename: string): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      await invoke('delete_test_case_file', { filename });
      if (currentFile === filename) {
        setCurrentFile(null);
      }
      await refreshFiles(); // 刷新文件列表
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [currentFile, refreshFiles]);

  // 重命名文件
  const renameFile = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      await invoke('rename_test_case_file', { oldName, newName });
      if (currentFile === oldName) {
        setCurrentFile(newName);
      }
      await refreshFiles(); // 刷新文件列表
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [currentFile, refreshFiles]);

  // 首次挂载自动刷新文件列表
  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  return {
    files,
    currentFile,
    loading,
    error,
    refreshFiles,
    loadFile,
    saveFile,
    deleteFile,
    renameFile,
  };
}
