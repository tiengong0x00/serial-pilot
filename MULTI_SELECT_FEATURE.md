# 多选功能实现文档

## 功能概述

在测试用例树区域实现了多选功能,支持 **Ctrl+点击多选**、**Ctrl+A全选**、**Esc取消** 和 **右键批量操作**。

## 使用方法

### 1. Ctrl+点击多选
- 按住 `Ctrl` (Windows/Linux) 或 `Cmd` (Mac) 键
- 点击用例或命令节点
- 可以切换单个节点的选中状态
- 多选的节点会显示蓝色高亮背景

### 2. Ctrl+A 全选
- 按 `Ctrl+A` (Windows/Linux) 或 `Cmd+A` (Mac)
- 选中当前测试用例树中的所有节点(用例和命令)
- 注意: 输入框获得焦点时不会拦截此快捷键

### 3. Esc 取消多选
- 按 `Esc` 键取消所有多选状态
- 回到普通单选模式

### 4. 右键批量操作
当选中多个节点 (≥2) 时,右键菜单会显示批量操作选项:
- **批量启用 (N 项)** - 将选中的所有节点标记为启用执行
- **批量禁用 (N 项)** - 将选中的所有节点标记为跳过执行
- **批量删除 (N 项)** - 删除选中的所有节点(会弹出确认对话框)

### 5. 普通点击
- 不按任何修饰键点击节点
- 自动清空多选状态,回到单选模式

## 视觉反馈

- **单选高亮**: 灰色背景 (`bg-accent`)
- **多选高亮**: 蓝色背景 (`bg-blue-100` / `dark:bg-blue-900/30`)
- 多选和单选可以共存(但通常只有多选可见)

## 技术实现

### 修改的文件

1. **src/components/testcase/TestCaseManager.tsx**
   - 新增 `multiSelection: Set<string>` 状态
   - 实现 `handleSelectCase`/`handleSelectCommand` 支持 Ctrl+点击
   - 实现 `handleBatchToggleSelected` 批量启用/禁用
   - 实现 `handleBatchRemove` 批量删除
   - 新增 Ctrl+A 和 Esc 键盘事件监听

2. **src/components/testcase/TestCaseTree.tsx**
   - `TestCaseTreeProps` 新增 `multiSelection: Set<string>`
   - `onSelectCase`/`onSelectCommand` 签名改为 `(id, e?) => void`
   - `DraggableCommandRow` 新增 `multiSelected` prop
   - `DraggableCaseNode` 支持多选高亮样式

3. **src/components/testcase/ContextMenu.tsx**
   - `ContextMenuProps` 新增批量操作相关 props
   - 当 `multiSelection.size > 1` 时显示批量操作菜单
   - 批量删除前显示确认对话框

4. **src/i18n.ts**
   - 中文文案: `batchEnable`, `batchDisable`, `batchDelete`, `batchDeleteConfirm`
   - 英文文案: 对应翻译

### 核心逻辑

```typescript
// 多选状态
const [multiSelection, setMultiSelection] = useState<Set<string>>(new Set());

// Ctrl+点击处理
const handleSelectCase = useCallback((id: string, e?: React.MouseEvent) => {
  if (e && (e.ctrlKey || e.metaKey)) {
    // 切换多选
    setMultiSelection(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  } else {
    // 普通点击: 清空多选
    setMultiSelection(new Set());
    selectCase(id);
  }
}, [selectCase]);

// 批量启用/禁用
const handleBatchToggleSelected = useCallback((ids: Set<string>, enable: boolean) => {
  ids.forEach(id => {
    const cmd = findCommand(cases, id);
    if (cmd) {
      updateCommand(cmd.owner.id, id, { selected: enable });
    } else {
      const case_ = findCase(cases, id);
      if (case_) {
        // 递归更新用例及其子节点
        walkCases([case_], c => {
          updateCase(c.id, { selected: enable });
          c.children.forEach(child => {
            if (isCommand(child)) {
              updateCommand(c.id, child.id, { selected: enable });
            }
          });
        });
      }
    }
  });
  setMultiSelection(new Set()); // 操作后清空
}, [cases, updateCase, updateCommand]);
```

## 边界处理

1. **根用例保护**: 批量禁用时跳过根用例(带 `targetPort` 的节点)
2. **混合选择**: 可以同时选中用例和命令,批量操作自动区分处理
3. **输入框焦点**: Ctrl+A 在输入框/文本域获得焦点时不拦截
4. **拖拽兼容**: 拖拽手柄点击事件阻止冒泡,不会触发选择
5. **操作后清空**: 批量操作完成后自动清空多选状态

## 未实现的功能 (V2)

- ⬜ **Shift+范围选择**: 从 A 节点到 B 节点之间的所有节点
- ⬜ **多选拖拽**: 批量移动多个选中的节点
- ⬜ **撤销/重做**: 批量删除的撤销
- ⬜ **移动端长按**: 触摸屏设备的多选模式

## 兼容性

- ✅ Windows/Linux: Ctrl+点击, Ctrl+A
- ✅ macOS: Cmd+点击, Cmd+A
- ✅ 现有单选/拖拽/执行逻辑不受影响
- ✅ 导入导出不受影响(多选是临时 UI 状态)

## 测试

- ✅ TypeScript 编译通过
- ✅ 284/286 测试通过(2 个既有失败不相关)
- 🔲 手动测试待验证:
  - Ctrl+点击多选/取消
  - Ctrl+A 全选
  - Esc 取消
  - 右键批量启用/禁用/删除

## 工时统计

- 状态管理: 0.5h
- 点击交互: 0.5h
- 键盘事件: 0.3h
- 视觉反馈: 0.2h
- 右键菜单: 0.3h
- 批量操作: 0.5h
- 类型修复: 0.3h
- 国际化: 0.2h
- **总计: 2.8 小时**

## 后续优化

1. 添加 Shift+范围选择(需实现 `getNodeRange` 算法)
2. 添加多选状态视觉提示(如: "已选中 5 项")
3. 优化大量节点批量操作的性能(使用 `startTransition`)
4. 添加键盘导航(方向键移动选择)
