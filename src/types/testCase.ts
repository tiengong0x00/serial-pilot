/**
 * 测试用例系统类型定义 (v1 模型)
 * 设计原则：
 * 1. 单根用例模型：1 个 JSON 文件 = 1 个根用例
 * 2. 递归树遍历执行，无程序计数器、无扁平化、无跳转
 * 3. 每个命令/用例独立配置失败策略（continue/end-round/retry-self/abort）
 * 4. URC 处理：异步命令用长超时的普通命令等待响应，模块主动上报用后台守护(urc-guard)
 */

import type { PortLabel } from './serial';
export type { PortLabel } from './serial';

// ============ 通用枚举 ============
export type CommandStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'interrupted'
  | 'skipped';

export type DataFormat = 'utf8' | 'hex';
export type LineEnding = 'none' | 'lf' | 'cr' | 'crlf';

/** 校验类型：none=发完即成功 / standard=标准AT(OK通过) / custom=自定义模式 */
export type ValidationType = 'none' | 'standard' | 'custom';
/** 自定义校验的匹配方式 */
export type MatchMode = 'contains' | 'exact' | 'regex' | 'startsWith' | 'endsWith';

/**
 * 失败策略（重试耗尽后的动作）
 * - continue:   跳过失败，执行下一个兄弟节点
 * - end-round:  结束本轮（父用例有循环则进入下一轮；无循环则结束本用例）
 * - retry-self: 重新执行本节点（仅用例支持，受 maxSelfRetries 限制）
 * - abort:      中断整个测试
 */
export type FailureAction = 'continue' | 'end-round' | 'retry-self' | 'abort';
/** 命令级失败策略（不含 retry-self，命令重试由 maxAttempts 负责） */
export type CommandFailureAction = 'continue' | 'end-round' | 'abort' | 'goto';

// ============ 命令类型 ============
/** command=普通AT命令（支持长超时等待异步响应） / urc-guard=后台URC守护 / script=外部脚本 */
export type CommandType = 'command' | 'urc-guard' | 'script';

/** 后台守护命中后的动作 */
export type UrcGuardAction =
  | 'restart-round'  // 重开本轮
  | 'abort'          // 结束整个测试
  | 'fail-current'   // 判当前节点失败
  | 'capture-only'   // 仅提取变量
  | 'log-only'       // 仅记录日志
  | 'jump-to';       // 跳转到目标命令

/** 守护动作优先级（多守护同时命中时的裁决顺序，数值越大越优先） */
export const URC_GUARD_ACTION_PRIORITY: Record<UrcGuardAction, number> = {
  abort: 5,
  'jump-to': 4,      // 跳转优先级高于重启轮次
  'restart-round': 3,
  'fail-current': 2,
  'capture-only': 1,
  'log-only': 0,
};

// ============ 变量提取配置 ============
export interface ExtractConfig {
  enabled: boolean;
  parseType: 'regex' | 'split';
  parsePattern: string;                 // 正则或分隔符
  parameterMap: Record<string, string>; // 变量名 -> 捕获组索引/分片索引
}

// ============ 测试命令（基础字段） ============
export interface BaseCommand {
  id: string;
  name?: string;
  description?: string;

  // 发送配置
  content: string;                      // 命令内容（支持 ${varName} 变量替换）
  dataFormat: DataFormat;
  lineEnding: LineEnding;

  // 时序控制
  preDelay: number;                     // 发送前延迟(ms)
  postDelay: number;                    // 成功后延迟(ms)

  // 交互状态
  selected: boolean;                    // 是否参与执行（勾选开关）
  status: CommandStatus;                // 运行状态
}

// ============ 普通命令 (type='command') ============
export interface StandardCommand extends BaseCommand {
  type: 'command';

  // 重复策略
  repeatCount: number;                  // 发送次数（≥1，1=不重复）
  successThreshold: number;             // 需成功几次才算命令成功（≤repeatCount）
  stopWhenReached: boolean;             // 达到阈值后立即停止（否=发满repeatCount）
  attemptInterval: number;              // 重发间隔(ms)

  // 响应校验
  timeout: number;                      // 单次等待超时(ms)，validation='none'时不生效
  validation: ValidationType;
  validationPattern?: string;           // standard时不需要，custom时必需
  validationMode?: MatchMode;           // custom时的匹配方式

  // 变量提取
  extractConfig?: ExtractConfig;

  // 失败处理
  onFailure: CommandFailureAction;
  gotoTargetId?: string;                // onFailure='goto' 时生效：跳转目标命令 id

  // 双串口路由（可选）：undefined=继承用例默认口(targetPort)
  // 支持场景：P1发P2收（交叉）、某命令改用P2操作（混合）
  txPort?: PortLabel;                   // 发送端口，默认继承用例默认口
  rxPort?: PortLabel;                   // 接收/校验端口，默认继承用例默认口

  // 高级配置（可选）：硬件信号控制
  advancedConfig?: {
    dtr?: 'inherit' | 'high' | 'low';   // DTR 控制：继承/拉高/拉低
    rts?: 'inherit' | 'high' | 'low';   // RTS 控制：继承/拉高/拉低
  };

  // 文件发送（可选）：拖入文件时记录，执行时按分包设置发送
  fileData?: {
    name: string;       // 文件名（显示用）
    size: number;       // 字节数
    id?: string;        // 新:附件 id（磁盘缓存文件名,流式读盘发送）
    base64?: string;    // 旧:兼容已存老用例,只读不再新增
  };
}

// ============ URC 后台守护 (type='urc-guard') ============
export interface UrcGuardCommand extends BaseCommand {
  type: 'urc-guard';

  pattern: string;
  matchMode: MatchMode;
  scope: 'root' | 'case';               // 作用域：根级全程 / 用例级局部
  action: UrcGuardAction;               // 命中后动作
  rearm: 'once' | 'continuous';         // 触发后：停止监听 / 继续监听

  extractConfig?: ExtractConfig;
  // 守护不需要 onFailure（它本身不会"失败"）

  // 跳转配置（action='jump-to' 时生效）
  // 目标以命令 id 引用，运行时解析为同用例内下标（存活于命令重排/删除）
  jumpTargetId?: string;                // 跳转目标命令 id
  jumpMode?: 'goto' | 'call';           // goto=直接跳转不返回 / call=跑完目标单条命令后回原位

  // 监听端口（可选）：undefined=继承用例默认口(targetPort)
  // 支持场景：主流程在P1，但守护监听P2的上报
  listenPort?: PortLabel;
}

// ============ 脚本命令 (type='script') ============
export interface ScriptCommand extends BaseCommand {
  type: 'script';

  // 脚本配置
  scriptPath: string;                   // 脚本路径（用于确定工作目录=脚本所在目录）
  command: string;                      // 完整执行命令（支持 ${varName} 替换），如: python validate.py --mode fast ${port}
  timeout: number;                      // 执行超时(ms)，默认 30000，最大 300000

  // 失败处理
  onFailure: CommandFailureAction;
}

// ============ 联合命令类型 ============
export type TestCommand = StandardCommand | UrcGuardCommand | ScriptCommand;

// ============ 测试用例 ============
export type CaseStatus = 'pending' | 'running' | 'success' | 'failed' | 'interrupted' | 'skipped';

/** 用例子项：命令或子用例 */
export type CaseChild = TestCommand | TestCase;

export interface TestCase {
  id: string;
  name: string;
  description?: string;

  // 有序子项列表（命令与子用例交错）
  children: CaseChild[];

  // 循环与失败处理
  runCount: number;                     // 循环次数（0=无限循环，需手动停止）
  onFailure: FailureAction;             // 子项失败冒泡后的动作
  maxSelfRetries?: number;              // retry-self 的上限（默认1），耗尽后转 continue

  // 双串口路由（可选）：undefined=继承父级。tx/rx 各自独立继承。
  // 三级继承：根用例(targetPort) → 用例 txPort/rxPort → 命令 txPort/rxPort
  txPort?: PortLabel;                   // 本用例及子项默认发送口
  rxPort?: PortLabel;                   // 本用例及子项默认接收口

  // 交互状态
  selected: boolean;                    // 启用开关（未勾选→整个子树跳过）
  isExpanded: boolean;                  // UI 折叠展开状态
  status: CaseStatus;
}

// ============ 根用例（额外字段） ============
export interface RootTestCase extends TestCase {
  targetPort: PortLabel;                // 目标串口（从已打开端口选择）
}

// ============ 序列化格式（JSON 文件） ============
export interface TestCaseFile {
  version: string;                      // 格式版本（当前 "2.0" v1模型）
  createdAt?: string;                   // ISO 时间戳
  rootCase: RootTestCase;               // 单根用例
}

// ============ 执行上下文（v1 递归模型） ============
export interface ExecutionContext {
  variables: Record<string, string>;    // 运行时变量池
  targetPort: PortLabel;                // 目标串口
  startTime: number;                    // 执行开始时间

  // 后台守护注册表（防重复注册）
  activeGuards: Map<string, UrcGuardCommand>;  // guardId -> 守护配置

  // 序列计数器（${seq:start:step} 自增变量支持）
  sequenceCounters: Map<string, number>;  // key="seq:60:20" -> 当前值
}

// ============ 向后兼容：旧格式类型（导入时自动迁移） ============
export interface LegacyTestCaseFile {
  version: '1.0';
  createdAt?: string;
  testCases: Array<{
    id: string;
    name: string;
    description?: string;
    commands: Array<{
      id: string;
      type: 'execution' | 'urc';        // 旧类型
      command: string;
      validationMethod?: 'none' | 'contains' | 'equals' | 'regex';
      expectedResponse?: string;
      validationPattern?: string;
      waitTime?: number;
      stopOnFailure?: boolean;
      failureSeverity?: 'warning' | 'error';
      maxAttempts?: number;
      retryDelay?: number;
      lineEnding?: LineEnding;
      dataFormat?: DataFormat;
      selected?: boolean;
      status?: CommandStatus;
      jumpConfig?: unknown;             // 废弃字段，迁移时丢弃
      [key: string]: unknown;
    }>;
    subCases?: Array<unknown>;
    failureStrategy?: string;
    runMode?: string;
    runCount?: number;
    isExpanded?: boolean;
    selected?: boolean;
    status?: string;
    [key: string]: unknown;
  }>;
}

