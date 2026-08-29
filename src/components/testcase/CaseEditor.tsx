import { useState } from 'react';
import type { TestCase, RootTestCase } from '@/types/testCase';
import type { PortLabel } from '@/types/serial';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CaseEditorProps {
  case_: TestCase;
  onChange: (patch: Partial<TestCase>) => void;
}

const inputCls = 'w-full px-3 py-2 border rounded-md bg-background text-sm';
const labelCls = 'text-sm font-medium';
const fieldCls = 'space-y-1.5';

/** 单个端口选择器 */
function PortSelect({
  label,
  value,
  showInherit,
  showAuto,
  onChange,
}: {
  label: string;
  value?: PortLabel;
  showInherit: boolean;
  showAuto?: boolean; // 根用例 targetPort 显示"自动"选项
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
        {showInherit && <option value="">{t('testCase.portInherit')}</option>}
        {showAuto && <option value="">{t('testCase.portAuto')}</option>}
        <option value="P1">P1</option>
        <option value="P2">P2</option>
      </select>
    </div>
  );
}

/** 用例串口路由（折叠高级区，Tx/Rx 各自独立，与命令一致） */
function CasePortSection({
  isRoot,
  txPort,
  rxPort,
  fallbackPort,
  onChangeTx,
  onChangeRx,
}: {
  isRoot: boolean;
  txPort?: PortLabel;
  rxPort?: PortLabel;
  fallbackPort?: PortLabel; // 根用例：targetPort 作为默认显示值（可能是 undefined=AUTO）
  onChangeTx: (v?: PortLabel) => void;
  onChangeRx: (v?: PortLabel) => void;
}) {
  const { t } = useTranslation();
  // 默认折叠，仅子用例设置了非继承端口时自动展开
  const [open, setOpen] = useState(!isRoot && Boolean(txPort || rxPort));
  // 根用例是顶层，显示 targetPort（可能为空=AUTO），子用例显示 txPort（空=继承）
  const txValue = isRoot ? (txPort ?? fallbackPort) : txPort;
  const rxValue = isRoot ? (rxPort ?? fallbackPort) : rxPort;
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
          <p className="text-xs text-muted-foreground">
            {isRoot ? t('testCase.casePortRootHint') : t('testCase.casePortHint')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <PortSelect label={t('testCase.txPortLabel')} value={txValue} showInherit={!isRoot} showAuto={isRoot} onChange={onChangeTx} />
            <PortSelect label={t('testCase.rxPortLabel')} value={rxValue} showInherit={!isRoot} showAuto={isRoot} onChange={onChangeRx} />
          </div>
        </div>
      )}
    </div>
  );
}

export function CaseEditor({ case_, onChange }: CaseEditorProps) {
  const { t } = useTranslation();
  // 根用例带 targetPort 字段；根用例始终选中，不显示选中复选框
  const isRoot = 'targetPort' in case_;

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-semibold">{t('testCase.caseProperties')}</h3>

      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.caseName')}</label>
        <input
          className={inputCls}
          value={case_.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('testCase.caseNamePlaceholder')}
        />
      </div>

      <div className={fieldCls}>
        <label className={labelCls}>{t('testCase.caseDescription')}</label>
        <textarea
          className={`${inputCls} min-h-[80px] resize-y`}
          value={case_.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={t('testCase.caseDescPlaceholder')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.failureStrategy')}</label>
          <select
            className={inputCls}
            value={case_.onFailure}
            onChange={(e) => onChange({ onFailure: e.target.value as TestCase['onFailure'] })}
          >
            <option value="continue">{t('testCase.failContinue')}</option>
            <option value="end-round">{t('testCase.failEndRound')}</option>
            <option value="retry-self">{t('testCase.failRetrySelf')}</option>
            <option value="abort">{t('testCase.failAbort')}</option>
          </select>
        </div>

        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.loopCount')}</label>
          <input
            type="number"
            className={inputCls}
            value={case_.runCount}
            onChange={(e) => onChange({ runCount: Number(e.target.value) })}
            min="0"
            placeholder={t('testCase.loopCountPlaceholder')}
          />
        </div>
      </div>

      {case_.onFailure === 'retry-self' && (
        <div className={fieldCls}>
          <label className={labelCls}>{t('testCase.maxRetries')}</label>
          <input
            type="number"
            className={inputCls}
            value={case_.maxSelfRetries ?? 1}
            onChange={(e) => onChange({ maxSelfRetries: Number(e.target.value) })}
            min="1"
          />
        </div>
      )}

      {!isRoot && (
        <div className="flex items-center gap-2 pt-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={case_.selected}
              onChange={(e) => onChange({ selected: e.target.checked })}
            />
            {t('testCase.selectThisCase')}
          </label>
        </div>
      )}

      {/* 串口路由（高级） */}
      <CasePortSection
        isRoot={isRoot}
        txPort={case_.txPort}
        rxPort={case_.rxPort}
        fallbackPort={isRoot ? (case_ as RootTestCase).targetPort : undefined}
        onChangeTx={(v) =>
          isRoot
            ? onChange({ txPort: v, targetPort: v } as Partial<TestCase>)
            : onChange({ txPort: v })
        }
        onChangeRx={(v) => onChange({ rxPort: v })}
      />
    </div>
  );
}
