import { useState } from 'react';
import type { TestCommand, StandardCommand, UrcGuardCommand, ScriptCommand, ExtractConfig } from '@/types/testCase';
import type { PortLabel } from '@/types/serial';
import { useTranslation } from 'react-i18next';
import { FileUp, X, ChevronDown, ChevronRight } from 'lucide-react';
import { AtAutocompleteInput } from '@/components/serial/AtAutocompleteInput';
import { SaveCommandDialog } from '@/components/serial/SaveCommandDialog';
import { useCommandLibrary } from '@/stores/commandLibraryStore';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { findCommand, isCommand, isUrcGuard } from '@/lib/testCaseUtils';
import { useSerialCommands } from '@/hooks/useSerialCommands';

/** 字节数格式化为可读文本 */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface CommandEditorProps {
  command: TestCommand;
  onChange: (patch: Partial<TestCommand>) => void;
}

const inputCls = 'w-full px-3 py-2 border rounded-md bg-background text-sm';
const labelCls = 'text-sm font-medium';
const fieldCls = 'space-y-1.5';

export function CommandEditor({ command, onChange }: CommandEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-4 overflow-y-auto">
      {/* 命令类型 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandType')}</label>
        <select
          value={command.type}
          onChange={(e) => onChange({ type: e.target.value as typeof command.type })}
          className={inputCls}
        >
          <option value="command">{t('testCase.commandTypePlain')}</option>
          <option value="urc-guard">{t('testCase.commandTypeUrcGuard')}</option>
          <option value="script">{t('testCase.commandTypeScript')}</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {t('testCase.commandTypeHint')}
        </p>
      </div>

      {/* 公共字段 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandName')}</label>
        <input
          className={inputCls}
          value={command.name || ''}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('testCase.commandNamePlaceholder')}
        />
      </div>

      {/* 命令描述已移到各子编辑器内部，统一放在内容/模式之后 */}

      {/* 根据类型渲染不同编辑器 */}
      {command.type === 'command' && <StandardCommandFields command={command} onChange={onChange} />}
      {command.type === 'urc-guard' && <UrcGuardCommandFields command={command} onChange={onChange} />}
      {command.type === 'script' && <ScriptCommandFields command={command} onChange={onChange} />}

      {/* 通用：启用开关 */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={command.selected}
            onChange={(e) => onChange({ selected: e.target.checked })}
          />
          {t('testCase.enableCommand')}
        </label>
      </div>
    </div>
  );
}

// ============ 普通命令编辑器 ============
function StandardCommandFields({
  command,
  onChange,
}: {
  command: StandardCommand;
  onChange: (patch: Partial<TestCommand>) => void;
}) {
  const { t } = useTranslation();
  const { saveAttachment, deleteAttachment } = useSerialCommands();
  const [fileError, setFileError] = useState('');
  // Ctrl+S 保存命令到命令库
  const [saveDialogCommand, setSaveDialogCommand] = useState<string | null>(null);
  const refreshCommandLib = useCommandLibrary((s) => s.refresh);

  const handleFileDrop = async (file: File) => {
    setFileError('');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const ref = await saveAttachment(bytes, file.name);
      onChange({
        fileData: { name: ref.name, size: ref.size, id: ref.id },
      });
    } catch (err) {
      setFileError(String((err as { message?: string }).message ?? err));
    }
  };

  return (
    <>
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandContent')}</label>
        <AtAutocompleteInput
          value={command.content}
          onChange={(val) => onChange({ content: val })}
          placeholder={t('testCase.commandContentPlaceholder')}
          triggerMode="at-prefix"
          onFileDrop={handleFileDrop}
          onCtrlS={(cmd) => setSaveDialogCommand(cmd)}
        />
        {/* 已关联文件：紧凑显示在输入框下方，无文件时不占空间 */}
        {command.fileData && (
          <div className="flex items-center gap-2 px-2 py-1 mt-1 bg-secondary/30 rounded text-xs border border-border/50">
            <FileUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">{command.fileData.name}</span>
            <span className="text-muted-foreground">{formatBytes(command.fileData.size)}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => {
                if (command.fileData?.id) {
                  void deleteAttachment(command.fileData.id);
                }
                onChange({ fileData: undefined });
              }}
              title={t('testCase.fileRemove')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {fileError && <p className="text-xs text-destructive mt-1">{fileError}</p>}
      </div>

      {/* 命令描述：置于命令内容之后，符合"先填内容"的操作习惯 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandDescription')}</label>
        <textarea
          className={`${inputCls} min-h-[60px] resize-y`}
          value={command.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('testCase.commandDescPlaceholder')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.dataFormat')}</label>
          <select
            className={inputCls}
            value={command.dataFormat}
            onChange={(e) => onChange({ dataFormat: e.target.value as 'utf8' | 'hex' })}
          >
            <option value="utf8">{t('testCase.dataFormatUtf8')}</option>
            <option value="hex">{t('testCase.dataFormatHex')}</option>
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.lineEnding')}</label>
          <select
            className={inputCls}
            value={command.lineEnding}
            onChange={(e) => onChange({ lineEnding: e.target.value as StandardCommand['lineEnding'] })}
          >
            <option value="none">{t('testCase.lineEndingNone')}</option>
            <option value="lf">{t('testCase.lineEndingLF')}</option>
            <option value="cr">{t('testCase.lineEndingCR')}</option>
            <option value="crlf">{t('testCase.lineEndingCRLF')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.preDelay')}</label>
          <input
            type="number"
            className={inputCls}
            value={command.preDelay}
            onChange={(e) => onChange({ preDelay: Number(e.target.value) })}
            min="0"
          />
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.postDelay')}</label>
          <input
            type="number"
            className={inputCls}
            value={command.postDelay}
            onChange={(e) => onChange({ postDelay: Number(e.target.value) })}
            min="0"
          />
        </div>
      </div>

      {/* 重复策略 */}
      <div className="border-t pt-3 space-y-3">
        <h4 className="text-sm font-semibold">{t('testCase.repeatStrategy')}</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className={fieldCls}>
            <label className={labelCls}>{t('testCase.sendCount')}</label>
            <input
              type="number"
              className={inputCls}
              value={command.repeatCount}
              onChange={(e) => onChange({ repeatCount: Math.max(1, Number(e.target.value)) })}
              min="1"
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>{t('testCase.successThreshold')}</label>
            <input
              type="number"
              className={inputCls}
              value={command.successThreshold}
              onChange={(e) => onChange({ successThreshold: Number(e.target.value) })}
              min="1"
              max={command.repeatCount}
            />
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>{t('testCase.attemptInterval')}</label>
            <input
              type="number"
              className={inputCls}
              value={command.attemptInterval}
              onChange={(e) => onChange({ attemptInterval: Number(e.target.value) })}
              min="0"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={command.stopWhenReached}
            onChange={(e) => onChange({ stopWhenReached: e.target.checked })}
          />
          {t('testCase.stopWhenReached', { count: command.repeatCount })}
        </label>
      </div>

      {/* 响应校验 */}
      <div className="border-t pt-3 space-y-3">
        <h4 className="text-sm font-semibold">{t('testCase.responseValidation')}</h4>
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.validationType')}</label>
          <select
            className={inputCls}
            value={command.validation}
            onChange={(e) => onChange({ validation: e.target.value as StandardCommand['validation'] })}
          >
            <option value="none">{t('testCase.validationNone')}</option>
            <option value="standard">{t('testCase.validationStandard')}</option>
            <option value="custom">{t('testCase.validationCustom')}</option>
          </select>
        </div>

        {command.validation === 'custom' && (
          <>
            <div className={fieldCls}>
              <label className={labelCls}>{t('testCase.matchMode')}</label>
              <select
                className={inputCls}
                value={command.validationMode || 'contains'}
                onChange={(e) => onChange({ validationMode: e.target.value as StandardCommand['validationMode'] })}
              >
                <option value="contains">{t('testCase.matchModeContains')}</option>
                <option value="exact">{t('testCase.matchModeExact')}</option>
                <option value="regex">{t('testCase.matchModeRegex')}</option>
                <option value="startsWith">{t('testCase.matchModeStartsWith')}</option>
                <option value="endsWith">{t('testCase.matchModeEndsWith')}</option>
              </select>
            </div>
            <div className={fieldCls}>
              <label className={labelCls}>{t('testCase.matchContent')}</label>
              <input
                className={`${inputCls} font-mono`}
                value={command.validationPattern || ''}
                onChange={(e) => onChange({ validationPattern: e.target.value })}
                placeholder={t('testCase.matchContentPlaceholder')}
              />
            </div>
          </>
        )}

        {command.validation !== 'none' && (
          <div className={fieldCls}>
            <label className={labelCls}>{t('testCase.waitTimeout')}</label>
            <input
              type="number"
              className={inputCls}
              value={command.timeout}
              onChange={(e) => onChange({ timeout: Number(e.target.value) })}
              min="0"
            />
          </div>
        )}
      </div>

      {/* 变量提取 */}
      <ExtractConfigEditor
        config={command.extractConfig}
        onChange={(extractConfig) => onChange({ extractConfig })}
      />

      {/* 失败处理 */}
      <div className="border-t pt-3 space-y-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.failureAction')}</label>
          <select
            className={inputCls}
            value={command.onFailure}
            onChange={(e) => onChange({ onFailure: e.target.value as StandardCommand['onFailure'] })}
          >
            <option value="continue">{t('testCase.failureActionContinue')}</option>
            <option value="end-round">{t('testCase.failureActionEndRound')}</option>
            <option value="abort">{t('testCase.failureActionAbort')}</option>
            <option value="goto">{t('testCase.failureActionGoto')}</option>
          </select>
        </div>
        {/* 失败跳转目标（仅 onFailure='goto' 时显示） */}
        {command.onFailure === 'goto' && (
          <GotoTargetSelect
            commandId={command.id}
            gotoTargetId={command.gotoTargetId}
            onChange={(gotoTargetId) => onChange({ gotoTargetId })}
          />
        )}
      </div>

      {/* 高级配置（串口路由 + 硬件信号，置于最末尾） */}
      <PortRoutingSection
        txPort={command.txPort}
        rxPort={command.rxPort}
        dtr={command.advancedConfig?.dtr}
        rts={command.advancedConfig?.rts}
        onChangeTx={(txPort) => onChange({ txPort })}
        onChangeRx={(rxPort) => onChange({ rxPort })}
        onChangeDtr={(dtr) =>
          onChange({ advancedConfig: { ...command.advancedConfig, dtr } })
        }
        onChangeRts={(rts) =>
          onChange({ advancedConfig: { ...command.advancedConfig, rts } })
        }
      />

      {/* Ctrl+S 保存命令到命令库 */}
      {saveDialogCommand && (
        <SaveCommandDialog
          command={saveDialogCommand}
          onClose={() => setSaveDialogCommand(null)}
          onSaved={() => {
            void refreshCommandLib();
            setSaveDialogCommand(null);
          }}
        />
      )}
    </>
  );
}

// ============ URC 后台守护编辑器 ============
function UrcGuardCommandFields({
  command,
  onChange,
}: {
  command: UrcGuardCommand;
  onChange: (patch: Partial<TestCommand>) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.urcPattern')}</label>
        <AtAutocompleteInput
          value={command.pattern}
          onChange={(val) => onChange({ pattern: val })}
          placeholder={t('testCase.urcPatternPlaceholderGuard')}
          triggerMode="always"
        />
      </div>

      {/* 命令描述：置于匹配内容之后，与普通命令保持一致 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandDescription')}</label>
        <textarea
          className={`${inputCls} min-h-[60px] resize-y`}
          value={command.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('testCase.commandDescPlaceholder')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.matchMode')}</label>
          <select
            className={inputCls}
            value={command.matchMode}
            onChange={(e) => onChange({ matchMode: e.target.value as UrcGuardCommand['matchMode'] })}
          >
            <option value="contains">{t('testCase.matchModeContains')}</option>
            <option value="exact">{t('testCase.matchModeExact')}</option>
            <option value="regex">{t('testCase.matchModeRegex')}</option>
            <option value="startsWith">{t('testCase.matchModeStartsWith')}</option>
            <option value="endsWith">{t('testCase.matchModeEndsWith')}</option>
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.scope')}</label>
          <select
            className={inputCls}
            value={command.scope}
            onChange={(e) => onChange({ scope: e.target.value as 'root' | 'case' })}
          >
            <option value="root">{t('testCase.scopeRoot')}</option>
            <option value="case">{t('testCase.scopeCase')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.hitAction')}</label>
          <select
            className={inputCls}
            value={command.action}
            onChange={(e) => onChange({ action: e.target.value as UrcGuardCommand['action'] })}
          >
            <option value="restart-round">{t('testCase.hitActionRestartRound')}</option>
            <option value="abort">{t('testCase.hitActionAbort')}</option>
            <option value="fail-current">{t('testCase.hitActionFailCurrent')}</option>
            <option value="jump-to">{t('testCase.hitActionJumpTo')}</option>
            <option value="capture-only">{t('testCase.hitActionCaptureOnly')}</option>
            <option value="log-only">{t('testCase.hitActionLogOnly')}</option>
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.rearmMode')}</label>
          <select
            className={inputCls}
            value={command.rearm}
            onChange={(e) => onChange({ rearm: e.target.value as 'once' | 'continuous' })}
          >
            <option value="once">{t('testCase.rearmModeOnce')}</option>
            <option value="continuous">{t('testCase.rearmModeContinuous')}</option>
          </select>
        </div>
      </div>

      {/* 跳转配置（仅 action='jump-to' 时显示） */}
      {command.action === 'jump-to' && (
        <JumpTargetSection
          guardId={command.id}
          jumpTargetId={command.jumpTargetId}
          jumpMode={command.jumpMode}
          onChange={onChange}
        />
      )}

      <ExtractConfigEditor
        config={command.extractConfig}
        onChange={(extractConfig) => onChange({ extractConfig })}
      />

      {/* 监听端口（高级） */}
      <ListenPortSection
        listenPort={command.listenPort}
        onChange={(listenPort) => onChange({ listenPort })}
      />
    </>
  );
}

// ============ 跳转目标配置（URC jump-to 专用）============
function JumpTargetSection({
  guardId,
  jumpTargetId,
  jumpMode,
  onChange,
}: {
  guardId: string;
  jumpTargetId?: string;
  jumpMode?: 'goto' | 'call';
  onChange: (patch: Partial<UrcGuardCommand>) => void;
}) {
  const { t } = useTranslation();
  const cases = useTestCaseStore((s) => s.cases);

  // 查找守护所在用例，获取同级可执行命令列表
  const result = findCommand(cases, guardId);
  const siblings = result
    ? result.owner.children.filter((c) => isCommand(c) && !isUrcGuard(c))
    : [];

  return (
    <div className="space-y-3 p-3 border rounded-md bg-blue-50/50">
      <h5 className="text-sm font-semibold text-blue-700">{t('testCase.jumpConfig')}</h5>
      <div className="grid grid-cols-2 gap-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.jumpMode')}</label>
          <select
            className={inputCls}
            value={jumpMode ?? 'goto'}
            onChange={(e) => onChange({ jumpMode: e.target.value as 'goto' | 'call' })}
          >
            <option value="goto">{t('testCase.jumpModeGoto')}</option>
            <option value="call">{t('testCase.jumpModeCall')}</option>
          </select>
        </div>
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.jumpTarget')}</label>
          <select
            className={inputCls}
            value={jumpTargetId ?? ''}
            onChange={(e) => onChange({ jumpTargetId: e.target.value || undefined })}
          >
            <option value="">{t('testCase.jumpTargetNone')}</option>
            {siblings.map((cmd) => (
              <option key={cmd.id} value={cmd.id}>
                {(cmd as StandardCommand).content || cmd.name || cmd.id}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ============ 失败跳转目标选择（命令 goto 专用）============
function GotoTargetSelect({
  commandId,
  gotoTargetId,
  onChange,
}: {
  commandId: string;
  gotoTargetId?: string;
  onChange: (id?: string) => void;
}) {
  const { t } = useTranslation();
  const cases = useTestCaseStore((s) => s.cases);

  // 查找命令所在用例，获取同级可执行命令列表（排除自身与守护）
  const result = findCommand(cases, commandId);
  const siblings = result
    ? result.owner.children.filter(
        (c) => isCommand(c) && !isUrcGuard(c) && c.id !== commandId,
      )
    : [];

  return (
    <div className={fieldCls}>
      <label className={labelCls}>{t('testCase.gotoTarget')}</label>
      <select
        className={inputCls}
        value={gotoTargetId ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{t('testCase.jumpTargetNone')}</option>
        {siblings.map((cmd) => (
          <option key={cmd.id} value={cmd.id}>
            {(cmd as StandardCommand).content || cmd.name || cmd.id}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============ 串口路由（发送/接收口，折叠高级区）============
function PortSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: PortLabel;
  onChange: (v?: PortLabel) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={fieldCls}>
      <label className={labelCls}>{label}</label>
      <select
        className={inputCls}
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as PortLabel | undefined)}
      >
        <option value="">{t('testCase.portDefault')}</option>
        <option value="P1">P1</option>
        <option value="P2">P2</option>
      </select>
    </div>
  );
}

type SignalControl = 'inherit' | 'high' | 'low';

/** 硬件信号三态选择器（DTR/RTS） */
function SignalSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: SignalControl;
  onChange: (v: SignalControl) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={fieldCls}>
      <label className={labelCls}>{label}</label>
      <select
        className={inputCls}
        value={value ?? 'inherit'}
        onChange={(e) => onChange(e.target.value as SignalControl)}
      >
        <option value="inherit">{t('testCase.signalInherit')}</option>
        <option value="high">{t('testCase.signalHigh')}</option>
        <option value="low">{t('testCase.signalLow')}</option>
      </select>
    </div>
  );
}

function PortRoutingSection({
  txPort,
  rxPort,
  dtr,
  rts,
  onChangeTx,
  onChangeRx,
  onChangeDtr,
  onChangeRts,
}: {
  txPort?: PortLabel;
  rxPort?: PortLabel;
  dtr?: SignalControl;
  rts?: SignalControl;
  onChangeTx: (v?: PortLabel) => void;
  onChangeRx: (v?: PortLabel) => void;
  onChangeDtr: (v: SignalControl) => void;
  onChangeRts: (v: SignalControl) => void;
}) {
  const { t } = useTranslation();
  // 有非默认设置时默认展开
  const hasSignal = (dtr && dtr !== 'inherit') || (rts && rts !== 'inherit');
  const [open, setOpen] = useState(Boolean(txPort || rxPort || hasSignal));
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('testCase.advancedConfig')}
      </button>
      {open && (
        <div className="mt-2 space-y-4">
          {/* 子区：串口路由 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground/80">{t('testCase.portRouting')}</p>
            <p className="text-xs text-muted-foreground">{t('testCase.portRoutingHint')}</p>
            <div className="grid grid-cols-2 gap-3">
              <PortSelect label={t('testCase.txPortLabel')} value={txPort} onChange={onChangeTx} />
              <PortSelect label={t('testCase.rxPortLabel')} value={rxPort} onChange={onChangeRx} />
            </div>
          </div>
          {/* 子区：硬件信号 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground/80">{t('testCase.hardwareSignals')}</p>
            <p className="text-xs text-muted-foreground">{t('testCase.signalHint')}</p>
            <div className="grid grid-cols-2 gap-3">
              <SignalSelect label={t('testCase.dtrControl')} value={dtr} onChange={onChangeDtr} />
              <SignalSelect label={t('testCase.rtsControl')} value={rts} onChange={onChangeRts} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListenPortSection({
  listenPort,
  onChange,
}: {
  listenPort?: PortLabel;
  onChange: (v?: PortLabel) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(Boolean(listenPort));
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('testCase.portRouting')}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{t('testCase.portRoutingHint')}</p>
          <PortSelect label={t('testCase.listenPortLabel')} value={listenPort} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ============ 脚本命令编辑器 ============
function ScriptCommandFields({
  command,
  onChange,
}: {
  command: ScriptCommand;
  onChange: (patch: Partial<TestCommand>) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/* 脚本路径 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.scriptPath')}</label>
        <input
          className={inputCls}
          value={command.scriptPath}
          onChange={(e) => onChange({ scriptPath: e.target.value })}
          placeholder={t('testCase.scriptPathPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">
          {t('testCase.scriptPathHint')}
        </p>
      </div>

      {/* 命令描述 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandDescription')}</label>
        <textarea
          className={inputCls}
          value={command.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('testCase.commandDescPlaceholder')}
          rows={2}
        />
      </div>

      {/* 执行命令 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.scriptCommand')}</label>
        <input
          className={inputCls}
          value={command.command}
          onChange={(e) => onChange({ command: e.target.value })}
          placeholder={t('testCase.scriptCommandPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">
          {t('testCase.scriptCommandHint')}
        </p>
      </div>

      {/* 超时 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.scriptTimeout')}</label>
        <input
          type="number"
          className={inputCls}
          value={command.timeout}
          onChange={(e) => onChange({ timeout: Math.max(1000, parseInt(e.target.value) || 30000) })}
          min={1000}
          max={300000}
        />
        <p className="text-xs text-muted-foreground">
          {t('testCase.scriptTimeoutHint')}
        </p>
      </div>

      {/* 失败处理 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.scriptOnFailure')}</label>
        <select
          className={inputCls}
          value={command.onFailure}
          onChange={(e) => onChange({ onFailure: e.target.value as ScriptCommand['onFailure'] })}
        >
          <option value="abort">{t('testCase.failureActionAbort')}</option>
          <option value="continue">{t('testCase.failureActionContinue')}</option>
          <option value="end-round">{t('testCase.failureActionEndRound')}</option>
        </select>
      </div>

      {/* 命令前延迟 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.preDelay')}</label>
        <input
          type="number"
          className={inputCls}
          value={command.preDelay}
          onChange={(e) => onChange({ preDelay: Math.max(0, parseInt(e.target.value) || 0) })}
          min={0}
        />
      </div>

      {/* 命令后延迟 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.postDelay')}</label>
        <input
          type="number"
          className={inputCls}
          value={command.postDelay}
          onChange={(e) => onChange({ postDelay: Math.max(0, parseInt(e.target.value) || 0) })}
          min={0}
        />
      </div>
    </>
  );
}

// ============ 变量提取配置编辑器 ============
function ExtractConfigEditor({
  config,
  onChange,
}: {
  config?: ExtractConfig;
  onChange: (config: ExtractConfig) => void;
}) {
  const { t } = useTranslation();
  const enabled = config?.enabled || false;

  return (
    <div className="border-t pt-3 space-y-3">
      <h4 className="text-sm font-semibold text-green-600">{t('testCase.variableExtraction')}</h4>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange({
              enabled: e.target.checked,
              parseType: config?.parseType || 'regex',
              parsePattern: config?.parsePattern || '',
              parameterMap: config?.parameterMap || {},
            })
          }
        />
        {t('testCase.enableExtraction')}
      </label>

      {enabled && config && (
        <>
          <div className={fieldCls}>
            <label className={labelCls}>{t('testCase.extractionMethod')}</label>
            <select
              className={inputCls}
              value={config.parseType}
              onChange={(e) => onChange({ ...config, parseType: e.target.value as 'regex' | 'split' })}
            >
              <option value="regex">{t('testCase.extractionMethodRegex')}</option>
              <option value="split">{t('testCase.extractionMethodSplit')}</option>
            </select>
          </div>

          <div className={fieldCls}>
            <label className={labelCls}>{config.parseType === 'regex' ? t('testCase.regexPattern') : t('testCase.splitDelimiter')}</label>
            <input
              className={`${inputCls} font-mono`}
              value={config.parsePattern}
              onChange={(e) => onChange({ ...config, parsePattern: e.target.value })}
              placeholder={config.parseType === 'regex' ? t('testCase.regexPatternPlaceholder') : t('testCase.splitDelimiterPlaceholder')}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {config.parseType === 'regex'
                ? t('testCase.regexHint')
                : t('testCase.splitHint')}
            </p>
          </div>

          <div className={fieldCls}>
            <label className={labelCls}>{t('testCase.parameterMap')}</label>
            <textarea
              className={`${inputCls} font-mono min-h-[80px]`}
              value={JSON.stringify(config.parameterMap, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  onChange({ ...config, parameterMap: parsed });
                } catch {
                  // 忽略无效 JSON
                }
              }}
              placeholder={'{\n  "rssi": "1",\n  "ber": "2"\n}'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('testCase.parameterMapHint')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
