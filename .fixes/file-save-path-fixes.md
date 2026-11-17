# 文件保存路径问题修复

## 问题描述

### 问题 1：日志导出文件名被忽略
**现象**：用户在日志导出对话框中修改了文件名，但保存后实际文件仍使用自动生成的默认名称。

**原因**：
- `DataTerminal.tsx:617-683` 中，`save()` 对话框返回的 `selectedPath` 包含用户选择的完整路径（含用户修改的文件名）
- 但代码忽略了用户选择的文件名，重新调用 `generateLogFilename()` 生成默认名称

### 问题 2：外部用例保存到错误路径
**现象**：从其他路径打开用例文件，修改后保存，但没有保存回原路径，而是保存到了 testcases/ 目录。

**原因**：
- `TestCaseManager.tsx:838-877` 打开外部文件时，只提取文件名存到 `currentFile`
- `handleSaveFile` 调用 `saveFile(currentFile, json)`
- `useTestCaseFiles.ts` 的 `saveFile` 调用后端 `save_test_case_file` 命令
- 后端 `save_test_case_file` 只接受文件名，强制保存到 `testcases/` 目录

## 修复方案

### 修复 1：使用用户选择的文件名
**文件**：`src/components/serial/DataTerminal.tsx`

**变更**：
1. 从 `selectedPath` 中提取用户选择的文件名
2. 合并模式：直接使用用户选择的文件名
3. 分栏模式：
   - P1 使用用户选择的文件名
   - P2 在后缀前插入 `-P2`（例如：`log.txt` → `log-P2.txt`）

```typescript
// 提取目录和用户选择的文件名
const pathObj = selectedPath.replace(/\\/g, '/');
const exportDir = pathObj.substring(0, pathObj.lastIndexOf('/'));
const selectedFilename = pathObj.substring(pathObj.lastIndexOf('/') + 1);
```

### 修复 2：支持外部路径保存
**涉及文件**：
- `src/stores/testCaseStore.ts`
- `src/hooks/useTestCaseFiles.ts`
- `src/components/testcase/TestCaseManager.tsx`

**变更**：

#### 2.1 扩展 Store 状态
在 `testCaseStore` 中添加 `currentFilePath` 字段，记录外部文件的完整路径：

```typescript
interface TestCaseState {
  currentFile: string | null;          // 文件名
  currentFilePath: string | null;      // 完整路径（仅外部文件）
  // ...
}

setCurrentFile: (filename: string | null, fullPath?: string | null) => void;
```

#### 2.2 添加外部路径保存方法
在 `useTestCaseFiles` 中添加 `saveToExternalPath` 方法：

```typescript
const saveToExternalPath = useCallback(async (fullPath: string, content: string): Promise<boolean> => {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(fullPath, content);
  const filename = fullPath.split(/[\\/]/).pop() || 'external.json';
  setCurrentFile(filename, fullPath); // 记录完整路径
  return true;
}, [setCurrentFile]);
```

#### 2.3 修改保存逻辑
`handleSaveFile` 根据 `currentFilePath` 判断保存位置：

```typescript
const success = currentFilePath
  ? await saveToExternalPath(currentFilePath, json)  // 外部文件：保存到原路径
  : await saveFile(currentFile, json);                // 内部文件：保存到 testcases/
```

#### 2.4 打开外部文件时记录完整路径
```typescript
setCurrentFile(filename, filePath as string);
```

## 测试验证

### 测试 1：日志导出
1. 连接串口，产生一些日志
2. 点击导出按钮
3. 在保存对话框中修改文件名为 `my-test-log.txt`
4. 保存
5. ✅ 验证：实际保存的文件名应为 `my-test-log.txt`，而非自动生成的时间戳名称

### 测试 2：外部用例保存
1. 在桌面创建测试用例文件 `test.json`
2. 在应用中打开此外部文件
3. 修改用例内容
4. 保存（Ctrl+S 或点击保存按钮）
5. ✅ 验证：桌面的 `test.json` 应被更新，而非保存到 testcases/ 目录

### 测试 3：内部用例保存（回归测试）
1. 从文件列表选择 `demo.json`
2. 修改内容并保存
3. ✅ 验证：仍正常保存到 testcases/demo.json

## 影响范围

### 破坏性变更
无。向后兼容，不影响现有功能。

### 新增功能
1. 日志导出尊重用户自定义文件名
2. 外部用例文件可保存回原路径

### 持久化
`currentFilePath` 已加入 Zustand 持久化配置，刷新后保留外部文件路径。

## 构建验证
```bash
npm run build
# ✓ 1791 modules transformed.
# ✓ built in 13.21s
```

构建成功，无类型错误。
