/**
 * 测试用例工具函数 (v1 模型)
 * - ID 生成
 * - 类型守卫（区分命令三类型 / 命令 vs 用例）
 * - 树遍历与查找（基于 children 统一子项列表）
 * - 默认对象工厂
 * - 序列化与旧格式迁移
 * - 串口数据处理、变量提取/替换、校验匹配
 */

import type {
  TestCase,
  RootTestCase,
  TestCommand,
  StandardCommand,
  UrcGuardCommand,
  ScriptCommand,
  CaseChild,
  CommandType,
  TestCaseFile,
  ExtractConfig,
  MatchMode,
  ValidationType,
} from '@/types/testCase';

// ============ ID 生成 ============
let idCounter = 0;

/** 生成唯一 ID（时间戳 + 自增计数，避免同毫秒冲突） */
export function genId(prefix: 'case' | 'cmd'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// ============ 类型守卫 ============
/** 是否为用例（否则为命令） */
export function isCase(child: CaseChild): child is TestCase {
  return 'children' in child;
}

/** 是否为命令 */
export function isCommand(child: CaseChild): child is TestCommand {
  return !isCase(child);
}

export function isStandardCommand(cmd: TestCommand): cmd is StandardCommand {
  return cmd.type === 'command';
}

export function isUrcGuard(cmd: TestCommand): cmd is UrcGuardCommand {
  return cmd.type === 'urc-guard';
}

export function isScriptCommand(cmd: TestCommand): cmd is ScriptCommand {
  return cmd.type === 'script';
}

// ============ 默认对象工厂 ============
export function createCommand(type: CommandType = 'command'): TestCommand {
  const base = {
    id: genId('cmd'),
    name: '',
    description: '',
    content: '',
    dataFormat: 'utf8' as const,
    lineEnding: 'crlf' as const,
    preDelay: 0,
    postDelay: 0,
    selected: true,               // v1: 默认勾选执行
    status: 'pending' as const,
  };

  if (type === 'urc-guard') {
    return {
      ...base,
      type: 'urc-guard',
      pattern: '',
      matchMode: 'contains',
      scope: 'case',
      action: 'fail-current',
      rearm: 'continuous',
    };
  }

  if (type === 'script') {
    return {
      ...base,
      type: 'script',
      scriptPath: '',
      command: '',
      timeout: 30000,
      onFailure: 'abort',
    };
  }

  // 普通命令
  return {
    ...base,
    type: 'command',
    repeatCount: 1,
    successThreshold: 1,
    stopWhenReached: true,
    attemptInterval: 1000,
    timeout: 2000,
    validation: 'standard',
    validationPattern: '',
    validationMode: 'contains',
    onFailure: 'abort',
  };
}

/**
 * 命令类型转换：保留通用字段（id/name/description/content/dataFormat等），
 * 用目标类型默认值填充专属字段，尽量复用可共享字段（如 pattern/matchMode/timeout/extractConfig）。
 */
export function convertCommandType(source: TestCommand, targetType: CommandType): TestCommand {
  // 创建目标类型的默认命令
  const target = createCommand(targetType);

  // 保留通用字段（BaseCommand）
  target.id = source.id;
  target.name = source.name || '';
  target.description = source.description || '';
  target.content = source.content || '';
  target.dataFormat = source.dataFormat;
  target.lineEnding = source.lineEnding;
  target.preDelay = source.preDelay;
  target.postDelay = source.postDelay;
  target.selected = source.selected;
  target.status = source.status;

  // 尝试保留跨类型可共享的字段
  // pattern/matchMode（command ↔ urc-guard 互转时保留）
  if ('pattern' in source && 'pattern' in target) {
    target.pattern = source.pattern;
  }
  if ('matchMode' in source && 'matchMode' in target) {
    target.matchMode = source.matchMode;
  }

  // timeout（command 独有，仅在转为 command 时保留源的 timeout）
  if ('timeout' in source && 'timeout' in target) {
    target.timeout = source.timeout;
  }

  // extractConfig（两种类型都支持，优先保留）
  if ('extractConfig' in source && source.extractConfig) {
    (target as any).extractConfig = source.extractConfig;
  }

  // onFailure（仅 command 支持）
  if ('onFailure' in source && 'onFailure' in target) {
    target.onFailure = source.onFailure;
  }

  return target;
}

export function createCase(name = 'New Case'): TestCase {
  return {
    id: genId('case'),
    name,
    description: '',
    children: [],
    runCount: 1,
    onFailure: 'abort',
    maxSelfRetries: 1,
    selected: true,               // v1: 默认勾选执行
    isExpanded: true,
    status: 'pending',
  };
}

export function createRootCase(name = 'New Test'): RootTestCase {
  return {
    ...createCase(name),
    targetPort: 'P1',
  };
}

// ============ 树遍历 ============
/** 深度优先遍历所有用例（含子用例），回调返回 false 可提前终止 */
export function walkCases(
  cases: TestCase[],
  fn: (c: TestCase, parent: TestCase | null) => void | boolean,
  parent: TestCase | null = null,
): boolean {
  for (const c of cases) {
    if (fn(c, parent) === false) return false;
    // 递归遍历子用例（从 children 中筛选）
    const subCases = c.children.filter(isCase);
    if (!walkCases(subCases, fn, c)) return false;
  }
  return true;
}

/** 按 ID 查找用例（在整个树中） */
export function findCase(cases: TestCase[], id: string): TestCase | null {
  let found: TestCase | null = null;
  walkCases(cases, (c) => {
    if (c.id === id) {
      found = c;
      return false;
    }
  });
  return found;
}

/** 按 ID 查找命令及其所属用例（递归搜索 children） */
export function findCommand(
  cases: TestCase[],
  cmdId: string,
): { command: TestCommand; owner: TestCase } | null {
  let result: { command: TestCommand; owner: TestCase } | null = null;
  walkCases(cases, (c) => {
    const cmd = c.children.find((child) => isCommand(child) && child.id === cmdId);
    if (cmd && isCommand(cmd)) {
      result = { command: cmd, owner: c };
      return false;
    }
  });
  return result;
}

// ============ 遗留 urc-wait 归一化 ============
/**
 * 将遗留的 urc-wait 命令归一化为 command。
 * urc-wait 已废弃：异步命令用长超时的普通命令 + 自定义校验等待响应。
 * 字段映射：
 * - onTimeout='fail'     → validation='custom'（等不到即失败）
 * - onTimeout='continue' → validation='none'（响应可有可无，总是成功）
 */
function normalizeLegacyUrcWait(cmd: any): any {
  if (!cmd || cmd.type !== 'urc-wait') return cmd;

  const shouldValidate = cmd.onTimeout === 'fail';
  const {
    pattern,
    matchMode,
    onTimeout: _onTimeout,
    ...base
  } = cmd;

  return {
    ...base,
    type: 'command',
    repeatCount: 1,
    successThreshold: 1,
    stopWhenReached: true,
    attemptInterval: 1000,
    timeout: cmd.timeout ?? 10000,
    validation: shouldValidate ? 'custom' : 'none',
    validationPattern: shouldValidate ? pattern ?? '' : '',
    validationMode: shouldValidate ? matchMode ?? 'contains' : 'contains',
    onFailure: shouldValidate ? cmd.onFailure ?? 'continue' : 'continue',
  };
}

// ============ 导入时补齐默认值 ============
/**
 * 为导入的命令补齐缺失字段（手写 / AI 生成的 JSON 常只填关键项）。
 * 用 `?? 默认` 保留已有值（含 false / 0 等合法值），仅填补 undefined / null。
 * 默认值与 createCommand 保持一致，确保执行引擎读到的字段始终有效。
 */
export function withCommandDefaults(cmd: any): TestCommand {
  const base = {
    id: cmd.id || genId('cmd'),
    name: cmd.name ?? '',
    description: cmd.description ?? '',
    content: cmd.content ?? '',
    dataFormat: cmd.dataFormat ?? 'utf8',
    lineEnding: cmd.lineEnding ?? 'crlf',
    preDelay: cmd.preDelay ?? 0,
    postDelay: cmd.postDelay ?? 0,
    selected: cmd.selected ?? true,
    status: 'pending' as const,
  };

  if (cmd.type === 'urc-guard') {
    return {
      ...cmd,
      ...base,
      type: 'urc-guard',
      pattern: cmd.pattern ?? '',
      matchMode: cmd.matchMode ?? 'contains',
      scope: cmd.scope ?? 'case',
      action: cmd.action ?? 'fail-current',
      rearm: cmd.rearm ?? 'continuous',
      jumpTargetId: cmd.jumpTargetId ?? undefined,
      jumpMode: cmd.jumpMode ?? 'goto',
    };
  }

  if (cmd.type === 'script') {
    return {
      ...cmd,
      ...base,
      type: 'script',
      scriptPath: cmd.scriptPath ?? '',
      command: cmd.command ?? '',
      timeout: cmd.timeout ?? 30000,
      onFailure: cmd.onFailure ?? 'abort',
    };
  }

  // 标准命令（默认）
  return {
    ...cmd,
    ...base,
    type: 'command',
    repeatCount: cmd.repeatCount ?? 1,
    successThreshold: cmd.successThreshold ?? 1,
    stopWhenReached: cmd.stopWhenReached ?? true,
    attemptInterval: cmd.attemptInterval ?? 1000,
    timeout: cmd.timeout ?? 2000,
    validation: cmd.validation ?? 'standard',
    validationPattern: cmd.validationPattern ?? '',
    validationMode: cmd.validationMode ?? 'contains',
    onFailure: cmd.onFailure ?? 'abort',
    gotoTargetId: cmd.gotoTargetId ?? undefined,
  };
}

/** 为导入的用例补齐缺失字段（不含 children，由 reassignIds 递归处理） */
function withCaseDefaults(c: any): TestCase {
  return {
    ...c,
    name: c.name ?? 'Unnamed Case',
    description: c.description ?? '',
    runCount: c.runCount ?? 1,
    onFailure: c.onFailure ?? 'abort',
    maxSelfRetries: c.maxSelfRetries ?? 1,
    isExpanded: c.isExpanded ?? true,
  };
}

// ============ ID 重分配（导入时避免冲突） ============
/**
 * 递归为用例及其子项分配全新 ID，归一化遗留命令类型，并补齐缺失默认值。
 * @param isRoot 是否为根用例（根用例需保证 targetPort 存在）
 */
export function reassignIds(c: TestCase, isRoot = true): TestCase {
  const newCaseId = genId('case');
  const newChildren = c.children.map((child) => {
    if (isCase(child)) {
      return reassignIds(child, false); // 递归处理子用例
    } else {
      // 归一化遗留 urc-wait，补齐默认值，再重新分配 ID
      return { ...withCommandDefaults(normalizeLegacyUrcWait(child)), id: genId('cmd') };
    }
  });

  const withDefaults = withCaseDefaults(c);

  return {
    ...withDefaults,
    // 根用例保证 targetPort 存在（执行引擎依赖它做端口校验）
    ...(isRoot ? { targetPort: (c as any).targetPort ?? 'P1' } : {}),
    id: newCaseId,
    children: newChildren,
    status: 'pending',
    selected: false,
  };
}

// ============ 序列化 ============
export function exportToFile(rootCase: RootTestCase): TestCaseFile {
  return {
    version: '2.0',
    createdAt: new Date().toISOString(),
    rootCase,
  };
}

/** 解析并校验导入的 JSON，重分配 ID，迁移旧格式 */
export function parseImportFile(json: string): TestCase[] {
  const data = JSON.parse(json) as unknown;
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid JSON format');
  }

  const file = data as Partial<TestCaseFile>;

  // v2 格式（单根）
  if (file.version === '2.0' && file.rootCase) {
    return [reassignIds(file.rootCase)];
  }

  // v1 格式（旧多根）迁移
  if (Array.isArray((file as any).testCases)) {
    const legacyCases = (file as any).testCases as any[];
    return legacyCases.map((c) => reassignIds(migrateLegacyCase(c)));
  }

  throw new Error('Unrecognized file format');
}

// ============ 旧格式迁移（v1 -> v2） ============
/** 将旧命令迁移为新命令（丢弃 jumpConfig，映射字段） */
function migrateLegacyCommand(old: any): TestCommand {
  const base = {
    id: old.id || genId('cmd'),
    name: old.name || '',
    description: old.description || '',
    content: old.command ?? old.content ?? '',
    dataFormat: (old.dataFormat === 'hex' ? 'hex' : 'utf8') as 'utf8' | 'hex',
    lineEnding: old.lineEnding || 'crlf',
    preDelay: 0,
    postDelay: 0,
    selected: old.selected ?? true,
    status: 'pending' as const,
  };

  // 旧 urc 类型 -> urc-guard
  if (old.type === 'urc') {
    return {
      ...base,
      type: 'urc-guard',
      pattern: old.urcPattern || '',
      matchMode: old.urcMatchMode || 'contains',
      scope: 'case',
      action: 'fail-current',
      rearm: old.urcListenMode === 'once' ? 'once' : 'continuous',
    };
  }

  // 旧 execution 类型 -> command
  // 校验方法映射：contains/equals/regex -> custom, none -> none
  let validation: ValidationType = 'standard';
  let validationMode: MatchMode = 'contains';
  if (old.validationMethod === 'none') {
    validation = 'none';
  } else if (old.validationMethod) {
    validation = 'custom';
    validationMode = old.validationMethod === 'equals' ? 'exact' : old.validationMethod;
  }

  return {
    ...base,
    type: 'command',
    repeatCount: 1,
    successThreshold: 1,
    stopWhenReached: true,
    attemptInterval: old.retryDelay ?? 1000,
    timeout: old.waitTime ?? 2000,
    validation,
    validationPattern: old.validationPattern || old.expectedResponse || '',
    validationMode,
    onFailure: old.stopOnFailure === false ? 'continue' : 'abort',
    extractConfig: old.dataParseConfig?.enabled
      ? {
          enabled: true,
          parseType: old.dataParseConfig.parseType,
          parsePattern: old.dataParseConfig.parsePattern,
          parameterMap: old.dataParseConfig.parameterMap || {},
        }
      : undefined,
  };
}

/** 将旧用例迁移为新用例（commands + subCases 合并为 children） */
function migrateLegacyCase(old: any): TestCase {
  const commands: CaseChild[] = (old.commands || []).map(migrateLegacyCommand);
  const subCases: CaseChild[] = (old.subCases || []).map(migrateLegacyCase);

  return {
    id: old.id || genId('case'),
    name: old.name || 'Unnamed Case',
    description: old.description || '',
    children: [...commands, ...subCases],
    runCount: old.runCount ?? 1,
    onFailure: old.failureStrategy === 'continue' ? 'continue' : 'abort',
    maxSelfRetries: 1,
    selected: old.selected ?? true,
    isExpanded: old.isExpanded ?? true,
    status: 'pending',
  };
}

// ============ 串口数据处理 ============
/** 文本转 Uint8Array（UTF-8 或 HEX） */
export function textToBytes(text: string, format: 'utf8' | 'hex'): Uint8Array {
  if (format === 'hex') {
    const hex = text.replace(/\s/g, '');
    const bytes = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

/** 添加行结束符 */
export function appendLineEnding(text: string, lineEnding: 'none' | 'lf' | 'cr' | 'crlf'): string {
  switch (lineEnding) {
    case 'lf':
      return text + '\n';
    case 'cr':
      return text + '\r';
    case 'crlf':
      return text + '\r\n';
    default:
      return text;
  }
}

// ============ 变量提取与替换 ============

/** 可见 ASCII 字符集（用于 str 模式） */
const STR_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 随机整数 [0, max) */
function randInt(max: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/** 生成 N 个随机可见字符 */
function genRandStr(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += STR_CHARS[randInt(STR_CHARS.length)];
  }
  return out;
}

/** 生成 N 字节随机数据，输出为 2N 个大写 HEX 字符 */
function genRandHex(nBytes: number): string {
  const bytes = new Uint8Array(nBytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < nBytes; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * 变量替换：
 * 1) ${varName}          —— 提取型变量，从字典查表替换
 * 2) ${rand:str:N}       —— 生成 N 个随机可见字符
 * 3) ${rand:hex:N}       —— 生成 N 字节随机数据，输出 2N 个大写 HEX 字符
 * 4) ${seq:start:step}   —— 序列生成器，每次调用自增（start 起始值，step 步长）
 * 5) ${seq:start:step:max} —— 带上限的序列生成器（达到 max 后保持）
 *
 * 生成型函数变量每次调用都重新生成（压测重复发送时每次不同）。
 * 先做字典替换再做函数展开：这样长度参数也可用提取变量，
 * 例如 ${rand:hex:${len}} 会先把 ${len} 替换成数字再生成对应长度随机数据。
 *
 * 序列计数器每轮用例重置（用例 runCount 的每一轮都从初始值开始）。
 */
/**
 * 替换变量结果
 */
export interface ReplaceResult {
  text: string;
  counterUpdates: Array<{ key: string; value: number }>;
}

/**
 * 变量替换
 * @param returnUpdates 如果为 true，不直接修改 sequenceCounters，而是返回更新信息（用于 Zustand + Immer）
 */
export function replaceVariables(
  text: string,
  variables: Record<string, string>,
  sequenceCounters?: Map<string, number>,
): string;
export function replaceVariables(
  text: string,
  variables: Record<string, string>,
  sequenceCounters: Map<string, number> | undefined,
  returnUpdates: true,
): ReplaceResult;
export function replaceVariables(
  text: string,
  variables: Record<string, string>,
  sequenceCounters?: Map<string, number>,
  returnUpdates?: boolean,
): string | ReplaceResult {
  const counterUpdates: Array<{ key: string; value: number }> = [];

  // 1) 提取型变量字典替换
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
  }

  // 2) 序列生成器 ${seq:start:step} 或 ${seq:start:step:max}
  if (sequenceCounters) {
    result = result.replace(
      /\$\{seq:(-?\d+):(-?\d+)(?::(-?\d+))?\}/g,
      (_match, startStr, stepStr, maxStr) => {
        const start = parseInt(startStr, 10);
        const step = parseInt(stepStr, 10);
        const max = maxStr ? parseInt(maxStr, 10) : undefined;

        // 计数器 key：包含完整参数以区分不同序列
        const key = `seq:${start}:${step}${max !== undefined ? ':' + max : ''}`;

        // 获取当前值（首次使用则为起始值）
        const current = sequenceCounters.has(key) ? sequenceCounters.get(key)! : start;

        // 检查上限
        let returnValue: string;
        if (max !== undefined && current > max) {
          returnValue = String(max);  // 达到上限，返回最大值
        } else {
          returnValue = String(current);
        }

        // 计算下次值
        const nextValue = current + step;

        if (returnUpdates) {
          // 新模式：不直接修改 Map，返回更新信息（用于 Zustand + Immer）
          counterUpdates.push({ key, value: nextValue });
        } else {
          // 旧模式：直接修改 Map（用于测试和非 Zustand 场景）
          sequenceCounters.set(key, nextValue);
        }

        return returnValue;
      }
    );
  }

  // 3) 生成型函数变量 ${rand:str:N} / ${rand:hex:N}
  result = result.replace(/\$\{rand:(str|hex):(\d+)\}/g, (_match, kind: string, lenStr: string) => {
    const n = parseInt(lenStr, 10);
    if (n <= 0) return '';
    return kind === 'hex' ? genRandHex(n) : genRandStr(n);
  });

  if (returnUpdates) {
    return { text: result, counterUpdates };
  }
  return result;
}

/** 数据提取到变量（regex 或 split） */
export function extractVariables(
  text: string,
  config: ExtractConfig,
): Record<string, string> {
  const extracted: Record<string, string> = {};
  if (!config.enabled) return extracted;

  try {
    if (config.parseType === 'regex') {
      const regex = new RegExp(config.parsePattern);
      const match = regex.exec(text);
      if (match) {
        for (const [paramName, groupIndex] of Object.entries(config.parameterMap)) {
          const index = parseInt(groupIndex, 10);
          if (match[index] !== undefined) {
            extracted[paramName] = match[index];
          }
        }
      }
    } else {
      const parts = text.split(config.parsePattern);
      for (const [paramName, indexStr] of Object.entries(config.parameterMap)) {
        const index = parseInt(indexStr, 10);
        if (parts[index] !== undefined) {
          extracted[paramName] = parts[index].trim();
        }
      }
    }
  } catch {
    // 提取失败返回空对象
  }

  return extracted;
}

// ============ 校验与匹配 ============
/** 标准 AT 校验：包含 OK 视为通过 */
const STANDARD_SUCCESS = /\bOK\b/;
const STANDARD_ERROR = /\bERROR\b|\+CME ERROR|\+CMS ERROR/;

/** 校验响应（standard=OK通过, custom=自定义模式, none=永远通过） */
export function validateResponse(
  response: string,
  validation: ValidationType,
  pattern?: string,
  mode: MatchMode = 'contains',
): { valid: boolean; error?: string } {
  if (validation === 'none') return { valid: true };

  if (validation === 'standard') {
    if (STANDARD_ERROR.test(response)) return { valid: false };
    return { valid: STANDARD_SUCCESS.test(response) };
  }

  // custom
  if (!pattern) return { valid: false, error: 'Missing validation pattern' };
  return { valid: matchPattern(response, pattern, mode) };
}

/** 通用模式匹配（用于自定义校验和 URC 匹配） */
export function matchPattern(data: string, pattern: string, mode: MatchMode): boolean {
  switch (mode) {
    case 'contains':
      return data.includes(pattern);
    case 'exact':
      return data.trim() === pattern.trim();
    case 'startsWith':
      return data.trimStart().startsWith(pattern);
    case 'endsWith':
      return data.trimEnd().endsWith(pattern);
    case 'regex':
      try {
        return new RegExp(pattern).test(data);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** 检测标准错误响应（用于提前失败） */
export function isStandardError(response: string): boolean {
  return STANDARD_ERROR.test(response);
}

