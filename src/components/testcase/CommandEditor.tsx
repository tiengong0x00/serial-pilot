import { useState } from 'react';
import type { TestCommand, StandardCommand, UrcGuardCommand, ScriptCommand, ExtractConfig } from '@/types/testCase';
import type { PortLabel } from '@/types/serial';
import { useTranslation } from 'react-i18next';
import { FileUp, X, ChevronDown, ChevronRight } from 'lucide-react';
import { AtAutocompleteInput } from '@/components/serial/AtAutocompleteInput';
import { HexInput } from '@/components/testcase/HexInput';
import { FormatToggle, SegmentedControl } from '@/components/testcase/FormatToggle';
import { SaveCommandDialog } from '@/components/serial/SaveCommandDialog';
import { useCommandLibrary } from '@/stores/commandLibraryStore';
import { useTestCaseStore } from '@/stores/testCaseStore';
import { findCommand, isCommand, isUrcGuard } from '@/lib/testCaseUtils';
import { useSerialCommands } from '@/hooks/useSerialCommands';

/** 字节数格式化为可读文本
 * 格式：25.7 MB (26,958,848 B)
 */
function formatBytes(n: number): string {
  if (n === 0) return '0 B';

  // 小于 1KB，只显示字节数
  if (n < 1024) return `${n} B`;

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  const value = (n / Math.pow(k, i)).toFixed(1);

  // 格式化字节数为带千分位的字符串
  const formattedBytes = n.toLocaleString('en-US');

  return `${value} ${sizes[i]} (${formattedBytes} B)`;
}

interface CommandEditorProps {
  command: TestCommand;
  testcaseName: string;
  onChange: (patch: Partial<TestCommand>) => void;
}

const inputCls = 'w-full px-3 py-2 border rounded-md bg-background text-sm';
const labelCls = 'text-sm font-medium';
const fieldCls = 'space-y-1.5';
// 内联紧凑控件（用于同一行内的小型 select）
const inlineSelectCls = 'px-2 py-1 border rounded text-xs bg-background';

export function CommandEditor({ command, testcaseName, onChange }: CommandEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-4 overflow-y-auto">
      {/* 公共字段：命令名称 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandName')}</label>
        <input
          className={inputCls}
          value={command.name || ''}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('testCase.commandNamePlaceholder')}
        />
      </div>

      {/* 根据类型渲染不同编辑器 */}
      {command.type === 'command' && <StandardCommandFields command={command} testcaseName={testcaseName} onChange={onChange} />}
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
  testcaseName,
  onChange,
}: {
  command: StandardCommand;
  testcaseName: string;
  onChange: (patch: Partial<TestCommand>) => void;
}) {
  const { t } = useTranslation();
  const { saveTestcaseAttachment } = useSerialCommands();
  const [fileError, setFileError] = useState('');
  // Ctrl+S 保存命令到命令库
  const [saveDialogCommand, setSaveDialogCommand] = useState<string | null>(null);
  const refreshCommandLib = useCommandLibrary((s) => s.refresh);

  const handleFileDrop = async (file: File) => {
    setFileError('');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const ref = await saveTestcaseAttachment(bytes, file.name, testcaseName);
      onChange({
        fileData: { name: ref.name, size: ref.size, id: ref.id },
      });
    } catch (err) {
      setFileError(String((err as { message?: string }).message ?? err));
    }
  };

  return (
    <>
      {/* 命令内容 - 多控件合并到标题行 */}
      <div className={fieldCls}>
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <label className={labelCls}>{t('testCase.commandContent')}</label>
          <FormatToggle
            value={command.dataFormat}
            onChange={(format) => onChange({ dataFormat: format })}
          />
          <select
            className={inlineSelectCls}
            value={command.lineEnding}
            onChange={(e) => onChange({ lineEnding: e.target.value as StandardCommand['lineEnding'] })}
          >
            <option value="none">{t('testCase.lineEndingNone')}</option>
            <option value="lf">{t('testCase.lineEndingLF')}</option>
            <option value="cr">{t('testCase.lineEndingCR')}</option>
            <option value="crlf">{t('testCase.lineEndingCRLF')}</option>
          </select>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{t('testCase.delayShort')}:</span>
            <input
              type="number"
              className="w-20 px-2 py-1 border rounded text-xs bg-background"
              value={command.delay}
              onChange={(e) => onChange({ delay: Math.max(0, Number(e.target.value) || 0) })}
              min="0"
            />
            <span className="text-xs text-muted-foreground">ms</span>
          </div>
        </div>
        {command.dataFormat === 'hex' ? (
          <HexInput
            value={command.content}
            onChange={(val) => onChange({ content: val })}
            placeholder={t('testCase.commandContentHexPlaceholder')}
          />
        ) : (
          <AtAutocompleteInput
            value={command.content}
            onChange={(val) => onChange({ content: val })}
            placeholder={t('testCase.commandContentPlaceholder')}
            triggerMode="at-prefix"
            onFileDrop={handleFileDrop}
            onCtrlS={(cmd) => setSaveDialogCommand(cmd)}
          />
        )}
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
                // 只解除引用，不删磁盘文件：同名同内容的附件会被多条命令复用，
                // 立即删除会误删其他命令的附件。无引用的文件由启动时 GC 统一清理。
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

      {/* 策略配置 */}
      <div className="border-t pt-3 space-y-3">
        <div className="space-y-2">
          <div className="text-sm font-semibold">{t('testCase.repeatStrategy')}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.sendCountShort')}</span>
              <input
                type="number"
                className="w-16 px-2 py-1 border rounded text-xs bg-background"
                value={command.repeatCount}
                onChange={(e) => onChange({ repeatCount: Math.max(1, Number(e.target.value)) })}
                min="1"
              />
              <span className="text-xs text-muted-foreground">{t('testCase.timesUnit')}</span>
            </div>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={command.stopWhenReached}
                onChange={(e) => onChange({ stopWhenReached: e.target.checked })}
              />
              <span className="text-muted-foreground">{t('testCase.reachShort')}</span>
              <input
                type="number"
                className="w-16 px-2 py-1 border rounded text-xs bg-background"
                value={command.successThreshold}
                onChange={(e) => onChange({ successThreshold: Number(e.target.value) })}
                min="1"
                max={command.repeatCount}
              />
              <span className="text-muted-foreground">{t('testCase.successTimesShort')}</span>
            </label>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.onFailureShort')}</span>
              <select
                className={inlineSelectCls}
                value={command.onFailure}
                onChange={(e) => onChange({ onFailure: e.target.value as StandardCommand['onFailure'] })}
              >
                <option value="continue">{t('testCase.failureActionContinue')}</option>
                <option value="end-round">{t('testCase.failureActionEndRound')}</option>
                <option value="abort">{t('testCase.failureActionAbort')}</option>
                <option value="goto">{t('testCase.failureActionGoto')}</option>
              </select>
            </div>
          </div>
        </div>
        {/* 跳转配置（仅 goto 时显示，与 URC 跳转一致） */}
        {command.onFailure === 'goto' && (
          <GotoTargetSection
            commandId={command.id}
            gotoTargetId={command.gotoTargetId}
            gotoMode={command.gotoMode}
            onChange={onChange}
          />
        )}
      </div>

      {/* 响应校验 - 复选框 + 匹配方式 + 超时 */}
      <div className="border-t pt-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={command.validation}
              onChange={(e) => onChange({
                validation: e.target.checked,
                validationPattern: e.target.checked && !command.validationPattern ? 'OK' : command.validationPattern,
                validationMode: e.target.checked && !command.validationMode ? 'contains' : command.validationMode,
              })}
            />
            {t('testCase.responseValidation')}
          </label>
          {command.validation && (
            <select
              className={inlineSelectCls}
              value={command.validationMode || 'contains'}
              onChange={(e) => onChange({ validationMode: e.target.value as StandardCommand['validationMode'] })}
            >
              <option value="contains">{t('testCase.matchModeContains')}</option>
              <option value="exact">{t('testCase.matchModeExact')}</option>
              <option value="regex">{t('testCase.matchModeRegex')}</option>
              <option value="startsWith">{t('testCase.matchModeStartsWith')}</option>
              <option value="endsWith">{t('testCase.matchModeEndsWith')}</option>
            </select>
          )}
          {command.validation && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.timeoutShort')}:</span>
              <input
                type="number"
                className="w-20 px-2 py-1 border rounded text-xs bg-background"
                value={command.timeout}
                onChange={(e) => onChange({ timeout: Number(e.target.value) })}
                min="0"
              />
              <span className="text-xs text-muted-foreground">ms</span>
            </div>
          )}
        </div>
        {command.validation && (
          <div className={fieldCls}>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls}>{t('testCase.matchContent')}</label>
              <FormatToggle
                value={command.validationFormat || 'utf8'}
                onChange={(format) => onChange({ validationFormat: format })}
              />
            </div>
            {(command.validationFormat || 'utf8') === 'hex' ? (
              <HexInput
                value={command.validationPattern || ''}
                onChange={(val) => onChange({ validationPattern: val })}
                placeholder={t('testCase.matchContentHexPlaceholder')}
              />
            ) : (
              <input
                className={`${inputCls} font-mono`}
                value={command.validationPattern || ''}
                onChange={(e) => onChange({ validationPattern: e.target.value })}
                placeholder={t('testCase.matchContentPlaceholder')}
              />
            )}
          </div>
        )}
      </div>

      {/* 变量提取 */}
      <ExtractConfigEditor
        config={command.extractConfig}
        onChange={(extractConfig) => onChange({ extractConfig })}
      />

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
        {/* URC 匹配内容 - 格式切换紧贴标签，模式下拉靠右 */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <label className={labelCls}>{t('testCase.urcPattern')}</label>
          <FormatToggle
            value={command.patternFormat || 'utf8'}
            onChange={(format) => onChange({ patternFormat: format })}
          />
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm font-medium">{t('testCase.matchMode')}</label>
            <select
              className={inlineSelectCls}
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
        </div>
        {(command.patternFormat || 'utf8') === 'hex' ? (
          <HexInput
            value={command.pattern}
            onChange={(val) => onChange({ pattern: val })}
            placeholder={t('testCase.urcPatternHexPlaceholder')}
          />
        ) : (
          <AtAutocompleteInput
            value={command.pattern}
            onChange={(val) => onChange({ pattern: val })}
            placeholder={t('testCase.urcPatternPlaceholderGuard')}
            triggerMode="always"
          />
        )}
      </div>

      {/* 命令描述 */}
      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.commandDescription')}</label>
        <textarea
          className={`${inputCls} min-h-[60px] resize-y`}
          value={command.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('testCase.commandDescPlaceholder')}
        />
      </div>

      {/* 规则配置 */}
      <div className="border-t pt-3 space-y-3">
        <div className="space-y-2">
          <div className="text-sm font-semibold">{t('testCase.repeatStrategy')}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.sendCountShort')}</span>
              <SegmentedControl
                value={command.rearm}
                options={[
                  { value: 'once', label: t('testCase.rearmModeOnce') },
                  { value: 'continuous', label: t('testCase.rearmModeContinuous') },
                ]}
                onChange={(v) => onChange({ rearm: v as 'once' | 'continuous' })}
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.scopeShort')}</span>
              <SegmentedControl
                value={command.scope}
                options={[
                  { value: 'root', label: t('testCase.scopeRoot') },
                  { value: 'case', label: t('testCase.scopeCase') },
                ]}
                onChange={(v) => onChange({ scope: v as 'root' | 'case' })}
              />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.hitAction')}</span>
              <select
                className={inlineSelectCls}
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
      </div>

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
    <div className="space-y-3">
      {/* 跳转方式靠左，跳转目标靠右 */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('testCase.jumpMode')}</span>
          <SegmentedControl
            value={jumpMode ?? 'goto'}
            options={[
              { value: 'goto', label: t('testCase.jumpModeGoto') },
              { value: 'call', label: t('testCase.jumpModeCall') },
            ]}
            onChange={(v) => onChange({ jumpMode: v as 'goto' | 'call' })}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('testCase.jumpTarget')}</span>
          <select
            className={inlineSelectCls}
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

// ============ 失败跳转配置（命令 goto 专用，与 URC 跳转一致）============
function GotoTargetSection({
  commandId,
  gotoTargetId,
  gotoMode,
  onChange,
}: {
  commandId: string;
  gotoTargetId?: string;
  gotoMode?: 'goto' | 'call';
  onChange: (patch: Partial<StandardCommand>) => void;
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
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('testCase.jumpMode')}</span>
        <SegmentedControl
          value={gotoMode ?? 'goto'}
          options={[
            { value: 'goto', label: t('testCase.jumpModeGoto') },
            { value: 'call', label: t('testCase.jumpModeCall') },
          ]}
          onChange={(v) => onChange({ gotoMode: v as 'goto' | 'call' })}
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('testCase.jumpTarget')}</span>
        <select
          className={inlineSelectCls}
          value={gotoTargetId ?? ''}
          onChange={(e) => onChange({ gotoTargetId: e.target.value || undefined })}
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
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium w-8 shrink-0">{label}</span>
      <SegmentedControl
        value={value ?? ''}
        options={[
          { value: '', label: t('testCase.portDefault') },
          { value: 'P1', label: 'P1' },
          { value: 'P2', label: 'P2' },
        ]}
        onChange={(v) => onChange((v || undefined) as PortLabel | undefined)}
      />
    </div>
  );
}

type SignalControl = 'inherit' | 'high' | 'low';

/** 硬件信号三态按钮组（DTR/RTS） */
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
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium w-8 shrink-0">{label}</span>
      <SegmentedControl
        value={value ?? 'inherit'}
        options={[
          { value: 'inherit', label: t('testCase.signalInherit') },
          { value: 'high', label: t('testCase.signalHigh') },
          { value: 'low', label: t('testCase.signalLow') },
        ]}
        onChange={(v) => onChange(v as SignalControl)}
      />
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
        <div className="mt-2">
          <div className="grid grid-cols-2 gap-3">
            <PortSelect label={t('testCase.txPortLabel')} value={txPort} onChange={onChangeTx} />
            <PortSelect label={t('testCase.rxPortLabel')} value={rxPort} onChange={onChangeRx} />
            <SignalSelect label={t('testCase.dtrControl')} value={dtr} onChange={onChangeDtr} />
            <SignalSelect label={t('testCase.rtsControl')} value={rts} onChange={onChangeRts} />
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
        <div className="mt-2">
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

      {/* 执行命令 + 超时 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className={labelCls}>{t('testCase.scriptCommand')}</label>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium shrink-0">{t('testCase.timeoutShort')}</label>
            <input
              type="number"
              className="w-24 px-2 py-1 border rounded text-xs bg-background"
              value={command.timeout}
              onChange={(e) => onChange({ timeout: Math.max(1000, parseInt(e.target.value) || 30000) })}
              min={1000}
              max={300000}
            />
            <span className="text-xs text-muted-foreground">ms</span>
          </div>
        </div>
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

      {/* 规则配置 */}
      <div className="border-t pt-3">
        <div className="space-y-2">
          <div className="text-sm font-semibold">{t('testCase.repeatStrategy')}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.onFailureShort')}</span>
              <select
                className={inlineSelectCls}
                value={command.onFailure}
                onChange={(e) => onChange({ onFailure: e.target.value as ScriptCommand['onFailure'] })}
              >
                <option value="abort">{t('testCase.failureActionAbort')}</option>
                <option value="continue">{t('testCase.failureActionContinue')}</option>
                <option value="end-round">{t('testCase.failureActionEndRound')}</option>
              </select>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('testCase.delayShort')}:</span>
              <input
                type="number"
                className="w-24 px-2 py-1 border rounded text-xs bg-background"
                value={command.delay}
                onChange={(e) => onChange({ delay: Math.max(0, parseInt(e.target.value) || 0) })}
                min={0}
              />
              <span className="text-xs text-muted-foreground">ms</span>
            </div>
          </div>
        </div>
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
    <div className="border-t pt-3 space-y-2">
      {/* 第一行：checkbox + 标签 + 解析方式（启用时显示） */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm font-semibold text-green-600 cursor-pointer">
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
          {t('testCase.variableExtraction')}
        </label>
        {enabled && config && (
          <SegmentedControl
            value={config.parseType}
            options={[
              { value: 'regex', label: t('testCase.extractionMethodRegex') },
              { value: 'split', label: t('testCase.extractionMethodSplit') },
            ]}
            onChange={(v) => onChange({ ...config, parseType: v as 'regex' | 'split' })}
          />
        )}
      </div>

      {/* 展开内容：解析模式 + 变量映射 */}
      {enabled && config && (
        <>
          <input
            className={`${inputCls} font-mono`}
            value={config.parsePattern}
            onChange={(e) => onChange({ ...config, parsePattern: e.target.value })}
            placeholder={config.parseType === 'regex' ? t('testCase.regexPatternPlaceholder') : t('testCase.splitDelimiterPlaceholder')}
          />
          <div className="text-xs font-medium text-muted-foreground">{t('testCase.parameterMap')}</div>
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
        </>
      )}
    </div>
  );
}
