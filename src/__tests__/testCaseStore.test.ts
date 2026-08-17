import { describe, it, expect, beforeEach } from 'vitest';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { createCase, createCommand } from '@/lib/testCaseUtils';
import type { StandardCommand, TestCase, TestCommand } from '@/types/testCase';

/** 创建带内容的命令 */
function cmd(content: string): StandardCommand {
  const c = createCommand('command') as StandardCommand;
  c.content = content;
  return c;
}

/** 直接设置 store 的用例树（测试辅助） */
function setCases(cases: TestCase[]) {
  useTestCaseStore.setState({ cases });
}

describe('testCaseStore', () => {
  beforeEach(() => {
    useTestCaseStore.getState().reset();
  });

  describe('基础操作', () => {
    it('addCase 应添加顶级用例', () => {
      const { addCase } = useTestCaseStore.getState();

      addCase(null);
      addCase(null);

      expect(useTestCaseStore.getState().cases).toHaveLength(2);
    });

    it('addCase 应添加子用例并展开父级', () => {
      const { addCase } = useTestCaseStore.getState();

      addCase(null);
      const rootId = useTestCaseStore.getState().cases[0].id;

      addCase(rootId);

      const root = useTestCaseStore.getState().cases[0];
      const childCases = root.children.filter((child) => 'children' in child);
      expect(childCases).toHaveLength(1);
      expect(root.isExpanded).toBe(true);
    });

    it('removeCase 应删除用例', () => {
      const { addCase, removeCase } = useTestCaseStore.getState();

      addCase(null);
      const caseId = useTestCaseStore.getState().cases[0].id;

      removeCase(caseId);

      expect(useTestCaseStore.getState().cases).toHaveLength(0);
    });

    it('removeCase 应递归删除嵌套子用例', () => {
      const root = createCase('根');
      const child = createCase('子');
      root.children = [child];
      setCases([root]);

      useTestCaseStore.getState().removeCase(child.id);

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(0);
    });

    it('addCommand 应添加普通命令和 URC 守护命令', () => {
      const { addCase, addCommand } = useTestCaseStore.getState();

      addCase(null);
      const caseId = useTestCaseStore.getState().cases[0].id;

      addCommand(caseId, 'command');
      addCommand(caseId, 'urc-guard');

      const children = useTestCaseStore.getState().cases[0].children;
      expect(children).toHaveLength(2);
      expect((children[0] as TestCommand).type).toBe('command');
      expect((children[1] as TestCommand).type).toBe('urc-guard');
    });

    it('removeCommand 应删除命令', () => {
      const testCase = createCase('用例');
      testCase.children = [cmd('AT'), cmd('AT+GMR')];
      setCases([testCase]);

      useTestCaseStore.getState().removeCommand(testCase.id, testCase.children[0].id);

      const commands = useTestCaseStore.getState().cases[0].children.filter(
        (child) => 'content' in child
      );
      expect(commands).toHaveLength(1);
      expect((commands[0] as StandardCommand).content).toBe('AT+GMR');
    });

    it('updateCase 应更新用例属性', () => {
      const { addCase, updateCase } = useTestCaseStore.getState();

      addCase(null);
      const caseId = useTestCaseStore.getState().cases[0].id;

      updateCase(caseId, { name: '新名称', description: '测试描述' });

      const updated = useTestCaseStore.getState().cases[0];
      expect(updated.name).toBe('新名称');
      expect(updated.description).toBe('测试描述');
    });

    it('updateCommand 应更新命令属性', () => {
      const testCase = createCase('用例');
      testCase.children = [cmd('AT')];
      setCases([testCase]);
      const commandId = testCase.children[0].id;

      useTestCaseStore.getState().updateCommand(testCase.id, commandId, {
        content: 'AT+GMR',
        timeout: 5000,
      });

      const updated = useTestCaseStore.getState().cases[0].children[0] as StandardCommand;
      expect(updated.content).toBe('AT+GMR');
      expect(updated.timeout).toBe(5000);
    });

    it('toggleExpanded 应切换展开状态', () => {
      const root = createCase('根');
      root.isExpanded = true;
      setCases([root]);

      useTestCaseStore.getState().toggleExpanded(root.id);
      expect(useTestCaseStore.getState().cases[0].isExpanded).toBe(false);

      useTestCaseStore.getState().toggleExpanded(root.id);
      expect(useTestCaseStore.getState().cases[0].isExpanded).toBe(true);
    });
  });

  describe('reorderChildren - 统一重排接口', () => {
    it('应在顶级重排用例', () => {
      const a = createCase('A');
      const b = createCase('B');
      const c = createCase('C');
      setCases([a, b, c]);

      // 将索引 2 (C) 移到索引 0
      useTestCaseStore.getState().reorderChildren(null, 2, 0);

      const cases = useTestCaseStore.getState().cases;
      expect(cases[0].name).toBe('C');
      expect(cases[1].name).toBe('A');
      expect(cases[2].name).toBe('B');
    });

    it('应在子用例层级重排 children', () => {
      const root = createCase('根');
      root.children = [createCase('Sub1'), createCase('Sub2'), createCase('Sub3')];
      setCases([root]);

      useTestCaseStore.getState().reorderChildren(root.id, 0, 2);

      const children = useTestCaseStore.getState().cases[0].children as TestCase[];
      expect(children[0].name).toBe('Sub2');
      expect(children[1].name).toBe('Sub3');
      expect(children[2].name).toBe('Sub1');
    });

    it('应重排混合的命令和用例', () => {
      const root = createCase('根');
      const subCase = createCase('子用例');
      root.children = [cmd('AT'), subCase, cmd('AT+GMR')];
      setCases([root]);

      // 将索引 2 (AT+GMR) 移到索引 0
      useTestCaseStore.getState().reorderChildren(root.id, 2, 0);

      const children = useTestCaseStore.getState().cases[0].children;
      expect((children[0] as StandardCommand).content).toBe('AT+GMR');
      expect((children[1] as StandardCommand).content).toBe('AT');
      expect((children[2] as TestCase).name).toBe('子用例');
    });

    it('超出范围的索引应不改变顺序', () => {
      const a = createCase('A');
      const b = createCase('B');
      setCases([a, b]);

      useTestCaseStore.getState().reorderChildren(null, 0, 10);

      const cases = useTestCaseStore.getState().cases;
      expect(cases[0].name).toBe('A');
      expect(cases[1].name).toBe('B');
    });
  });

  describe('reorderCases - 兼容包装', () => {
    it('应通过兼容接口重排顶级用例', () => {
      const a = createCase('A');
      const b = createCase('B');
      const c = createCase('C');
      setCases([a, b, c]);

      useTestCaseStore.getState().reorderCases(null, 2, 0);

      const cases = useTestCaseStore.getState().cases;
      expect(cases[0].name).toBe('C');
      expect(cases[1].name).toBe('A');
      expect(cases[2].name).toBe('B');
    });

    it('应在子层级重排', () => {
      const root = createCase('根');
      root.children = [createCase('Sub1'), createCase('Sub2'), createCase('Sub3')];
      setCases([root]);

      useTestCaseStore.getState().reorderCases(root.id, 0, 2);

      const children = useTestCaseStore.getState().cases[0].children as TestCase[];
      expect(children[0].name).toBe('Sub2');
      expect(children[1].name).toBe('Sub3');
      expect(children[2].name).toBe('Sub1');
    });
  });

  describe('reorderCommands - 兼容包装', () => {
    it('应重排用例内的命令', () => {
      const testCase = createCase('测试');
      testCase.children = [cmd('AT'), cmd('AT+GMR'), cmd('AT+CSQ')];
      setCases([testCase]);

      useTestCaseStore.getState().reorderCommands(testCase.id, 2, 0);

      const commands = useTestCaseStore.getState().cases[0].children as StandardCommand[];
      expect(commands[0].content).toBe('AT+CSQ');
      expect(commands[1].content).toBe('AT');
      expect(commands[2].content).toBe('AT+GMR');
    });

    it('超出范围的索引应不改变顺序', () => {
      const testCase = createCase('测试');
      testCase.children = [cmd('AT'), cmd('AT+GMR')];
      setCases([testCase]);

      useTestCaseStore.getState().reorderCommands(testCase.id, 0, 99);

      const commands = useTestCaseStore.getState().cases[0].children as StandardCommand[];
      expect(commands[0].content).toBe('AT');
      expect(commands[1].content).toBe('AT+GMR');
    });
  });

  describe('moveCaseToCase - 跨层级移动用例', () => {
    it('应将用例移动到另一用例的子项中', () => {
      const root1 = createCase('根1');
      const root2 = createCase('根2');
      const child = createCase('子用例');
      root1.children = [child];
      setCases([root1, root2]);

      useTestCaseStore.getState().moveCaseToCase(child.id, root2.id);

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(0); // root1 空了
      expect(state[1].children).toHaveLength(1); // root2 有了
      expect((state[1].children[0] as TestCase).name).toBe('子用例');
      expect(state[1].isExpanded).toBe(true); // 自动展开
    });

    it('应防止拖到自己', () => {
      const root = createCase('根');
      setCases([root]);

      useTestCaseStore.getState().moveCaseToCase(root.id, root.id);

      const state = useTestCaseStore.getState().cases;
      expect(state).toHaveLength(1);
      expect(state[0].id).toBe(root.id);
      expect(state[0].children).toHaveLength(0);
    });

    it('应防止拖到自己的子孙节点', () => {
      const root = createCase('根');
      const child = createCase('子');
      const grandchild = createCase('孙');
      child.children = [grandchild];
      root.children = [child];
      setCases([root]);

      // 尝试将 root 拖到 grandchild
      useTestCaseStore.getState().moveCaseToCase(root.id, grandchild.id);

      const state = useTestCaseStore.getState().cases;
      expect(state).toHaveLength(1);
      expect(state[0].id).toBe(root.id);
      const childCase = state[0].children[0] as TestCase;
      expect(childCase.id).toBe(child.id);
      const grandchildCase = childCase.children[0] as TestCase;
      expect(grandchildCase.id).toBe(grandchild.id);
    });

    it('应支持从深层嵌套移到顶级用例', () => {
      const root1 = createCase('根1');
      const root2 = createCase('根2');
      const middle = createCase('中间');
      const deep = createCase('深层子');
      middle.children = [deep];
      root1.children = [middle];
      setCases([root1, root2]);

      useTestCaseStore.getState().moveCaseToCase(deep.id, root2.id);

      const state = useTestCaseStore.getState().cases;
      const middleCase = state[0].children[0] as TestCase;
      expect(middleCase.children).toHaveLength(0); // 原位置空了
      expect(state[1].children).toHaveLength(1);
      expect((state[1].children[0] as TestCase).name).toBe('深层子');
    });
  });

  describe('moveCommandToCase - 跨用例移动命令', () => {
    it('应将命令从一个用例移到另一个用例', () => {
      const case1 = createCase('用例1');
      const case2 = createCase('用例2');
      case1.children = [cmd('AT'), cmd('AT+GMR')];
      setCases([case1, case2]);

      const commandId = case1.children[0].id;
      useTestCaseStore.getState().moveCommandToCase(commandId, case1.id, case2.id);

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(1);
      expect((state[0].children[0] as StandardCommand).content).toBe('AT+GMR');
      expect(state[1].children).toHaveLength(1);
      expect((state[1].children[0] as StandardCommand).content).toBe('AT');
    });

    it('无效的目标用例 ID 应不改变状态', () => {
      const case1 = createCase('用例1');
      case1.children = [cmd('AT')];
      setCases([case1]);
      const commandId = case1.children[0].id;

      useTestCaseStore.getState().moveCommandToCase(commandId, case1.id, 'invalid-id');

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(1);
    });

    it('无效的命令 ID 应不改变状态', () => {
      const case1 = createCase('用例1');
      const case2 = createCase('用例2');
      case1.children = [cmd('AT')];
      setCases([case1, case2]);

      useTestCaseStore.getState().moveCommandToCase('invalid-cmd', case1.id, case2.id);

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(1);
      expect(state[1].children).toHaveLength(0);
    });
  });

  describe('moveChildToCase - 统一移动接口', () => {
    it('应将命令移动到另一用例', () => {
      const case1 = createCase('用例1');
      const case2 = createCase('用例2');
      case1.children = [cmd('AT'), cmd('AT+GMR')];
      setCases([case1, case2]);

      const commandId = case1.children[0].id;
      useTestCaseStore.getState().moveChildToCase(commandId, case1.id, case2.id);

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(1);
      expect((state[0].children[0] as StandardCommand).content).toBe('AT+GMR');
      expect(state[1].children).toHaveLength(1);
      expect((state[1].children[0] as StandardCommand).content).toBe('AT');
    });

    it('应将子用例移动到另一用例', () => {
      const root1 = createCase('根1');
      const root2 = createCase('根2');
      const child = createCase('子用例');
      root1.children = [child];
      setCases([root1, root2]);

      useTestCaseStore.getState().moveChildToCase(child.id, root1.id, root2.id);

      const state = useTestCaseStore.getState().cases;
      expect(state[0].children).toHaveLength(0);
      expect(state[1].children).toHaveLength(1);
      expect((state[1].children[0] as TestCase).name).toBe('子用例');
      expect(state[1].isExpanded).toBe(true);
    });

    it('应防止将用例移到自己', () => {
      const root = createCase('根');
      setCases([root]);

      useTestCaseStore.getState().moveChildToCase(root.id, root.id, root.id);

      const state = useTestCaseStore.getState().cases;
      expect(state).toHaveLength(1);
      expect(state[0].id).toBe(root.id);
    });
  });

  describe('moveChildRelative - 精确位置拖拽', () => {
    it('问题1：应将命令拖到用例前面（before）实现同级混排', () => {
      // 初始：|用例A |用例B |命令
      // 目标：|命令 |用例A |用例B（命令拖到用例A前）
      const root = createCase('根');
      const caseA = createCase('用例A');
      const caseB = createCase('用例B');
      const command = cmd('AT');
      root.children = [caseA, caseB, command];
      setCases([root]);

      useTestCaseStore.getState().moveChildRelative(command.id, caseA.id, 'before');

      const state = useTestCaseStore.getState().cases[0];
      expect(state.children).toHaveLength(3);
      expect((state.children[0] as TestCommand).content).toBe('AT'); // 命令到最前
      expect((state.children[1] as TestCase).name).toBe('用例A');
      expect((state.children[2] as TestCase).name).toBe('用例B');
    });

    it('问题1变体：应将命令拖到用例之间（after）', () => {
      // 初始：|用例A |用例B |命令
      // 目标：|用例A |命令 |用例B（命令拖到用例A后）
      const root = createCase('根');
      const caseA = createCase('用例A');
      const caseB = createCase('用例B');
      const command = cmd('AT');
      root.children = [caseA, caseB, command];
      setCases([root]);

      useTestCaseStore.getState().moveChildRelative(command.id, caseA.id, 'after');

      const state = useTestCaseStore.getState().cases[0];
      expect(state.children).toHaveLength(3);
      expect((state.children[0] as TestCase).name).toBe('用例A');
      expect((state.children[1] as TestCommand).content).toBe('AT'); // 命令在中间
      expect((state.children[2] as TestCase).name).toBe('用例B');
    });

    it('问题2：应将嵌套子用例拖到父级旁边提升层级（after）', () => {
      // 初始：|用例A -|用例B
      // 目标：|用例A |用例B（用例B提升，拖到用例A后）
      const root = createCase('根');
      const caseA = createCase('用例A');
      const caseB = createCase('用例B');
      caseA.children = [caseB];
      root.children = [caseA];
      setCases([root]);

      useTestCaseStore.getState().moveChildRelative(caseB.id, caseA.id, 'after');

      const state = useTestCaseStore.getState().cases[0];
      expect(state.children).toHaveLength(2); // root 现在有两个直接子级
      expect((state.children[0] as TestCase).name).toBe('用例A');
      expect((state.children[0] as TestCase).children).toHaveLength(0); // A 不再有子级
      expect((state.children[1] as TestCase).name).toBe('用例B'); // B 提升到根下
    });

    it('应将节点拖入用例内部（inside）', () => {
      // |用例A |命令 → 拖命令到用例A内 → |用例A -|命令
      const root = createCase('根');
      const caseA = createCase('用例A');
      const command = cmd('AT');
      root.children = [caseA, command];
      setCases([root]);

      useTestCaseStore.getState().moveChildRelative(command.id, caseA.id, 'inside');

      const state = useTestCaseStore.getState().cases[0];
      expect(state.children).toHaveLength(1); // 根只剩用例A
      const childCase = state.children[0] as TestCase;
      expect(childCase.name).toBe('用例A');
      expect(childCase.children).toHaveLength(1);
      expect((childCase.children[0] as TestCommand).content).toBe('AT');
      expect(childCase.isExpanded).toBe(true); // inside 会展开目标
    });

    it('应防止将用例拖入自己的后代（循环依赖）', () => {
      // |用例A -|用例B，尝试把A拖入B → 应拒绝
      const root = createCase('根');
      const caseA = createCase('用例A');
      const caseB = createCase('用例B');
      caseA.children = [caseB];
      root.children = [caseA];
      setCases([root]);

      useTestCaseStore.getState().moveChildRelative(caseA.id, caseB.id, 'inside');

      // 结构不应变化
      const state = useTestCaseStore.getState().cases[0];
      expect(state.children).toHaveLength(1);
      expect((state.children[0] as TestCase).name).toBe('用例A');
      expect((state.children[0] as TestCase).children).toHaveLength(1);
    });

    it('拖到自己应无操作', () => {
      const root = createCase('根');
      const caseA = createCase('用例A');
      root.children = [caseA];
      setCases([root]);

      useTestCaseStore.getState().moveChildRelative(caseA.id, caseA.id, 'before');

      const state = useTestCaseStore.getState().cases[0];
      expect(state.children).toHaveLength(1);
      expect((state.children[0] as TestCase).name).toBe('用例A');
    });
  });

  describe('reset', () => {
    it('应清空所有用例', () => {
      const { addCase, reset } = useTestCaseStore.getState();

      addCase(null);
      addCase(null);

      reset();

      expect(useTestCaseStore.getState().cases).toHaveLength(0);
    });
  });
});
