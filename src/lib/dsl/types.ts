// 协议解析 DSL —— 解析结果的输出契约。
//
// 与旧 Kaitai 引擎保持一致，供 DecodeTree / HexDump / nativeProtocols 复用：
//   ParsedNode（带精确字节范围的树节点） + ParseResult（含 byteOwner 联动映射）。
// 新增 warning?：固定值不匹配 / BCD 非法半字节等「不中断」的软告警。

export type Endian = "be" | "le";

/** 解析结果树节点：字段名 + 精确字节范围 + 值 + 子节点 */
export interface ParsedNode {
  id: string;             // 稳定唯一 id（路径式），供联动定位
  name: string;
  byteStart: number;      // 起始字节偏移（含）
  byteEnd: number;        // 结束字节偏移（不含）
  bitOffset?: number;     // 位域：在 byteStart 内的位偏移（从高位起 0）
  bitLen?: number;        // 位域宽度
  typeLabel: string;      // 展示用类型标签
  rawHex: string;         // 覆盖字节的 hex
  value: string;
  meaning?: string;       // enum 含义 / 派生展示
  warning?: string;       // 软告警：固定值不匹配、BCD 非法半字节、降级等
  error?: boolean;
  isGroup?: boolean;      // 子结构容器
  children?: ParsedNode[];
}

export interface ParseResult {
  root: ParsedNode[];            // 顶层字段
  byteOwner: (string | null)[];  // byteOwner[i] = 拥有第 i 字节的叶子节点 id
  totalBytes: number;
  bytesConsumed: number;
  remaining: number[];
  errors: string[];
}
