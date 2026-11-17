# 测试用例运行系统 — 代码检查报告

**检查日期**: 2026-11-16  
**检查方式**: 静态代码分析（无设备）  
**代码版本**: v0.4.7  
**检查范围**: 执行引擎、状态管理、报告生成、停止机制

---

## 📁 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/hooks/useTestExecution.ts` | 1765 | 执行引擎核心 |
| `src/stores/executionStore.ts` | 387 | 执行状态/日志/事件 |
| `src/stores/testCaseStore.ts` | 639 | 用例数据 CRUD |
| `src/test-report-integration.ts` | 206 | 报告集成层 |
| `src/report-manager.ts` | — | 报告管理器（CSV→Excel） |
| `src/lib/testCaseUtils.ts` | — | 工具函数 |

---

## 🔴 严重问题（影响功能正确性）

### S1. `runCount = 0` 无限循环未实现

**位置**: `useTestExecution.ts:985`  
**类型定义**: `testcase.ts:187` — `runCount: number; // 循环次数（0=无限循环，需手动停止）`  
**UI 显示**: `TestCaseTree.tsx:509` — `runCount === 0 ? t('testCase.infiniteLoop') : ...`

**问题**:
```typescript
// useTestExecution.ts:985
for (let round = 0; round < testCase.runCount; round++) {
```
当 `runCount = 0` 时，`0 < 0` 为 `false`，循环体**一次都不执行**。  
而类型注释明确说"0=无限循环"，UI 也显示"∞"。

**影响**: 用户设置用例为无限循环后，点击运行不会执行任何命令，静默失败。  
**期望**: `runCount === 0` 时应改为 `while (true)` 或等价的无限循环，仅靠 `abortRef` 退出。

**修复建议**:
```typescript
const isInfinite = testCase.runCount === 0;
const maxRounds = isInfinite ? Infinity : testCase.runCount;
for (let round = 0; round < maxRounds; round++) {
  if (abortRef.current) { finalResult = 'interrupted'; break; }
  // ...
}
```
同时 `totalRounds`（第 1353 行）为 0 时进度事件无法计算百分比，需特殊处理（显示"∞"或不发 progress 事件）。

---

### S2. 单命令/单用例运行不生成测试报告

**位置**: `useTestExecution.ts:1455-1490`（`runSingleCase`）、`1494+`（`runSingleCommand`）

**问题**: 只有根用例运行入口（约第 1341 行）调用了：
```typescript
await initTestReport(rootCase.name);
// ... 执行 ...
await finalizeTestReport();
```
而 `runSingleCase` 和 `runSingleCommand`（点击单个命令的"发送"按钮、右键运行单个用例）**完全没有**初始化和完成报告。

**影响**: 通过运行按钮执行单命令时，不会有 CSV/Excel 报告产出，`recordTestCommand` 调用也可能因报告未初始化而静默失败或抛错被吞掉。  
**期望**: 单命令运行至少应记录到报告（或明确设计为不记录，需文档说明）。

---

## 🟡 中等问题（功能可工作但有缺陷）

### M1. 完成事件统计字段为 TODO 占位

**位置**: `useTestExecution.ts:1406-1408`
```typescript
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
}
```
**影响**: 执行完成摘要中，子用例数、命令数、守护命中数始终为 0，用户无法看到真实的执行规模。  
**修复**: 在 `runCase`/`runCommand` 执行路径上累加 `statsRef.current.commandCount++`，在守护触发处累加 `guardHitCount++`。

---

### M2. 报告内存记录硬截断 100 条

**位置**: `report-manager.ts`（子代理调查结论：约第 59 行）
```typescript
if (this.records.length > 100) {
  this.records = this.records.slice(-100); // 只保留最近 100 条
}
```
**缓解因素**: CSV 在 `closeReport` 时 flush，统计计数器（total/passed/failed）独立累加，不受截断影响。但若 `getSummary()` 依赖 records 数组长度而非计数器，会出错（需确认）。  
**建议**: 统计基于计数器而非 `records.length`，或移除内存截断（CSV 已是落盘主体）。

---

### M3. 报告文件名正则匹配脆弱

**位置**: `test-report-integration.ts:123`
```typescript
const match = reportPath.match(/report_(.+?)_\d{8}_\d{6}\.csv/);
```
用例名含 `/`、`:`、`\` 等特殊字符时正则可能匹配失败，`caseName` 回退为 `'test'`，Excel 文件名变成 `test_report_...xlsx`。  
**建议**: 用例名写入报告路径前做 sanitize（替换非法文件名字符为 `_`）。

---

## 🟢 已正确实现（通过代码确认）

### ✅ 1. 递归执行引擎
- `runCase`（第 950 行）深度优先递归遍历，端口继承级联（tx/rx 各自独立）
- 跳过 `selected=false` 的命令/用例（第 960、1026 行）
- 跳过 URC 守护（已注册，不阻塞主流程，第 1033 行）

### ✅ 2. 4 种失败策略 + goto
- `continue`（第 1153 行）：失败后继续下一条
- `end-round`（第 1157 行）：结束本轮进入下一轮
- `retry-self`（第 1179、1242、1254 行）：用例级重试，受 `maxSelfRetries` 限制
- `abort`（第 1182 行）：立即终止
- `goto`（第 1161 行）：按 id 解析为下标跳转，目标失效兜底为正常继续

### ✅ 3. URC 守护处理
- 用例级/根级守护注册（第 970、1377 行），`scope` 区分
- 命令边界消费触发（第 1046 行 `consumeGuardTrigger`）
- 5 种动作：abort / restart-round / fail-current / jump-to(call/goto) / capture-only / log-only
- 跳转目标失效兜底（第 1088 行）

### ✅ 4. 停止机制
- `stopExecution`（第 290 行）：`abortRef.current = true` + `stop()`
- 递归清理所有 `running` 状态为 `interrupted`（第 296-309 行）
- 执行循环多处检查 `abortRef.current`（第 542、986、1002 行等）
- 暂停检测（第 548、1008 行）

### ✅ 5. 状态重置
- `resetCaseStatuses`（第 314 行）：递归重置为 pending，避免上次执行残留图标
- `runSingleCase` 运行前重置（第 1458 行）

### ✅ 6. 双串口与广播
- `resolveTargetPort`（第 81 行）：显式配置优先，自动模式智能解析
- `isBroadcastMode`（第 532 行）：ALL + 双串口 + 未显式指定 txPort → 同时发 P1/P2，跳过校验
- 端口继承级联（第 507、965 行）

### ✅ 7. 报告生成（根用例运行）
- `initTestReport` / `finalizeTestReport` / `recordTestCommand` 全部实现
- CSV 实时记录 → Rust 后端转 Excel（`convert_csv_to_excel`）
- 采样策略（`shouldRecordIteration`）：≤20 次全记录，>20 次记前 3 + 末 20 + 所有失败
- 完成时 toast 提示 + "生成报告"按钮
- 自动保存到 attachments 目录，保留最近 10 个

### ✅ 8. 硬件信号控制
- DTR/RTS 粘滞继承（第 511-524 行）
- 根用例每轮重置信号为连接配置初始值（第 996 行 `resetSignalLevels`）

### ✅ 9. 关键事件流
- `CriticalEvent` 类型完整（第 35-110 行）：start/progress/failure/guard-trigger/variable-extracted/complete
- 进度事件智能刷新间隔（每 10% 或末轮，第 1211 行）

---

## 📊 评估汇总

| 维度 | 评分 | 说明 |
|------|------|------|
| 运行逻辑 | ⭐⭐⭐⭐☆ | 递归/失败策略/URC 完整，runCount=0 无限循环有 BUG |
| 状态管理 | ⭐⭐⭐⭐⭐ | 状态转换、重置、清理都正确 |
| 停止机制 | ⭐⭐⭐⭐⭐ | 立即中断、资源释放、状态清理完整 |
| 报告生成 | ⭐⭐⭐⭐☆ | 根用例报告完整，单命令运行不生成报告 |
| 错误处理 | ⭐⭐⭐⭐☆ | 跳转目标失效有兜底，部分统计缺失 |
| 双串口支持 | ⭐⭐⭐⭐⭐ | 继承/广播/交叉通信完整 |
| 统计准确性 | ⭐⭐⭐☆☆ | subCaseCount/commandCount/guardHitCount 为 TODO 占位 |

**综合**: ⭐⭐⭐⭐☆ (4.0/5.0) — 核心执行逻辑扎实，2 个严重问题需修复。

---

## 🔧 修复优先级

### P0（建议立即修复，v0.4.8）
1. **S1**: `runCount=0` 无限循环 — 改 `for` 为支持 `Infinity` 的循环
2. **S2**: 单命令运行报告 — `runSingleCommand` 增加 `initTestReport`/`finalizeTestReport`（或明确设计为不记录）

### P1（建议近期修复，v0.5.0）
3. **M1**: 完成事件统计 TODO — 累加 commandCount/subCaseCount/guardHitCount
4. **M2**: 报告内存截断 — 确认统计基于计数器，补测试

### P2（可选优化）
5. **M3**: 报告文件名 sanitize

---

## 📝 检查方法说明

本次检查完全基于静态代码分析，未运行任何测试，主要手段：
1. **结构化阅读**: 按函数逐段阅读 `useTestExecution.ts` 关键路径（runCase / runStandardCommand / stopExecution / runSingleCase）
2. **交叉验证**: 类型定义（`testcase.ts`）与实现代码对照，UI 显示与逻辑对照
3. **TODO 扫描**: `grep TODO/FIXME` 定位未完成项
4. **边界分析**: 重点检查 `runCount=0`、空数组、目标失效等边界
5. **调用链追踪**: 报告生成的初始化/完成调用点全量定位（grep `initTestReport|finalizeTestReport`）

未覆盖项（需设备或运行时验证）：
- 串口实际收发时序
- URC 守护真实命中率
- 长时间运行内存泄漏
- 超大用例（1000+ 命令）性能
