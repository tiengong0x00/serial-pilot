/**
 * 测试用例存储（Zustand + Immer）
 * 负责用例树的 CRUD、选中状态、导入导出。
 * 执行状态由独立的 executionStore 管理。
 *
 * v2: 统一 children 模型（CaseChild = TestCommand | TestCase）
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { TestCase, RootTestCase, CaseChild, CommandType } from '@/types/testCase';
import {
  createCase,
  createCommand,
  createRootCase,
  convertCommandType,
  findCase,
  isCase,
  isCommand,
  exportToFile,
  parseImportFile,
} from '@/lib/testCaseUtils';

interface TestCaseState {
  cases: TestCase[];
  selectedCaseId: string | null;
  selectedCommandId: string | null;
  isDirty: boolean;
  currentFile: string | null; // 当前加载的文件名（与 cases 同步，跨界面切换保留）

  // 用例操作
  addCase: (parentId: string | null) => void;
  removeCase: (id: string) => void;
  updateCase: (id: string, patch: Partial<TestCase>) => void;
  toggleExpanded: (id: string) => void;

  // 命令操作
  addCommand: (caseId: string, type?: CommandType) => void;
  removeCommand: (caseId: string, cmdId: string) => void;
  updateCommand: (caseId: string, cmdId: string, patch: Partial<CaseChild>) => void;

  // 选中
  selectCase: (id: string | null) => void;
  selectCommand: (id: string | null) => void;

  // 导入导出（单根模型：一个文件=一个根用例）
  exportJson: (filename: string) => string;
  importJson: (json: string, filename: string, replace: boolean) => void;
  importAsGroup: (json: string, groupName: string) => void;

  // 脏标记
  markDirty: () => void;
  markClean: () => void;

  // 根用例访问
  getRootCase: () => RootTestCase | null;

  // 统一 children 排序（命令和用例混在一起）
  reorderChildren: (parentId: string | null, fromIndex: number, toIndex: number) => void;

  // 跨层级移动
  moveChildToCase: (childId: string, fromCaseId: string, toCaseId: string) => void;

  /**
   * 统一的相对位置移动：把 childId 移动到 overId 的前/后（兄弟）或内部（子级）。
   * position='before'|'after' → 与 overId 同级、插到其前/后
   * position='inside'         → 成为 overId（必须是用例）的最后一个子项
   * 封装了跨层级移动 + 精确排序，供树形拖拽统一调用。
   */
  moveChildRelative: (childId: string, overId: string, position: 'before' | 'after' | 'inside') => void;

  // 兼容旧 API（内部映射到统一接口）
  reorderCases: (parentId: string | null, fromIndex: number, toIndex: number) => void;
  reorderCommands: (caseId: string, fromIndex: number, toIndex: number) => void;
  moveCaseToCase: (draggedCaseId: string, targetCaseId: string) => void;
  moveCommandToCase: (commandId: string, fromCaseId: string, toCaseId: string) => void;

  // 文件管理
  setCurrentFile: (filename: string | null) => void;

  reset: () => void;
}

/** 从数组中递归移除指定 ID 的用例 */
function removeCaseFromList(list: TestCase[], id: string): TestCase[] {
  return list
    .filter((c) => c.id !== id)
    .map((c) => ({
      ...c,
      children: c.children
        .filter((child) => !isCase(child) || child.id !== id)
        .map((child) => (isCase(child) ? removeCaseFromList([child], id)[0] || child : child)),
    }));
}

/** 原地（mutating）从树中移除并返回被移除的用例，用于 immer draft */
function extractCaseInPlace(list: TestCase[], id: string): TestCase | null {
  const idx = list.findIndex((c) => c.id === id);
  if (idx !== -1) {
    const [removed] = list.splice(idx, 1);
    return removed;
  }
  for (const c of list) {
    const childIdx = c.children.findIndex((child) => isCase(child) && child.id === id);
    if (childIdx !== -1) {
      const [removed] = c.children.splice(childIdx, 1);
      return removed as TestCase;
    }
    for (const child of c.children) {
      if (isCase(child)) {
        const found = extractCaseInPlace([child], id);
        if (found) return found;
      }
    }
  }
  return null;
}

/** 判断 targetId 是否为 case 的自身或后代 */
function isSelfOrDescendant(case_: TestCase, targetId: string): boolean {
  if (case_.id === targetId) return true;
  return case_.children.some((child) => isCase(child) && isSelfOrDescendant(child, targetId));
}

/** 原地从树中移除并返回任意子项（命令或子用例），用于 immer draft */
function extractChildInPlace(list: TestCase[], childId: string): CaseChild | null {
  for (const c of list) {
    const idx = c.children.findIndex((ch) => ch.id === childId);
    if (idx !== -1) {
      const [removed] = c.children.splice(idx, 1);
      return removed;
    }
    for (const ch of c.children) {
      if (isCase(ch)) {
        const found = extractChildInPlace([ch], childId);
        if (found) return found;
      }
    }
  }
  return null;
}

/** 递归查找某子项所在的父用例及其索引 */
function findParentAndIndex(
  list: TestCase[],
  childId: string,
): { parent: TestCase; index: number } | null {
  for (const c of list) {
    const idx = c.children.findIndex((ch) => ch.id === childId);
    if (idx !== -1) return { parent: c, index: idx };
    for (const ch of c.children) {
      if (isCase(ch)) {
        const found = findParentAndIndex([ch], childId);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * 确保数据符合单根模型
 * 一个文件 = 一个根用例，文件名与根用例 name 同步
 */
function ensureSingleRoot(cases: TestCase[], filename: string): RootTestCase {
  const nameWithoutExt = filename.replace('.json', '');

  if (cases.length === 0) {
    return createRootCase(nameWithoutExt);
  }

  if (cases.length === 1) {
    const root = cases[0];
    root.name = nameWithoutExt;
    root.selected = true; // 根用例始终选中（不可取消），保证运行入口可用
    // 如果已有 targetPort，保持；否则添加（迁移）
    if (!('targetPort' in root)) {
      return { ...root, targetPort: 'P1' as const };
    }
    return root as RootTestCase;
  }

  // 多根情况（旧文件），迁移为单根
  const root = createRootCase(nameWithoutExt);
  root.description = 'Migrated from legacy format';
  root.children = cases;
  root.isExpanded = true;
  root.selected = true; // 根用例始终选中
  return root;
}

/**
 * 递归把整棵用例树的运行态（status）重置为 pending。
 * 用于持久化恢复时清除上次遗留的"运行中/失败"状态。
 */
function resetRuntimeStatus(list: TestCase[]): void {
  for (const c of list) {
    c.status = 'pending';
    for (const child of c.children) {
      if (isCase(child)) {
        resetRuntimeStatus([child]);
      } else {
        child.status = 'pending';
      }
    }
  }
}

export const useTestCaseStore = create<TestCaseState>()(
  persist(
    immer((set, get) => ({
    cases: [],
    selectedCaseId: null,
    selectedCommandId: null,
    isDirty: false,
    currentFile: null,

    addCase: (parentId) =>
      set((state) => {
        const newCase = createCase();
        if (parentId === null) {
          state.cases.push(newCase);
        } else {
          const parent = findCase(state.cases, parentId);
          if (parent) {
            parent.children.push(newCase);
            parent.isExpanded = true;
          }
        }
        state.isDirty = true;
      }),

    removeCase: (id) =>
      set((state) => {
        state.cases = removeCaseFromList(state.cases, id);
        if (state.selectedCaseId === id) state.selectedCaseId = null;
        state.isDirty = true;
      }),

    updateCase: (id, patch) =>
      set((state) => {
        const c = findCase(state.cases, id);
        if (c) Object.assign(c, patch);
        state.isDirty = true;
      }),

    toggleExpanded: (id) =>
      set((state) => {
        const c = findCase(state.cases, id);
        if (c) c.isExpanded = !c.isExpanded;
      }),

    addCommand: (caseId, type = 'command') =>
      set((state) => {
        const c = findCase(state.cases, caseId);
        if (c) {
          c.children.push(createCommand(type));
          state.isDirty = true;
        }
      }),

    removeCommand: (caseId, cmdId) =>
      set((state) => {
        const c = findCase(state.cases, caseId);
        if (c) {
          c.children = c.children.filter((child) => {
            if (isCommand(child) && child.id === cmdId) {
              if (state.selectedCommandId === cmdId) state.selectedCommandId = null;
              return false;
            }
            return true;
          });
          state.isDirty = true;
        }
      }),

    updateCommand: (caseId, cmdId, patch) =>
      set((state) => {
        const c = findCase(state.cases, caseId);
        if (!c) return;
        const idx = c.children.findIndex((child) => isCommand(child) && child.id === cmdId);
        if (idx === -1) return;
        const cmd = c.children[idx];
        if (!isCommand(cmd)) return;

        // 类型切换：整体替换（保留通用字段，填充目标类型默认值），避免旧类型专属字段残留
        if ('type' in patch && patch.type && patch.type !== cmd.type) {
          c.children[idx] = convertCommandType(cmd, patch.type as CommandType);
        } else {
          Object.assign(cmd, patch);
        }
        state.isDirty = true;
      }),

    selectCase: (id) =>
      set((state) => {
        state.selectedCaseId = id;
      }),

    selectCommand: (id) =>
      set((state) => {
        state.selectedCommandId = id;
      }),

    exportJson: (filename) => {
      const state = get();
      const root = ensureSingleRoot(
        state.cases.map((c) => ({ ...c })),
        filename,
      );
      const file = exportToFile(root);
      return JSON.stringify(file, null, 2);
    },

    importJson: (json, filename, replace) =>
      set((state) => {
        const imported = parseImportFile(json); // TestCase[]（v2 单根为长度 1）
        if (replace) {
          const root = ensureSingleRoot(imported, filename);
          state.cases = [root];
          state.currentFile = filename; // 替换即加载新文件，同步文件名
        } else {
          const root = ensureSingleRoot(state.cases, filename);
          const importedRoot = ensureSingleRoot(imported, filename);
          root.children.push(importedRoot);
          state.cases = [root];
        }
        state.isDirty = true;
      }),

    importAsGroup: (json, groupName) =>
      set((state) => {
        const imported = parseImportFile(json); // TestCase[]
        const root = state.cases.length > 0 ? state.cases[0] : createRootCase(groupName);
        const group = createCase();
        group.name = groupName;
        group.description = `Imported from ${groupName}`;
        group.children = imported; // TestCase[] 可赋给 CaseChild[]
        group.isExpanded = true;
        root.children.push(group);
        root.isExpanded = true;
        state.cases = [root];
        state.isDirty = true;
      }),

    markDirty: () =>
      set((state) => {
        state.isDirty = true;
      }),

    markClean: () =>
      set((state) => {
        state.isDirty = false;
      }),

    getRootCase: () => {
      const cases = get().cases;
      return cases.length > 0 ? (cases[0] as RootTestCase) : null;
    },

    reorderChildren: (parentId, fromIndex, toIndex) =>
      set((state) => {
        const list = parentId === null ? state.cases : findCase(state.cases, parentId)?.children;
        if (!list) return;
        if (fromIndex < 0 || fromIndex >= list.length) return;
        if (toIndex < 0 || toIndex >= list.length) return;
        const [moved] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, moved);
        state.isDirty = true;
      }),

    moveChildToCase: (childId, fromCaseId, toCaseId) =>
      set((state) => {
        // 如果是用例，防止拖到自己或自己的子节点
        const draggedCase = findCase(state.cases, childId);
        if (draggedCase && isSelfOrDescendant(draggedCase, toCaseId)) return;

        const fromCase = findCase(state.cases, fromCaseId);
        const toCase = findCase(state.cases, toCaseId);
        if (!fromCase || !toCase) return;

        const childIdx = fromCase.children.findIndex((child) => child.id === childId);
        if (childIdx === -1) return;

        const [child] = fromCase.children.splice(childIdx, 1);
        toCase.children.push(child);
        toCase.isExpanded = true;
        state.isDirty = true;
      }),

    moveChildRelative: (childId, overId, position) =>
      set((state) => {
        if (childId === overId) return;

        // 若被拖动的是用例，禁止拖入自身或自身后代
        const draggedCase = findCase(state.cases, childId);
        if (draggedCase) {
          if (position === 'inside' && isSelfOrDescendant(draggedCase, overId)) return;
          // before/after：overId 是锚点，若锚点是被拖用例的后代也要拒绝（会导致环）
          if (isSelfOrDescendant(draggedCase, overId)) return;
        }

        if (position === 'inside') {
          // 目标必须是用例
          const target = findCase(state.cases, overId);
          if (!target) return;
          const child = extractChildInPlace(state.cases, childId);
          if (!child) return;
          target.children.push(child);
          target.isExpanded = true;
          state.isDirty = true;
          return;
        }

        // before/after：定位锚点的父与索引 → 提取 child → 在同一父内按位置插入
        const anchor = findParentAndIndex(state.cases, overId);
        if (!anchor) return;
        const parentId = anchor.parent.id;

        const child = extractChildInPlace(state.cases, childId);
        if (!child) return;

        // 提取后锚点索引可能变化，重新定位父与锚点
        const parent = findCase(state.cases, parentId);
        if (!parent) return;
        const anchorIdx = parent.children.findIndex((ch) => ch.id === overId);
        if (anchorIdx === -1) {
          // 锚点异常丢失，兜底追加到父末尾，避免 child 丢失
          parent.children.push(child);
          state.isDirty = true;
          return;
        }
        const insertAt = position === 'before' ? anchorIdx : anchorIdx + 1;
        parent.children.splice(insertAt, 0, child);
        state.isDirty = true;
      }),

    // 兼容旧 API
    reorderCases: (parentId, fromIndex, toIndex) => {
      // 旧接口假设只重排用例，但在新模型中 children 混合了命令和用例
      // 为了兼容，这里直接映射到 reorderChildren（实际会移动任何类型的 child）
      get().reorderChildren(parentId, fromIndex, toIndex);
    },

    reorderCommands: (caseId, fromIndex, toIndex) => {
      // 同上，映射到统一接口
      get().reorderChildren(caseId, fromIndex, toIndex);
    },

    moveCaseToCase: (draggedCaseId, targetCaseId) =>
      set((state) => {
        const draggedCase = findCase(state.cases, draggedCaseId);
        if (!draggedCase) return;
        if (isSelfOrDescendant(draggedCase, targetCaseId)) return;

        const extracted = extractCaseInPlace(state.cases, draggedCaseId);
        if (!extracted) return;

        const targetCase = findCase(state.cases, targetCaseId);
        if (targetCase) {
          targetCase.children.push(extracted);
          targetCase.isExpanded = true;
          state.isDirty = true;
        }
      }),

    moveCommandToCase: (commandId, fromCaseId, toCaseId) =>
      set((state) => {
        const fromCase = findCase(state.cases, fromCaseId);
        const toCase = findCase(state.cases, toCaseId);
        if (!fromCase || !toCase) return;

        const cmdIndex = fromCase.children.findIndex(
          (child) => isCommand(child) && child.id === commandId
        );
        if (cmdIndex === -1) return;

        const [cmd] = fromCase.children.splice(cmdIndex, 1);
        toCase.children.push(cmd);
        state.isDirty = true;
      }),

    setCurrentFile: (filename) =>
      set((state) => {
        state.currentFile = filename;
      }),

    reset: () =>
      set((state) => {
        state.cases = [];
        state.selectedCaseId = null;
        state.selectedCommandId = null;
        state.isDirty = false;
        state.currentFile = null;
      }),
  })),
  {
    name: 'serial-pilot-test-cases', // localStorage key
    // 只持久化工作区数据，排除 isDirty（运行态）和方法
    partialize: (state) => ({
      cases: state.cases,
      selectedCaseId: state.selectedCaseId,
      selectedCommandId: state.selectedCommandId,
      currentFile: state.currentFile,
    }),
    // 恢复时重置所有运行状态
    onRehydrateStorage: () => (state) => {
      if (state) {
        resetRuntimeStatus(state.cases);
        state.isDirty = false;
      }
    },
  }
)
);
