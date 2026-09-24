// 协议解析 DSL —— 语义检查。见 docs 规范 §5 / §7.2。
// 导入期拒绝：字段重名、位宽和不符、引用未声明字段、match tag 非整数、
// struct 未定义、根结构体未定义等。

import type {
  DslFile, StructDef, Field, TypeExpr, Expr, BitfieldType,
} from "./ast";

export class SemanticError extends Error {}

const INT_TYPES = new Set(["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64"]);

function isIntField(f: Field): boolean {
  const t = f.type;
  if (t.kind === "scalar") return INT_TYPES.has(t.base);
  if (t.kind === "varint") return true;
  // bcd 修饰的 bytes 也可作数值长度引用，但 match tag 要求整数字段——从严只认标量整数/varint
  return false;
}

// 收集表达式引用的标识符
function refsOf(e: Expr, out: Set<string>): void {
  switch (e.kind) {
    case "id": out.add(e.name); break;
    case "unary": refsOf(e.operand, out); break;
    case "binary": refsOf(e.left, out); refsOf(e.right, out); break;
    default: break;
  }
}

function checkTypeExprRefs(t: TypeExpr, declared: Set<string>, structName: string): void {
  const check = (e: Expr) => {
    const refs = new Set<string>();
    refsOf(e, refs);
    for (const r of refs) {
      if (!declared.has(r)) {
        throw new SemanticError(`struct ${structName}: 表达式引用未声明字段 "${r}"`);
      }
    }
  };
  if (t.kind === "bytes") check(t.length);
  if (t.kind === "array") check(t.count);
}

function checkBitfield(t: BitfieldType, structName: string, fieldId: string): void {
  let sum = 0;
  const seen = new Set<string>();
  for (const bf of t.fields) {
    if (seen.has(bf.id)) throw new SemanticError(`struct ${structName}.${fieldId}: 位域子字段重名 "${bf.id}"`);
    seen.add(bf.id);
    sum += bf.hi - bf.lo + 1;
  }
  if (sum !== t.bitSize) {
    throw new SemanticError(`struct ${structName}.${fieldId}: 位域子字段位宽之和 ${sum} ≠ bitfield(${t.bitSize})`);
  }
}

function checkStruct(s: StructDef, file: DslFile): void {
  const declared = new Set<string>();
  const intFields = new Set<string>();

  for (const f of s.fields) {
    if (declared.has(f.id)) throw new SemanticError(`struct ${s.name}: 字段 id 重复 "${f.id}"`);

    // 引用必须是「前面已声明」——用当前 declared 快照校验
    if (f.cond) {
      const refs = new Set<string>();
      refsOf(f.cond, refs);
      for (const r of refs) if (!declared.has(r)) {
        throw new SemanticError(`struct ${s.name}.${f.id}: if 引用未声明字段 "${r}"`);
      }
    }
    checkTypeExprRefs(f.type, declared, s.name);

    // 类型专项
    if (f.type.kind === "bitfield") checkBitfield(f.type, s.name, f.id);

    if (f.type.kind === "match") {
      if (!intFields.has(f.type.tag)) {
        throw new SemanticError(`struct ${s.name}.${f.id}: match tag "${f.type.tag}" 必须是前面已声明的整数字段`);
      }
      for (const c of f.type.cases) {
        const b = c.body;
        if (b.kind === "structRef" && !file.structs[b.name]) {
          throw new SemanticError(`struct ${s.name}.${f.id}: match 分支引用未定义 struct "${b.name}"`);
        }
      }
    }

    if (f.type.kind === "structRef" && !file.structs[f.type.name]) {
      throw new SemanticError(`struct ${s.name}.${f.id}: 引用未定义 struct "${f.type.name}"`);
    }

    // 声明入表（供后续字段引用）
    declared.add(f.id);
    if (isIntField(f)) intFields.add(f.id);
  }
}

export function check(file: DslFile): void {
  if (!file.root) throw new SemanticError("缺少 root 声明");
  if (!file.structs[file.root]) throw new SemanticError(`根结构体 "${file.root}" 未定义`);
  for (const s of Object.values(file.structs)) checkStruct(s, file);
}
