import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Folder,
  GripVertical,
  Play,
} from 'lucide-react';
import { AtCommandIcon, UrcIcon, ScriptIcon } from '@/components/icons/CommandTypeIcons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TestCase, TestCommand } from '@/types/testCase';
import { isCase, isCommand, flattenTree, getProjectedPosition } from '@/lib/testCaseUtils';
import type { ProjectedPosition } from '@/lib/testCaseUtils';
import { useSettingsStore } from '@/stores/settingsStore';

type DropPosition = 'before' | 'after' | 'inside';

// 每层缩进宽度（px），与渲染时的 level * 12 保持一致
const INDENT_WIDTH = 12;

// 头部/尾部放置区的固定 ID（Bug 1：拖到边界空白时命中，投影到根层级首/末）
const HEAD_DROP_ID = '__head_drop_zone__';
const TAIL_DROP_ID = '__tail_drop_zone__';

// 头部放置区：平时几乎无高度，仅拖拽激活时扩展为可命中的感应区
function HeadDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: HEAD_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={{ height: active ? 8 : 1 }}
    >
      {active && isOver && (
        <div className="absolute right-0 h-0.5 bg-blue-500 bottom-0 z-10" style={{ left: 6 }} />
      )}
    </div>
  );
}

// 尾部放置区：平时几乎无高度，仅拖拽激活时扩展为可命中的感应区
function TailDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: TAIL_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={{ height: active ? 8 : 1 }}
    >
      {active && isOver && (
        <div className="absolute right-0 h-0.5 bg-blue-500 top-0 z-10" style={{ left: 6 }} />
      )}
    </div>
  );
}

interface TestCaseTreeProps {
  cases: TestCase[];
  selectedCaseId: string | null;
  selectedCommandId: string | null;
  multiSelection: Set<string>;
  onSelectCase: (id: string, e?: React.MouseEvent) => void;
  onSelectCommand: (id: string, e?: React.MouseEvent) => void;
  onToggleExpanded: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, caseId: string, commandId?: string) => void;
  onEditCase: (caseId: string) => void;
  onEditCommand: (caseId: string, commandId: string) => void;
  onUpdateCommand: (caseId: string, commandId: string, patch: Partial<TestCommand>) => void;
  onMoveChildRelative: (childId: string, overId: string, position: DropPosition) => void;
  onMoveChildToPosition: (childId: string, targetParentId: string, targetIndex: number) => void;
  onRunCase?: (caseId: string) => void;
  onRunCommand?: (caseId: string, commandId: string) => void;
  isRunning?: boolean;
}

type StatusValue = TestCase['status'] | TestCommand['status'];

function StatusIcon({ status }: { status: StatusValue }) {
  switch (status) {
    case 'running':
      return <Clock className="h-3.5 w-3.5 text-status-running animate-spin" />;
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-status-error" />;
    case 'interrupted':
      return <XCircle className="h-3.5 w-3.5 text-status-timeout" />;
    case 'skipped':
      return <ChevronRight className="h-3.5 w-3.5 text-status-skipped" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-status-idle" />;
  }
}

// 命令类型对应的图标组件（统一图标，无徽章标识）
function CommandTypeIcon({ type }: { type: TestCommand['type'] }) {
  switch (type) {
    case 'urc-guard':
      return <UrcIcon />;
    case 'script':
      return <ScriptIcon />;
    default:
      return <AtCommandIcon />;
  }
}

// 命令内容摘要
function commandLabel(cmd: TestCommand, t: (key: string) => string): string {
  if (cmd.type === 'command') {
    // 优先显示 content，其次显示关联的文件名（如果有），最后才是"空命令"提示
    if (cmd.content) return cmd.content;
    if (cmd.fileData) return `📎 ${cmd.fileData.name}`;
    return t('testCase.emptyCommand');
  }
  if (cmd.type === 'urc-guard') {
    return cmd.pattern || t('testCase.patternNotSet');
  }
  if (cmd.type === 'script') {
    // 优先显示执行命令，其次脚本路径，最后提示未设置
    return cmd.command || cmd.scriptPath || t('testCase.scriptCommandNotSet');
  }
  return t('testCase.emptyCommand');
}

// 根据行高计算图标尺寸（px）
function getIconSize(rowHeight: number): number {
  // 24-28px: 14px, 29-36px: 16px, 37-48px: 18px
  if (rowHeight <= 28) return 14;
  if (rowHeight <= 36) return 16;
  return 18;
}

// 根据行高计算文字大小类名
function getTextSizeClass(rowHeight: number): string {
  // 24-28px: text-xs(12px), 29-36px: text-sm(14px), 37-48px: text-base(16px)
  if (rowHeight <= 28) return 'text-xs';
  if (rowHeight <= 36) return 'text-sm';
  return 'text-base';
}

// 可拖拽的命令行
function DraggableCommandRow({
  cmd,
  caseId,
  level,
  selected,
  multiSelected,
  onSelect,
  onContextMenu,
  onEditCommand,
  onUpdateCommand,
  onRun,
  isRunning,
  projected,
}: {
  cmd: TestCommand;
  caseId: string;
  level: number;
  selected: boolean;
  multiSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditCommand: () => void;
  onUpdateCommand: (patch: Partial<TestCommand>) => void;
  onRun?: () => void;
  isRunning?: boolean;
  projected: ProjectedPosition | null;
}) {
  const { t } = useTranslation();
  const { testCaseRowHeight, testCaseButtonWidth, testCaseButtonDisplay, testCaseButtonContent } = useSettingsStore();
  const iconSize = getIconSize(testCaseRowHeight);
  const textSizeClass = getTextSizeClass(testCaseRowHeight);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cmd.id,
    data: { type: 'command', caseId, command: cmd },
  });

  // 命令是叶子节点，根据投影位置显示插入线
  const isOver = projected?.overId === cmd.id;
  const showBefore = isOver && projected.offsetY === 0;
  const showAfter = isOver && projected.offsetY !== 0;
  const lineDepth = projected?.depth ?? (level + 1);

  // 行内编辑：仅正在编辑的行才渲染 input，其余行是纯文本（零常驻成本）
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 编辑的目标字段：普通命令改 content，URC 改 pattern，脚本改 scriptPath
  const editField = cmd.type === 'command' ? 'content' : cmd.type === 'urc-guard' ? 'pattern' : 'scriptPath';
  const currentValue = cmd.type === 'command' ? cmd.content : cmd.type === 'urc-guard' ? cmd.pattern : cmd.scriptPath;

  // 进入编辑态：聚焦并全选
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const beginEdit = () => {
    setDraft(currentValue || '');
    setEditing(true);
  };

  const commitEdit = () => {
    if (!editing) return;
    const trimmed = draft.trim();
    // 有变化才写回
    if (trimmed !== (currentValue || '')) {
      onUpdateCommand({ [editField]: trimmed });
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div className="relative">
      {/* 插入线 - before */}
      {showBefore && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -top-0.5 z-10"
          style={{ left: `${lineDepth * INDENT_WIDTH + 6}px` }}
        />
      )}

      <div
      ref={setNodeRef}
      style={{
        ...style,
        paddingLeft: `${(level + 1) * 12 + 6}px`,
        minHeight: `${testCaseRowHeight}px`,
      }}
      className={cn(
        'group flex items-center gap-1 px-1.5 cursor-pointer hover:bg-accent rounded transition-colors',
        selected && 'bg-accent',
        multiSelected && 'bg-blue-100 dark:bg-blue-900/30',
        !cmd.selected && 'opacity-50 border border-dashed border-muted-foreground/30',
      )}
      // 悬浮显示命令描述（原生 tooltip，零额外开销）；无描述时回退显示完整内容
      title={cmd.description || currentValue || undefined}
      onClick={(e) => onSelect(e)}
      onDoubleClick={onEditCommand}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical style={{ width: iconSize, height: iconSize }} />
      </button>
      <CommandTypeIcon type={cmd.type} />
      <StatusIcon status={cmd.status} />
      {editing ? (
        <input
          ref={inputRef}
          className={cn("flex-1 min-w-0 font-mono px-1 py-0 border border-primary rounded bg-background outline-none", textSizeClass)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // 阻止冒泡：编辑时不触发行选中/拖拽/双击
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          placeholder={
            editField === 'pattern'
              ? t('testCase.inputMatchContent')
              : editField === 'scriptPath'
                ? t('testCase.inputScriptPath')
                : t('testCase.inputCommandContent')
          }
        />
      ) : (
        <span
          className={cn(
            'flex-1 truncate font-mono',
            textSizeClass,
            !cmd.selected && 'text-muted-foreground',
            selected && 'hover:bg-primary/10 rounded px-0.5 -mx-0.5',
          )}
          // 选中后单击文字进入行内编辑（未选中时先当作选中，避免误触）
          onClick={(e) => {
            if (selected) {
              e.stopPropagation();
              beginEdit();
            }
          }}
        >
          {commandLabel(cmd, t)}
        </span>
      )}
      {onRun && (
        <button
          className={cn(
            "transition-all disabled:opacity-30 flex items-center justify-center font-medium text-green-600",
            textSizeClass,
            testCaseButtonDisplay === 'hover' && "opacity-0 group-hover:opacity-100",
            testCaseButtonDisplay === 'always' && "opacity-100",
          )}
          style={{
            width: `${testCaseButtonWidth}px`,
            height: `${testCaseRowHeight - 4}px`,
          }}
          title={t('testCase.runThisCommand')}
          disabled={isRunning}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {(() => {
            // 判断显示图标还是文字
            const showIcon = testCaseButtonContent === 'icon' ||
                            (testCaseButtonContent === 'auto' && testCaseButtonWidth < 50);
            const showText = testCaseButtonContent === 'text' ||
                            (testCaseButtonContent === 'auto' && testCaseButtonWidth >= 50);

            if (showIcon) {
              return <Play style={{ width: iconSize, height: iconSize }} />;
            }

            if (showText) {
              // 命令按钮只显示"发送"，不显示行结束符
              return <span>{t('testCase.send')}</span>;
            }

            return null;
          })()}
        </button>
      )}
    </div>

      {/* 插入线 - after */}
      {showAfter && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -bottom-0.5 z-10"
          style={{ left: `${lineDepth * INDENT_WIDTH + 6}px` }}
        />
      )}
    </div>
  );
}

// 可拖拽的用例节点（递归）
function DraggableCaseNode(props: {
  case_: TestCase;
  parentId: string | null;
  level: number;
  shared: Omit<
    TestCaseTreeProps,
    'cases' | 'onMoveChildRelative' | 'onMoveChildToPosition' | 'onEditCase' | 'onEditCommand' | 'onUpdateCommand'
  >;
  projected: ProjectedPosition | null;
  onEditCase: (caseId: string) => void;
  onEditCommand: (caseId: string, cmdId: string) => void;
  onUpdateCommand: (caseId: string, cmdId: string, patch: Partial<TestCommand>) => void;
}) {
  const { t } = useTranslation();
  const { testCaseRowHeight, testCaseButtonWidth, testCaseButtonDisplay, testCaseButtonContent } = useSettingsStore();
  const iconSize = getIconSize(testCaseRowHeight);
  const textSizeClass = getTextSizeClass(testCaseRowHeight);
  const { case_, level, shared, projected, onEditCase, onEditCommand, onUpdateCommand } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: case_.id,
    data: { type: 'case', parentId: props.parentId, case: case_ },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const commands = case_.children.filter(isCommand);
  const subCases = case_.children.filter(isCase);
  const hasChildren = case_.children.length > 0;

  // 投影落点：本节点是锚点时，根据 offsetY 判断插入线在上还是在下
  const isOver = projected?.overId === case_.id;
  const showBefore = isOver && projected.offsetY === 0;
  const showAfter = isOver && projected.offsetY !== 0;
  // 嵌套高亮：目标父节点是本用例（插入到内部）
  const showInside = projected?.parentId === case_.id && projected.overId === case_.id && projected.offsetY !== 0 && projected.depth > level;
  // 插入线缩进深度（用投影深度，回退到当前 level）
  const lineDepth = projected?.depth ?? level;

  return (
    <div className="relative">
      {/* 插入线 - before */}
      {showBefore && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -top-0.5 z-10"
          style={{ left: `${lineDepth * INDENT_WIDTH + 6}px` }}
        />
      )}

      {/* 用例节点行（拖拽检测绑定到标题行，不含子树） */}
      <div
        ref={setNodeRef}
        className={cn(
          'group flex items-center gap-1 px-1.5 cursor-pointer hover:bg-accent rounded transition-colors',
          shared.selectedCaseId === case_.id && 'bg-accent',
          shared.multiSelection.has(case_.id) && 'bg-blue-100 dark:bg-blue-900/30',
          showInside && 'ring-2 ring-blue-500',
          !case_.selected && 'opacity-50 border border-dashed border-muted-foreground/30',
          isDragging && 'opacity-30',
        )}
        style={{
          paddingLeft: `${level * 12 + 6}px`,
          minHeight: `${testCaseRowHeight}px`,
          ...style,
        }}
        onClick={(e) => shared.onSelectCase(case_.id, e)}
        onDoubleClick={() => onEditCase(case_.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          shared.onContextMenu(e, case_.id);
        }}
      >
        <button
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical style={{ width: iconSize, height: iconSize }} />
        </button>

        {hasChildren ? (
          <button
            className="p-0 hover:bg-accent-foreground/10 rounded"
            onClick={(e) => {
              e.stopPropagation();
              shared.onToggleExpanded(case_.id);
            }}
          >
            {case_.isExpanded ? (
              <ChevronDown style={{ width: iconSize + 2, height: iconSize + 2 }} />
            ) : (
              <ChevronRight style={{ width: iconSize + 2, height: iconSize + 2 }} />
            )}
          </button>
        ) : (
          <div style={{ width: iconSize + 2 }} />
        )}

        <Folder style={{ width: iconSize, height: iconSize }} className="text-blue-500" />
        <StatusIcon status={case_.status} />
        <span className={cn('flex-1 truncate', textSizeClass, !case_.selected && 'text-muted-foreground')}>
          {case_.name}
        </span>
        {case_.runCount !== 1 && (
          <span className={cn("px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded", textSizeClass)}>
            {case_.runCount === 0 ? t('testCase.infiniteLoop') : `×${case_.runCount}`}
          </span>
        )}
        {shared.onRunCase && (
          <button
            className={cn(
              "transition-all disabled:opacity-30 flex items-center justify-center font-medium text-green-600",
              textSizeClass,
              testCaseButtonDisplay === 'hover' && "opacity-0 group-hover:opacity-100",
              testCaseButtonDisplay === 'always' && "opacity-100",
            )}
            style={{
              width: `${testCaseButtonWidth}px`,
              height: `${testCaseRowHeight - 4}px`,
            }}
            title={t('testCase.runThisCase')}
            disabled={shared.isRunning}
            onClick={(e) => {
              e.stopPropagation();
              shared.onRunCase?.(case_.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {(() => {
              // 判断显示图标还是文字
              const showIcon = testCaseButtonContent === 'icon' ||
                              (testCaseButtonContent === 'auto' && testCaseButtonWidth < 50);

              if (showIcon) {
                return <Play style={{ width: iconSize + 2, height: iconSize + 2 }} />;
              }

              // 用例按钮显示"运行"
              return <span>{t('testCase.run')}</span>;
            })()}
          </button>
        )}
      </div>

      {/* 展开内容：按 children 原始顺序渲染 */}
      {case_.isExpanded && (
        <div>
          {case_.children.map((child) =>
            isCommand(child) ? (
              <DraggableCommandRow
                key={child.id}
                cmd={child}
                caseId={case_.id}
                level={level}
                selected={shared.selectedCommandId === child.id}
                multiSelected={shared.multiSelection.has(child.id)}
                onSelect={(e) => shared.onSelectCommand(child.id, e)}
                onContextMenu={(e) => shared.onContextMenu(e, case_.id, child.id)}
                onEditCommand={() => onEditCommand(case_.id, child.id)}
                onUpdateCommand={(patch) => onUpdateCommand(case_.id, child.id, patch)}
                onRun={shared.onRunCommand ? () => shared.onRunCommand?.(case_.id, child.id) : undefined}
                isRunning={shared.isRunning}
                projected={projected}
              />
            ) : (
              <DraggableCaseNode
                key={child.id}
                case_={child}
                parentId={case_.id}
                level={level + 1}
                shared={shared}
                projected={projected}
                onEditCase={onEditCase}
                onEditCommand={onEditCommand}
                onUpdateCommand={onUpdateCommand}
              />
            ),
          )}
          {commands.length === 0 && subCases.length === 0 && null}
        </div>
      )}

      {/* 插入线 - after（缩进按投影深度，实现跨层级视觉反馈） */}
      {showAfter && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -bottom-0.5 z-10"
          style={{ left: `${lineDepth * INDENT_WIDTH + 6}px` }}
        />
      )}
    </div>
  );
}

export function TestCaseTree(props: TestCaseTreeProps) {
  const { t } = useTranslation();
  const {
    cases,
    onMoveChildRelative,
    onMoveChildToPosition,
    onEditCase,
    onEditCommand,
    onUpdateCommand,
    ...shared
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);
  // 投影位置：X+Y 双维度计算的精确落点，null=无有效落点
  const [projected, setProjected] = useState<ProjectedPosition | null>(null);
  // 记录拖拽时的鼠标 X 坐标（dnd-kit 不直接提供，需从事件中提取）
  const pointerXRef = useRef<number>(0);

  const rootId = cases.length > 0 ? cases[0].id : '';
  // 扁平化当前可见树（用于投影计算）
  const flatNodes = rootId ? flattenTree(cases[0].children, 0, rootId) : [];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setProjected(null);
  };

  const handleDragMove = (event: DragOverEvent) => {
    // 从原生指针事件持续记录 X 坐标（activatorEvent 只有起点，delta 提供偏移）
    if (event.activatorEvent && 'clientX' in event.activatorEvent) {
      pointerXRef.current = (event.activatorEvent as PointerEvent).clientX + (event.delta.x || 0);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setProjected(null);
      return;
    }

    // Bug 1：拖到头部放置区时，投影到根层级首位
    if (over.id === HEAD_DROP_ID) {
      const rootParentId = flatNodes[0]?.parentId;
      if (rootParentId) {
        setProjected({
          parentId: rootParentId,
          index: 0,
          depth: 0,
          overId: HEAD_DROP_ID,
          offsetY: 0,
        });
      } else {
        setProjected(null);
      }
      return;
    }

    // Bug 1：拖到尾部放置区时，投影到根层级末尾
    if (over.id === TAIL_DROP_ID) {
      const rootParentId = flatNodes[0]?.parentId;
      if (rootParentId) {
        setProjected({
          parentId: rootParentId,
          index: flatNodes.filter((n) => n.depth === 0).length,
          depth: 0,
          overId: TAIL_DROP_ID,
          offsetY: 0,
        });
      } else {
        setProjected(null);
      }
      return;
    }

    const overRect = over.rect;
    const pointerX = pointerXRef.current || overRect.left;
    const pointerY = event.activatorEvent && 'clientY' in event.activatorEvent
      ? (event.activatorEvent as PointerEvent).clientY + (event.delta.y || 0)
      : overRect.top + overRect.height / 2;

    // 用投影算法计算精确落点（X 决定层级深度，Y 决定前后位置）
    const rect = new DOMRect(overRect.left, overRect.top, overRect.width, overRect.height);
    const proj = getProjectedPosition(
      flatNodes,
      active.id as string,
      over.id as string,
      pointerX,
      pointerY,
      rect,
      INDENT_WIDTH,
    );
    setProjected(proj);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    const finalProjected = projected;
    setProjected(null);

    if (!over || active.id === over.id) return;
    if (!finalProjected) return;

    // 用投影位置精确移动：目标父 + 目标索引
    onMoveChildToPosition(active.id as string, finalProjected.parentId, finalProjected.index);
  };

  const root = cases.length > 0 ? cases[0] : null;
  const hasContent = root && root.children.length > 0;
  // 收集所有可拖拽节点 ID（含嵌套），供 SortableContext 计算排序
  const allIds = root ? collectAllIds(root.children) : [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-1 p-2">
          {!hasContent ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {t('testCase.emptyState')}
            </div>
          ) : (
            <>
            {/* 头部放置区：拖到最顶部空白时插入到根层级首位 */}
            {hasContent && <HeadDropZone active={!!activeId} />}
            {root.children.map((child) =>
              isCommand(child) ? (
                <DraggableCommandRow
                  key={child.id}
                  cmd={child}
                  caseId={root.id}
                  level={-1}
                  selected={shared.selectedCommandId === child.id}
                  multiSelected={shared.multiSelection.has(child.id)}
                  onSelect={(e) => shared.onSelectCommand(child.id, e)}
                  onContextMenu={(e) => shared.onContextMenu(e, root.id, child.id)}
                  onEditCommand={() => onEditCommand(root.id, child.id)}
                  onUpdateCommand={(patch) => onUpdateCommand(root.id, child.id, patch)}
                  onRun={shared.onRunCommand ? () => shared.onRunCommand?.(root.id, child.id) : undefined}
                  isRunning={shared.isRunning}
                  projected={projected}
                />
              ) : (
                <DraggableCaseNode
                  key={child.id}
                  case_={child}
                  parentId={root.id}
                  level={0}
                  shared={shared}
                  projected={projected}
                  onEditCase={onEditCase}
                  onEditCommand={onEditCommand}
                  onUpdateCommand={onUpdateCommand}
                />
              ),
            )}
            {/* 尾部放置区：拖到最底部空白时插入到根层级末尾 */}
            <TailDropZone active={!!activeId} />
            </>
          )}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeId && <div className="bg-blue-100 px-3 py-1 rounded shadow-lg">{t('testCase.dragging')}</div>}
      </DragOverlay>
    </DndContext>
  );
}

// 递归收集所有节点 ID（命令 + 用例，含嵌套）
function collectAllIds(children: (TestCase | TestCommand)[]): string[] {
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    if (isCase(child)) {
      ids.push(...collectAllIds(child.children));
    }
  }
  return ids;
}
