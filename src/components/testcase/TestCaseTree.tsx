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
import { isCase, isCommand } from '@/lib/testCaseUtils';

type DropPosition = 'before' | 'after' | 'inside';
type DropIndicator = { overId: string; position: DropPosition } | null;

interface TestCaseTreeProps {
  cases: TestCase[];
  selectedCaseId: string | null;
  selectedCommandId: string | null;
  onSelectCase: (id: string) => void;
  onSelectCommand: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, caseId: string, commandId?: string) => void;
  onEditCase: (caseId: string) => void;
  onEditCommand: (caseId: string, commandId: string) => void;
  onUpdateCommand: (caseId: string, commandId: string, patch: Partial<TestCommand>) => void;
  onMoveChildRelative: (childId: string, overId: string, position: DropPosition) => void;
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

// 可拖拽的命令行
function DraggableCommandRow({
  cmd,
  caseId,
  level,
  selected,
  onSelect,
  onContextMenu,
  onEditCommand,
  onUpdateCommand,
  onRun,
  isRunning,
  dropIndicator,
}: {
  cmd: TestCommand;
  caseId: string;
  level: number;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditCommand: () => void;
  onUpdateCommand: (patch: Partial<TestCommand>) => void;
  onRun?: () => void;
  isRunning?: boolean;
  dropIndicator: DropIndicator;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cmd.id,
    data: { type: 'command', caseId, command: cmd },
  });

  // 命令是叶子节点，只接受 before/after（不能作为容器）
  const showBefore = dropIndicator?.overId === cmd.id && dropIndicator.position === 'before';
  const showAfter = dropIndicator?.overId === cmd.id && dropIndicator.position === 'after';

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
          style={{ left: `${(level + 1) * 12 + 6}px` }}
        />
      )}

      <div
      ref={setNodeRef}
      style={{ ...style, paddingLeft: `${(level + 1) * 12 + 6}px` }}
      className={cn(
        'group flex items-center gap-1 px-1.5 py-0.5 cursor-pointer hover:bg-accent rounded transition-colors',
        selected && 'bg-accent',
        !cmd.selected && 'opacity-50 border border-dashed border-muted-foreground/30',
      )}
      // 悬浮显示命令描述（原生 tooltip，零额外开销）；无描述时回退显示完整内容
      title={cmd.description || currentValue || undefined}
      onClick={onSelect}
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
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <CommandTypeIcon type={cmd.type} />
      <StatusIcon status={cmd.status} />
      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 min-w-0 text-xs font-mono px-1 py-0 border border-primary rounded bg-background outline-none"
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
            'flex-1 text-xs truncate font-mono',
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
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-green-100 text-green-600 transition-opacity disabled:opacity-30"
          title={t('testCase.runThisCommand')}
          disabled={isRunning}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
    </div>

      {/* 插入线 - after */}
      {showAfter && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -bottom-0.5 z-10"
          style={{ left: `${(level + 1) * 12 + 6}px` }}
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
    'cases' | 'onMoveChildRelative' | 'onEditCase' | 'onEditCommand' | 'onUpdateCommand'
  >;
  dropIndicator: DropIndicator;
  onEditCase: (caseId: string) => void;
  onEditCommand: (caseId: string, cmdId: string) => void;
  onUpdateCommand: (caseId: string, cmdId: string, patch: Partial<TestCommand>) => void;
}) {
  const { t } = useTranslation();
  const { case_, level, shared, dropIndicator, onEditCase, onEditCommand, onUpdateCommand } = props;
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

  // 三种落点：before/after 显示插入线，inside 显示整节点高亮框
  const showBefore = dropIndicator?.overId === case_.id && dropIndicator.position === 'before';
  const showAfter = dropIndicator?.overId === case_.id && dropIndicator.position === 'after';
  const showInside = dropIndicator?.overId === case_.id && dropIndicator.position === 'inside';

  return (
    <div className="relative">
      {/* 插入线 - before */}
      {showBefore && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -top-0.5 z-10"
          style={{ left: `${level * 12 + 6}px` }}
        />
      )}

      {/* 用例节点行（拖拽检测绑定到标题行，不含子树） */}
      <div
        ref={setNodeRef}
        className={cn(
          'group flex items-center gap-1 px-1.5 py-0.5 cursor-pointer hover:bg-accent rounded transition-colors',
          shared.selectedCaseId === case_.id && 'bg-accent',
          showInside && 'ring-2 ring-blue-400',
          !case_.selected && 'opacity-50 border border-dashed border-muted-foreground/30',
          isDragging && 'opacity-30',
        )}
        style={{ paddingLeft: `${level * 12 + 6}px`, ...style }}
        onClick={() => shared.onSelectCase(case_.id)}
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
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {hasChildren ? (
          <button
            className="p-0 hover:bg-accent-foreground/10 rounded"
            onClick={(e) => {
              e.stopPropagation();
              shared.onToggleExpanded(case_.id);
            }}
          >
            {case_.isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <div className="w-4" />
        )}

        <Folder className="h-3.5 w-3.5 text-blue-500" />
        <StatusIcon status={case_.status} />
        <span className={cn('flex-1 text-xs truncate', !case_.selected && 'text-muted-foreground')}>
          {case_.name}
        </span>
        {case_.runCount !== 1 && (
          <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
            {case_.runCount === 0 ? t('testCase.infiniteLoop') : `×${case_.runCount}`}
          </span>
        )}
        {shared.onRunCase && (
          <button
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-green-100 text-green-600 transition-opacity disabled:opacity-30"
            title={t('testCase.runThisCase')}
            disabled={shared.isRunning}
            onClick={(e) => {
              e.stopPropagation();
              shared.onRunCase?.(case_.id);
            }}
          >
            <Play className="h-4 w-4" />
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
                onSelect={() => shared.onSelectCommand(child.id)}
                onContextMenu={(e) => shared.onContextMenu(e, case_.id, child.id)}
                onEditCommand={() => onEditCommand(case_.id, child.id)}
                onUpdateCommand={(patch) => onUpdateCommand(case_.id, child.id, patch)}
                onRun={shared.onRunCommand ? () => shared.onRunCommand?.(case_.id, child.id) : undefined}
                isRunning={shared.isRunning}
                dropIndicator={dropIndicator}
              />
            ) : (
              <DraggableCaseNode
                key={child.id}
                case_={child}
                parentId={case_.id}
                level={level + 1}
                shared={shared}
                dropIndicator={dropIndicator}
                onEditCase={onEditCase}
                onEditCommand={onEditCommand}
                onUpdateCommand={onUpdateCommand}
              />
            ),
          )}
          {commands.length === 0 && subCases.length === 0 && null}
        </div>
      )}

      {/* 插入线 - after */}
      {showAfter && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-blue-500 -bottom-0.5 z-10"
          style={{ left: `${level * 12 + 6}px` }}
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
    onEditCase,
    onEditCommand,
    onUpdateCommand,
    ...shared
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setDropIndicator(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropIndicator(null);
      return;
    }

    const overData = over.data.current;
    if (!overData) {
      setDropIndicator(null);
      return;
    }

    // 获取 over 节点的矩形和指针的当前 Y 坐标
    const overRect = over.rect;
    // delta 是从拖动开始点的偏移量，active.rect.current.translated 包含了当前位置
    const pointerY = event.activatorEvent && 'clientY' in event.activatorEvent
      ? (event.activatorEvent as PointerEvent).clientY + (event.delta.y || 0)
      : overRect.top + overRect.height / 2;

    const relativeY = pointerY - overRect.top;
    const percent = relativeY / overRect.height;

    // 用例节点：上 30% = before，中间 40% = inside，下 30% = after
    // 命令节点：上 50% = before，下 50% = after（命令不能作为容器）
    let position: DropPosition;
    if (overData.type === 'case') {
      if (percent < 0.3) {
        position = 'before';
      } else if (percent > 0.7) {
        position = 'after';
      } else {
        position = 'inside';
      }
    } else {
      // command
      position = percent < 0.5 ? 'before' : 'after';
    }

    setDropIndicator({ overId: over.id as string, position });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDropIndicator(null);

    if (!over || active.id === over.id) return;
    if (!dropIndicator) return;

    // 统一调用 moveChildRelative，根据 dropIndicator 的位置信息完成操作
    onMoveChildRelative(active.id as string, dropIndicator.overId, dropIndicator.position);
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
            root.children.map((child) =>
              isCommand(child) ? (
                <DraggableCommandRow
                  key={child.id}
                  cmd={child}
                  caseId={root.id}
                  level={-1}
                  selected={shared.selectedCommandId === child.id}
                  onSelect={() => shared.onSelectCommand(child.id)}
                  onContextMenu={(e) => shared.onContextMenu(e, root.id, child.id)}
                  onEditCommand={() => onEditCommand(root.id, child.id)}
                  onUpdateCommand={(patch) => onUpdateCommand(root.id, child.id, patch)}
                  onRun={shared.onRunCommand ? () => shared.onRunCommand?.(root.id, child.id) : undefined}
                  isRunning={shared.isRunning}
                  dropIndicator={dropIndicator}
                />
              ) : (
                <DraggableCaseNode
                  key={child.id}
                  case_={child}
                  parentId={root.id}
                  level={0}
                  shared={shared}
                  dropIndicator={dropIndicator}
                  onEditCase={onEditCase}
                  onEditCommand={onEditCommand}
                  onUpdateCommand={onUpdateCommand}
                />
              ),
            )
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
