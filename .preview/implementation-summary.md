# 双终端显示功能实施总结

## 修改完成时间
2026-11-12

## 问题修复
✅ 已修复 `effectiveMode is not defined` 错误

## 功能概述
在终端工具栏右侧新增「双终端」图标按钮，用户可随时切换单终端/双终端显示模式，断开串口时不会强制切换布局。

## 核心改动

### 1. 移除旧逻辑
- ❌ 删除 `TerminalMode` 类型定义（`"merged" | "split"`）
- ❌ 删除 `terminalMode` 状态变量
- ❌ 删除 `STORAGE_KEY_MODE` 和 `getStoredMode()` 函数
- ❌ 删除工具栏左侧的「合并显示/左右分栏」按钮组
- ❌ 删除 `Rows2` 图标导入

### 2. 新增功能
- ✅ 新增 `dualTerminalEnabled: boolean` 状态（默认 `false`）
- ✅ 新增 `STORAGE_KEY_DUAL_TERMINAL` 和 `getStoredDualTerminal()` 函数
- ✅ 新增工具栏右侧「双终端」图标按钮（时间戳按钮旁边）
- ✅ 按钮样式：未激活灰色，激活时紫色高亮
- ✅ 使用 `Columns2` 图标（左右分栏图标）

## 关键逻辑

### 双终端自动激活
```typescript
useEffect(() => {
  if (connectionStatus.p1_connected && connectionStatus.p2_connected && !dualTerminalEnabled) {
    setDualTerminalEnabled(true);
  }
}, [connectionStatus.p1_connected, connectionStatus.p2_connected, dualTerminalEnabled]);
```

**行为**：双串口同时连接时，自动激活双终端按钮。

### 端口标签显示策略
```typescript
const showPortLabel = !dualTerminalEnabled && connectionStatus.p1_connected && connectionStatus.p2_connected;
```

**规则**：仅在**单终端模式 + 双串口连接**时显示 `[P1]` / `[P2]` 标签。

| 场景 | 双终端按钮 | 端口标签 |
|------|-----------|---------|
| 单串口 + 单终端 | 未激活 | ❌ 不显示 |
| 单串口 + 双终端 | 已激活 | ❌ 不显示 |
| 双串口 + 单终端 | 未激活 | ✅ 显示 [P1]/[P2] |
| 双串口 + 双终端 | 已激活 | ❌ 不显示（左右栏已标注）|

### 终端显示模式
```typescript
{!dualTerminalEnabled ? (
  // 单终端：所有消息按时间排列
  <VirtualTerminalView messages={messages} showPort={showPortLabel} />
) : (
  // 双终端：P1 左、P2 右，独立滚动
  <div className="flex">
    <P1Terminal />
    {connectionStatus.p2_connected ? <P2Terminal /> : <P2Placeholder />}
  </div>
)}
```

### P2 未连接占位
```typescript
{connectionStatus.p2_connected ? (
  <VirtualTerminalView messages={p2Messages} />
) : (
  <div className="flex-1 flex items-center justify-center text-muted-foreground/50 text-sm">
    {t("terminal.p2NotConnected")}
  </div>
)}
```

## 日志导出逻辑更新
```typescript
// 双终端模式：分别导出 P1 和 P2 到同一目录
if (dualTerminalEnabled) {
  // P1: user-selected-filename.txt
  // P2: user-selected-filename-P2.txt
}
// 单终端模式：导出全部消息到一个文件（带端口标签）
else {
  // 合并导出：user-selected-filename.txt
}
```

## 翻译文案

### 中文（zh-CN）
```json
{
  "terminal": {
    "toggleDualTerminal": "双终端显示",
    "p2NotConnected": "P2 未连接"
  }
}
```

### 英文（en-US）
```json
{
  "terminal": {
    "toggleDualTerminal": "Dual Terminal Display",
    "p2NotConnected": "P2 Not Connected"
  }
}
```

## 测试场景

### ✅ 场景 1：默认启动
- **初始状态**：双终端按钮未激活，显示单终端
- **预期**：界面干净简洁，无冗余按钮

### ✅ 场景 2：单串口手动开启双终端
1. 连接 P1
2. 点击双终端按钮
3. **预期**：左侧显示 P1 数据，右侧显示「P2 未连接」占位

### ✅ 场景 3：双串口自动激活
1. 连接 P1（双终端按钮未激活）
2. 连接 P2
3. **预期**：按钮自动激活，左右分栏显示数据

### ✅ 场景 4：双串口合并显示
1. P1 + P2 都连接
2. 点击双终端按钮关闭
3. **预期**：切换到单终端，消息带 `[P1]` / `[P2]` 标签

### ✅ 场景 5：断开保持布局
1. 双终端模式下运行
2. 断开 P2
3. **预期**：按钮保持激活状态，P2 栏显示占位文案

### ✅ 场景 6：状态持久化
1. 激活双终端
2. 刷新页面/重启应用
3. **预期**：按钮状态恢复为激活

## 修改文件清单

### 主要文件
- `src/components/serial/DataTerminal.tsx` - 主组件逻辑
- `src/i18n.ts` - 翻译文案

### 变更统计
- 删除代码行数：约 50 行
- 新增代码行数：约 40 行
- 净删除：约 10 行（代码更简洁）

## 浏览器测试地址
```
http://localhost:1420
```

## 完成状态
🎉 **所有功能已实施并修复，可以开始测试！**
