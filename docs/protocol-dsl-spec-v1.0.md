# Protocol Parsing DSL — Language Specification v1.0

> A declarative, struct-style language for describing binary protocols.
> This document is aligned with the reference implementation (lexer → parser →
> semantic checker → interpreter). Where the language and the implementation
> could diverge, the behavior described here is what the implementation does.

---

## Table of Contents

1. Overview
2. Lexical Grammar
3. Syntax (EBNF)
4. Type System
5. Semantics
6. Encoding Rules
7. Error Handling
8. Examples
9. Scope and Limitations
10. Versioning

---

## 1. Overview

### 1.1 Design Goals

- **Struct-style**: isomorphic to C structs; zero-cost to read by hand.
- **Storage / encoding separation**: the storage type decides *how many bytes to
  read*; modifiers decide *how to interpret those bytes*.
- **First-class bitfields**: `bitfield(N)` declares the total bit width
  explicitly; sub-fields occupy consecutive bits from the MSB.
- **Explicit degradation**: the `parse` attribute declares a sub-parser; when a
  sub-parser is not available the field degrades to a raw `{ len, data }` node.
- **Linear reading**: fields are read top-to-bottom, matching byte-stream order.
- **Spec-to-DSL directness**: each row of a protocol table maps to one line.
- **AI-friendly**: regular, line-oriented, no nested-bracket soup.

### 1.2 Applicability

Designed for **binary, field-table-driven** protocols, for example:

- Device / DTU reporting frames
- Hardware register and frame protocols
- Cellular quality reports (LTE / NB-IoT / Cat.M1)
- MQTT control packets

Not intended for text protocols (HTTP), streaming framing, or checksum
computation.

---

## 2. Lexical Grammar

### 2.1 Character Set and Whitespace

- Source files are **UTF-8**.
- Whitespace (space, tab, CR, LF) acts only as a separator.
- Comments start with `#` and run to end of line.

### 2.2 Identifiers

```
identifier = ( letter | "_" ) { letter | digit | "_" }
letter     = "A".."Z" | "a".."z"
digit      = "0".."9"
```

> **Implementation note.** Identifiers are ASCII-only. Non-ASCII text (e.g. CJK
> labels) is **not** a valid identifier and must be written as a quoted string,
> including enum labels.

**Reserved words** (cannot be used as identifiers):

```
endian  root  struct  enum  match  if  parse  fallback
be  le  rest  and  or  not  true  false  _
```

### 2.3 Literals

```
number  = decimal | hex | binary
decimal = digit { digit }
hex     = "0x" hexdigit { hexdigit }
binary  = "0b" bindigit { bindigit }
string  = '"' { any_char_except_quote | escape } '"'
escape  = "\" ( '"' | "\" | "n" | "t" | "r" )
```

> **Bare hex literal (fixed values only).** A token like `EB90` or `F1F1F1` is
> lexed as an *identifier* and, in a `= literal` position, is treated as a byte
> sequence when it is all hex digits and has an even length. Because the lexer
> reads a leading digit as a *number*, a bare hex literal must **start with a
> hex letter** (`a`–`f` / `A`–`F`). For a value that starts with a digit, use
> the numeric form (`= 0x0D0A`) instead.

### 2.4 Punctuation and Operators

```
:  {  }  [  ]  (  )  =  ,  =>
==  !=  <  >  <=  >=
+  -  *  /  %
```

### 2.5 Keyword Categories

| Category | Keywords |
|---|---|
| Top level | `endian` `root` `struct` `enum` |
| Endianness | `be` `le` |
| Control | `match` `if` `parse` `fallback` |
| Logic | `and` `or` `not` |
| Special | `rest` `_` |
| Storage types | `u8` `u16` `u32` `u64` `i8` `i16` `i32` `i64` `f32` `f64` `bytes` `varint` `bitfield` |
| Encoding modifiers | `bcd` `ascii` `hex` `enum` |

---

## 3. Syntax (EBNF)

### 3.1 Top Level

```ebnf
file             = { top_level } ;
top_level        = global_directive
                 | enum_def
                 | struct_def ;

global_directive = "endian" endian_kind
                 | "root" identifier ;

endian_kind      = "be" | "le" ;
```

- `endian` sets the global byte order; it may appear **at most once** and
  defaults to `be`.
- `root` names the root struct; it must reference a defined `struct`.

### 3.2 Enum Definition

```ebnf
enum_def   = "enum" identifier "{" { enum_entry } "}" ;
enum_entry = enum_key ":" enum_label [ "," ] ;
enum_key   = number ;
enum_label = identifier | string ;
```

- `enum_key` is the numeric value; keys are unique within an enum.
- Keys may be written in decimal or `0x` hex; both are stored as the decimal
  value internally.
- `enum_label` is the display label. Use a **quoted string** for any label that
  is not a bare ASCII identifier.

### 3.3 Struct Definition

```ebnf
struct_def = "struct" identifier "{" { field } "}" ;
field      = identifier ":" type_expr { field_attr } ;
field_attr = "=" literal
           | "if" expr
           | "parse" sub_parser
           | "fallback" fallback_spec ;
```

- Fields are read in declaration order.
- Field ids are unique within a struct.
- `field_attr`s may appear in any order and are semantically independent.

### 3.4 Type Expressions

```ebnf
type_expr    = storage_type { modifier }
             | bitfield_type
             | match_type
             | identifier ;              (* struct reference *)

storage_type = scalar_type
             | "bytes" "[" length_expr "]"
             | "varint" "(" number ")"
             | scalar_type "[" length_expr "]" ;

scalar_type  = "u8" | "u16" | "u32" | "u64"
             | "i8" | "i16" | "i32" | "i64"
             | "f32" | "f64" ;

modifier     = "bcd"
             | "ascii"
             | "hex"
             | "endian" endian_kind
             | "enum" ( identifier | inline_enum ) ;

inline_enum  = "{" { enum_entry } "}" ;
```

- `scalar_type[N]` is an array of `N` elements.
- `bytes[N]` reads `N` bytes.
- Modifiers may be combined and are order-independent.

### 3.5 Bitfields

```ebnf
bitfield_type = "bitfield" "(" bit_size ")" "{" { bit_field } "}" ;
bit_size      = "8" | "16" | "32" | "64" ;
bit_field     = identifier ":" bit_range { bit_attr } [ "," ] ;
bit_range     = number [ ":" number ] ;
bit_attr      = "enum" ( identifier | inline_enum ) ;
```

- Sub-fields occupy consecutive bits starting from the MSB.
- The sum of sub-field widths must equal `bit_size`.
- A range `k` is a single bit; `m:n` is bits `m` through `n` inclusive
  (order-insensitive — the higher value is the high bit).

### 3.6 Match

```ebnf
match_type = "match" identifier "{" { match_case } "}" ;
match_case = ( literal | "_" ) "=>" case_body ;
case_body  = type_expr ;
```

- The `match` tag must be an **integer field declared earlier**.
- Case labels are compared as **numeric** values.
- `_` is the optional default branch and must be last.
- The chosen case body is parsed at the **current position** — the tag bytes
  are not re-read.

### 3.7 Length Expressions

```ebnf
length_expr = length_term { ( "+" | "-" | "*" | "/" | "%" ) length_term } ;
length_term = number | identifier | "rest" | "(" length_expr ")" ;
```

- An `identifier` must reference an **integer field declared earlier**.
- `rest` means "all remaining bytes in the current reader window".
- Division truncates toward zero. The result must be a non-negative integer.

### 3.8 Conditional Expressions

```ebnf
expr     = or_expr ;
or_expr  = and_expr { "or" and_expr } ;
and_expr = not_expr { "and" not_expr } ;
not_expr = [ "not" ] cmp_expr ;
cmp_expr = add_expr [ cmp_op add_expr ] ;
cmp_op   = "==" | "!=" | "<" | ">" | "<=" | ">=" ;
add_expr = mul_expr { ( "+" | "-" ) mul_expr } ;
mul_expr = primary { ( "*" | "/" | "%" ) primary } ;
primary  = literal | identifier | "(" expr ")" | "-" primary | "rest" ;
```

- Referenced fields must be declared earlier.
- Results are treated as boolean: `0` is false, non-zero is true.

### 3.9 Sub-parsers and Degradation

```ebnf
sub_parser    = identifier                    (* built-in or struct name *)
              | "tlv"
              | "lwm2m" ;

fallback_spec = "raw" ;
```

- `parse <name>` declares an attempt to parse the field content with a
  sub-parser.
- **Implementation note.** No sub-parser (`tlv`, `lwm2m`, or any other name) is
  implemented in v1.0. Any field with a `parse` attribute **always degrades to
  raw**, emitting `{ len, data }` plus a warning that the sub-parser is not
  implemented. `fallback raw` is accepted syntactically but is redundant, since
  degradation is unconditional.

---

## 4. Type System

### 4.1 Storage Types

The storage type decides **how many bits/bytes are read**.

| Type | Width | Notes |
|---|---|---|
| `u8` `u16` `u32` `u64` | 8/16/32/64 | unsigned integer |
| `i8` `i16` `i32` `i64` | 8/16/32/64 | signed integer (two's complement) |
| `f32` `f64` | 32/64 | IEEE 754 float |
| `bytes[N]` | 8N | N raw bytes |
| `varint(N)` | variable | LEB128-style, up to N bytes |
| `bitfield(N)` | N | N-bit bitfield |
| `<StructName>` | variable | struct reference |
| `match <tag> { ... }` | variable | dispatch by tag |

> Integers wider than 53 bits (`u64` / `i64` near the top of their range) are
> accumulated in JS numbers and lose precision beyond 2^53. Treat 64-bit values
> as best-effort.

### 4.2 Encoding Modifiers

The modifier decides **how the bytes already read are interpreted**.

| Modifier | Applies to | Meaning | Default display |
|---|---|---|---|
| `bcd` | `u*` / `bytes[N]` | each nibble is one decimal digit | `u*` → number; `bytes[N]` → digit string |
| `ascii` | `bytes[N]` | decode as ASCII | string (`\xNN` for non-printables) |
| `hex` | any | show as hex | hex string |
| `endian le` / `be` | multi-byte `u* i* f*` | override byte order | — |
| `enum <Name>` | integer / `bcd` | map value to a label | value + label |

Modifiers combine and are order-independent.

### 4.3 Display Types

| Combination | Display |
|---|---|
| `u8` | number |
| `u8 bcd` | number (BCD-decoded, leading zeros stripped) |
| `u8 hex` | hex |
| `u8 enum X` | number + label |
| `bytes[6] bcd` | digit string |
| `bytes[N] ascii` | string |
| `bytes[N] hex` | hex string |

---

## 5. Semantics

### 5.1 Scope

- Field ids are unique within their struct.
- Struct names and enum names are unique within the file.
- Length and conditional expressions may only reference fields declared
  **earlier in the same struct**.
- A `match` tag must be an integer field declared earlier in the same struct.
- Only scalar integers (`u*` / `i*`) and `varint` count as "integer fields" for
  `match` tags. A `bcd`-modified `bytes[N]` does **not** qualify as a match tag,
  although its numeric value is still available to length/`if` expressions.

### 5.2 Bitfields

- `bit_size` is one of 8, 16, 32, 64.
- Sub-field widths must sum exactly to `bit_size` (no gaps, no overlap).
- Sub-fields are laid out from the MSB.
- Bit order is independent of the global byte order.

### 5.3 Length Expressions

- The result must be a non-negative integer.
- `rest` is the remaining byte count of the current reader window.
- A `bcd` field referenced by length resolves to its decimal numeric value.

### 5.4 Conditional Fields

- When `if` is false the field consumes **no bytes** and is skipped entirely.
- Referenced fields must already be declared.

### 5.5 Fixed-value Checks

- `= literal` declares an expected value.
- On mismatch the field is flagged with a **warning** and parsing continues.
- The warning includes the expected value, the actual value, and the offset.

### 5.6 Degradation

- A field with `parse` degrades to `{ len, data }`, where `len` is the field
  byte length and `data` is the hex string, plus a warning.
- Degradation does not interrupt parsing.

### 5.7 Multi-byte Integers

- Multi-byte `u* i* f*` use the global byte order, or a field-level `endian`
  modifier when present.
- `bcd` fields are unaffected by byte order.
- `bitfield` layout is unaffected by byte order.

---

## 6. Encoding Rules

### 6.1 BCD

Each byte holds two decimal digits: the high nibble is the tens digit, the low
nibble is the units digit.

- `0x95` → `95`
- A nibble greater than 9 is an encoding error and raises a warning.

### 6.2 ASCII

`bytes[N] ascii` decodes byte by byte. Non-printable bytes are shown as `\xNN`.

### 6.3 HEX

`hex` affects display only, not interpretation.

### 6.4 Enum

`enum` maps an integer to a label. An unmatched value is displayed as an
"unknown" label together with the raw value.

### 6.5 varint

Little-endian base-128: the low group comes first; the high bit of each byte is
the continuation flag.

```
value = 0
shift = 0
loop:
    byte = next()
    value |= (byte & 0x7F) << shift
    if (byte & 0x80) == 0: break
    shift += 7
    if bytes_read >= N: warn "varint exceeds N bytes"; break
```

---

## 7. Error Handling

### 7.1 Error Categories

| Category | When | Behavior |
|---|---|---|
| **Syntax error** | on import | rejected; reported with line number |
| **Semantic error** | on import | rejected; reports the offending field/reference |
| **Parse error** | at parse time | recorded in `errors[]`; aborts the remaining walk |
| **Validation warning** | at parse time | recorded as a warning; parsing continues |
| **Degradation** | at parse time | emits `{ len, data }`; parsing continues |

> **Implementation note.** A runtime parse error (byte-stream underflow, illegal
> length, varint overflow) is caught at the top level, so it aborts the rest of
> the walk rather than only the current struct. Nodes parsed before the error
> are still returned, and `bytesConsumed` reflects progress up to the failure.

### 7.2 Semantic Error Checklist

- Missing `root` declaration, or `root` names an undefined struct.
- Duplicate field id within a struct.
- Bitfield sub-field widths do not sum to `bit_size`.
- Duplicate bitfield sub-field id.
- A length / `if` expression references an undeclared field.
- A `match` tag is not a prior integer field.
- A `match` branch references an undefined struct.
- A `structRef` type references an undefined struct.

### 7.3 Parse Error Checklist

- Byte-stream underflow (not enough bytes).
- Negative computed length.
- varint read past end of stream.

---

## 8. Examples

All examples below use synthetic, desensitized field layouts. When you author a
new rule, keep the reference comment in the header so readers can find the
grammar it targets.

### 8.1 Sensor Telemetry Frame

Demonstrates: fixed magic, enum, bitfield, `bytes hex`, `bytes bcd`,
length-prefixed ASCII, and a scalar array.

```
# Sensor telemetry frame (synthetic sample)
# DSL spec: https://github.com/tiengong0x00/serial-pilot/blob/main/docs/protocol-dsl-spec-v1.0.md

endian be
root Telemetry

enum Status {
  0x00: idle
  0x01: measuring
  0x02: fault
}

struct Telemetry {
  magic:      u16 hex = 0xEB90
  version:    u8
  status:     u8 enum Status
  flags:      bitfield(8) {
    low_batt:  7
    tamper:    6
    reserved:  5:2
    channel:   1:0
  }
  device_id:  bytes[4] hex
  ts:         bytes[7] bcd          # BCD datetime YYYYMMDDhhmmss
  name_len:   u8
  name:       bytes[name_len] ascii
  sample_cnt: u8
  samples:    i16[sample_cnt]
  footer:     u16 hex = 0xEB90
}
```

### 8.2 Command Frame with `match` Dispatch

Demonstrates: `match` on a prior integer field, struct references, conditional
fields, and a `_` default branch that captures the rest as raw bytes.

```
# Command frame with opcode dispatch (synthetic sample)
# DSL spec: https://github.com/tiengong0x00/serial-pilot/blob/main/docs/protocol-dsl-spec-v1.0.md

endian be
root Command

enum OpCode {
  0x01: read
  0x02: write
  0x03: reset
}

struct Command {
  opcode: u8 enum OpCode
  length: u8
  body:   match opcode {
    0x01 => ReadReq
    0x02 => WriteReq
    _    => bytes[length]
  }
}

struct ReadReq {
  address: u16 hex
  count:   u8
}

struct WriteReq {
  address:   u16 hex
  has_crc:   u8
  payload:   bytes[4] hex
  crc:       u16 hex if has_crc == 1
}
```

### 8.3 Length-delimited Frame with varint and Degradation

Demonstrates: `varint`, `bytes[rest]`, and `parse ... fallback raw`
degradation. Recall that any `parse` target degrades to raw in v1.0.

```
# Length-delimited frame with varint length (synthetic sample)
# DSL spec: https://github.com/tiengong0x00/serial-pilot/blob/main/docs/protocol-dsl-spec-v1.0.md

endian be
root Envelope

struct Envelope {
  header:  bitfield(8) {
    msg_type: 7:4
    qos:      3:2
    reserved: 1:0
  }
  body_len: varint(4)
  body:     bytes[body_len] parse tlv fallback raw
  trailer:  bytes[rest] hex
}
```

The `body` field always produces a `{ len, data }` node with a warning that the
`tlv` sub-parser is not implemented; `trailer` then captures whatever remains.

---

## 9. Scope and Limitations

### 9.1 Supported

- Binary field layout, bitfields, encoding modifiers.
- Conditional fields, repeated arrays, struct matching.
- Length references, fixed-value checks, degradation to raw.

### 9.2 Not Covered

- Text protocols (HTTP, etc.) — use a dedicated path.
- Checksum computation (CRC / SUM) — a checksum is only displayed as a field.
- Streaming framing — input is assumed to be one complete message.
- Self-describing recursive formats (TLV, LwM2M) — not parsed in v1.0; fields
  that target them degrade to raw.

---

## 10. Versioning

- Current version: `v1.0`.
- Later versions should stay **backward compatible**:
  - new keywords do not collide with existing identifiers,
  - new modifiers do not change the meaning of existing fields,
  - deprecations go through at least one transition version.

---

## Appendix A — Output Contract

The interpreter produces a `ParseResult` for tree / hexdump linkage:

```
ParseResult {
  root:          ParsedNode[]      // top-level nodes
  byteOwner:     (string | null)[] // per-byte owning node id
  totalBytes:    number
  bytesConsumed: number
  remaining:     number[]          // trailing unconsumed bytes
  errors:        string[]
}

ParsedNode {
  id, name
  byteStart, byteEnd                // byte range [start, end)
  bitOffset?, bitLen?               // set for bitfield sub-fields
  typeLabel                         // e.g. "u8 enum", "bitfield(8)"
  rawHex
  value                             // display value
  meaning?                          // enum label
  warning?                          // fixed-value / BCD / degradation notice
  error?
  isGroup?, children?               // groups: struct, array, bitfield, match
}
```

## Appendix B — Reserved Words

```
be  le
endian  root  struct  enum  match  if  parse  fallback
and  or  not  true  false  _
rest
u8  u16  u32  u64
i8  i16  i32  i64
f32  f64
bytes  varint  bitfield
bcd  ascii  hex
```

## Appendix C — Operator Precedence

Highest to lowest:

```
1.  ( )                  grouping
2.  * / %                multiplicative
3.  + -                  additive
4.  == != < > <= >=      comparison
5.  not                  logical not
6.  and                  logical and
7.  or                   logical or
```

---

**End of specification**











