# Test Case Format Specification

This directory stores automated test case JSON files. Each file represents a complete test scenario.

---

## 1. File Format Overview

Each `.json` file contains a root case, which can nest sub-cases and commands in a tree structure.

**Basic structure:**

```json
{
  "version": "2.0",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "rootCase": {
    "id": "case_demo_root",
    "name": "Test Scenario Name",
    "targetPort": "P1",
    "runCount": 1,
    "onFailure": "abort",
    "selected": true,
    "isExpanded": true,
    "status": "pending",
    "children": [ /* commands or sub-cases */ ]
  }
}
```

---

## 2. Field Details

> **Fill only the key parameters.** On import the app auto-fills defaults for missing fields, so when hand-writing / AI-generating JSON you usually only need the ✅ fields; the rest can be omitted (omission = the "Default" shown below).
> These are also **overwritten even if you set them**, so don't bother: `id` (auto-reassigned on import to avoid collisions), `status` (auto-reset to `"pending"`), `selected` (auto-unchecked on import — you re-check what to run in the UI).

### Root-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `string` | ✅ | Format version, currently fixed at `"2.0"` |
| `createdAt` | `string` | ❌ | ISO 8601 timestamp (optional) |
| `rootCase` | `object` | ✅ | Root case object (must include `targetPort`) |

### Root case (rootCase) fields

| Field | Type | Required | Description | Range / Default |
|-------|------|----------|-------------|-----------------|
| `id` | `string` | ❌ | Unique identifier (auto-reassigned on import, can omit) | Suggested format: `case_<timestamp>_<random>` |
| `name` | `string` | ✅ | Case name (recommended; omit → `"Unnamed Case"`) | Any string |
| `description` | `string` | ❌ | Case description (optional) | - |
| `targetPort` | `string` | ❌ | **Target port** (root case only; recommended to set explicitly) | `"P1"` / `"P2"`, default `"P1"` |
| `runCount` | `number` | ❌ | Loop count | `≥1` (normal loop), `0` (infinite loop, manual stop required), default `1` |
| `onFailure` | `string` | ❌ | Failure strategy (enum) | `"continue"` / `"end-round"` / `"retry-self"` / `"abort"`, default `"abort"` |
| `maxSelfRetries` | `number` | ❌ | Retry limit for `retry-self` | Default `1`, falls back to `continue` when exhausted |
| `selected` | `boolean` | ❌ | Whether to execute (auto-unchecked on import, can omit) | `true` / `false` |
| `isExpanded` | `boolean` | ❌ | UI expand state | `true` / `false`, default `true` |
| `status` | `string` | ❌ | Execution status (auto-reset on import, can omit) | `"pending"` / `"running"` / `"success"` / `"failed"` / `"interrupted"` / `"skipped"` |
| `children` | `array` | ✅ | Child array (commands or sub-cases) | At least 1 child |

**targetPort explanation:**
- `"P1"` — First connected serial port (**recommended**)
- `"P2"` — Second connected serial port
- Must be specified in the root case (rootCase); sub-cases inherit this value

**onFailure strategy:**
- `continue` — Skip failure, proceed to next sibling
- `end-round` — End current round (enter next round if parent has loop; otherwise end this case)
- `retry-self` — Re-execute this case (limited by `maxSelfRetries`, cases only)
- `abort` — Interrupt entire test

### Sub-case fields

Sub-cases have the same fields as root case, **but no `targetPort`** (inherits from parent).

---

## 3. Command Types

The `children` array can contain two command types:

### 3.1 Standard Command (type="command")

Send AT command and wait for response.

| Field | Type | Required | Description | Range / Default |
|-------|------|----------|-------------|-----------------|
| `id` | `string` | ❌ | Unique identifier (auto-reassigned on import, can omit) | Suggested: `cmd_<timestamp>_<random>` |
| `type` | `string` | ✅ | Command type (omit → treated as `"command"`) | `"command"` |
| `name` | `string` | ❌ | Command display name | - |
| `description` | `string` | ❌ | Command description | - |
| `content` | `string` | ✅ | **Command content** (supports variable substitution) | See "Variable Syntax" section |
| `dataFormat` | `string` | ❌ | Data format | `"utf8"` / `"hex"`, default `"utf8"` |
| `lineEnding` | `string` | ❌ | Line ending | `"none"` / `"lf"` / `"cr"` / `"crlf"`, default `"crlf"` |
| `preDelay` | `number` | ❌ | Pre-send delay (ms) | `≥0`, default `0` |
| `postDelay` | `number` | ❌ | Post-success delay (ms) | `≥0`, default `0` |
| `selected` | `boolean` | ❌ | Whether to execute (auto-unchecked on import, can omit) | `true` / `false` |
| `status` | `string` | ❌ | Execution status (auto-reset on import, can omit) | Same as case `status` |
| **Repeat Strategy** | | | | |
| `repeatCount` | `number` | ❌ | Send count | `≥1` (`1` = no repeat), default `1` |
| `successThreshold` | `number` | ❌ | Required success count | `≤ repeatCount`, default `1` |
| `stopWhenReached` | `boolean` | ❌ | Stop immediately on threshold | `true` (stop on success) / `false` (send full repeatCount), default `true` |
| `attemptInterval` | `number` | ❌ | Retry interval (ms) | `≥0`, default `1000` |
| **Response Validation** | | | | |
| `timeout` | `number` | ❌ | Single wait timeout (ms) | `≥0`, default `2000`, ignored when `validation="none"` |
| `validation` | `string` | ❌ | Validation type | `"none"` / `"standard"` / `"custom"`, default `"standard"` |
| `validationPattern` | `string` | ❌ | Validation pattern (required for `custom`) | Regex or string |
| `validationMode` | `string` | ❌ | Match mode (required for `custom`) | `"contains"` / `"exact"` / `"regex"` / `"startsWith"` / `"endsWith"` |
| **Variable Extraction** | | | | |
| `extractConfig` | `object` | ❌ | Extraction config (optional) | See "Variable Extraction" section |
| **Failure Handling** | | | | |
| `onFailure` | `string` | ❌ | Failure strategy | `"continue"` / `"end-round"` / `"abort"` (commands don't support `retry-self`), default `"abort"` |
| **File Send** | | | | |
| `fileData` | `object` | ❌ | File data (optional) | `{ name, size, base64 }` |

**validation types:**
- `none` — Success immediately after send, no response wait
- `standard` — Standard AT validation (pass if response contains `OK`)
- `custom` — Custom pattern match (requires `validationPattern` and `validationMode`)

**validationMode:**
- `contains` — Response contains specified string
- `exact` — Response exactly matches
- `regex` — Regex match
- `startsWith` — Response starts with string
- `endsWith` — Response ends with string

### 3.2 URC Background Guard (type="urc-guard")

Monitor unsolicited result codes from device and trigger actions.

| Field | Type | Required | Description | Range / Default |
|-------|------|----------|-------------|-----------------|
| `id` | `string` | ❌ | Unique identifier (auto-reassigned on import, can omit) | - |
| `type` | `string` | ✅ | Command type (fixed) | `"urc-guard"` |
| `name` | `string` | ❌ | Guard name | - |
| `description` | `string` | ❌ | Guard description | - |
| `content` | `string` | ❌ | No meaning (legacy compat, leave empty) | `""` |
| `dataFormat` | `string` | ❌ | Fixed | `"utf8"` |
| `lineEnding` | `string` | ❌ | Fixed | `"none"` |
| `preDelay` | `number` | ❌ | Fixed | `0` |
| `postDelay` | `number` | ❌ | Fixed | `0` |
| `selected` | `boolean` | ❌ | Whether to execute (auto-unchecked on import, can omit) | `true` / `false` |
| `status` | `string` | ❌ | Execution status (auto-reset on import, can omit) | - |
| **Guard Config** | | | | |
| `pattern` | `string` | ✅ | Match pattern | Regex or string |
| `matchMode` | `string` | ❌ | Match mode | Same as standard command `validationMode`, default `"contains"` |
| `scope` | `string` | ❌ | Scope | `"root"` / `"case"`, default `"case"` |
| `action` | `string` | ❌ | Action on match | `"restart-round"` / `"abort"` / `"fail-current"` / `"capture-only"` / `"log-only"`, default `"fail-current"` |
| `rearm` | `string` | ❌ | Behavior after trigger | `"once"` / `"continuous"`, default `"continuous"` |
| `extractConfig` | `object` | ❌ | Extraction config (optional) | - |

**scope:**
- `root` — Global scope (active during entire test)
- `case` — Case scope (active only while owning case executes)

**action:**
- `restart-round` — Restart current round
- `abort` — Interrupt entire test
- `fail-current` — Mark current node as failed
- `capture-only` — Extract variables only, no execution impact
- `log-only` — Log only

**rearm:**
- `once` — Stop listening after one trigger
- `continuous` — Keep listening (trigger on every match)

---

## 4. Variable Extraction and Substitution

### 4.1 Variable Extraction (extractConfig)

Extract data from command response into variable pool for use by subsequent commands.

```json
"extractConfig": {
  "enabled": true,
  "parseType": "regex",
  "parsePattern": "\\+CSQ:\\s*(\\d+),(\\d+)",
  "parameterMap": {
    "rssi": "1",
    "ber": "2"
  }
}
```

| Field | Type | Required | Description | Range |
|-------|------|----------|-------------|-------|
| `enabled` | `boolean` | ✅ | Enable extraction | `true` / `false` |
| `parseType` | `string` | ✅ | Parse method | `"regex"` / `"split"` |
| `parsePattern` | `string` | ✅ | Regex or delimiter | `regex`: regex pattern<br>`split`: delimiter string |
| `parameterMap` | `object` | ✅ | Variable mapping | `{ "varName": "capture group or split index" }` |

**parseType:**
- `regex` — Match with regex, `parameterMap` values are capture group indices (`"1"`, `"2"`, ...)
- `split` — Split by delimiter, `parameterMap` values are split indices (`"0"`, `"1"`, ...)

### 4.2 Variable Substitution

Command content (`content`) supports the following variable syntax:

| Syntax | Description | Example |
|--------|-------------|---------|
| `${varName}` | Extracted variable (from response) | `AT+CMD=${token}` |
| `${rand:str:N}` | Generate N random visible chars | `${rand:str:8}` → `A3kF9pQz` |
| `${rand:hex:N}` | Generate N random bytes, output 2N uppercase HEX chars | `${rand:hex:4}` → `3FA8B21C` (4 bytes = 8 hex) |

**Example:**

```json
{
  "content": "AT+AUTH=${token},${rand:hex:8}",
  ...
}
```

If `token` variable value is `abc123`, actual send content might be:

```
AT+AUTH=abc123,4F9A2E1B3C7D6A8F
```

**Dynamic length:** Variable substitution is dict-first then function, so length params can use extracted vars:

```json
{
  "content": "${rand:hex:${len}}"
}
```

If `len=4`, first replaces to `${rand:hex:4}`, then generates 8 hex chars.

---

## 5. Complete Examples

### Example 0: Minimal (only key params, rest use defaults)

On import the app auto-fills `dataFormat`/`lineEnding`/`repeatCount`/`timeout`/`validation`/`onFailure`, etc.:

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "Minimal AT Test",
    "targetPort": "P1",
    "children": [
      { "type": "command", "name": "AT Handshake", "content": "AT" }
    ]
  }
}
```

The command above is equivalent to: send `AT` once (CRLF ending), standard validation (pass if response contains `OK`), 2000ms timeout, abort on failure. Write out a field explicitly only when you need to override it.

### Example 1: Basic AT Handshake (full fields)

```json
{
  "version": "2.0",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "rootCase": {
    "id": "case_basic",
    "name": "Basic AT Test",
    "targetPort": "P1",
    "runCount": 1,
    "onFailure": "abort",
    "selected": true,
    "isExpanded": true,
    "status": "pending",
    "children": [
      {
        "id": "cmd_at",
        "type": "command",
        "name": "AT Handshake",
        "content": "AT",
        "dataFormat": "utf8",
        "lineEnding": "crlf",
        "preDelay": 0,
        "postDelay": 100,
        "selected": true,
        "status": "pending",
        "repeatCount": 3,
        "successThreshold": 1,
        "stopWhenReached": true,
        "attemptInterval": 500,
        "timeout": 2000,
        "validation": "standard",
        "onFailure": "abort"
      }
    ]
  }
}
```

### Example 2: Variable Extraction and Substitution

```json
{
  "version": "2.0",
  "rootCase": {
    "id": "case_extract",
    "name": "Variable Extract and Substitute",
    "targetPort": "P1",
    "runCount": 1,
    "onFailure": "abort",
    "selected": true,
    "isExpanded": true,
    "status": "pending",
    "children": [
      {
        "id": "cmd_csq",
        "type": "command",
        "name": "Query Signal",
        "content": "AT+CSQ",
        "dataFormat": "utf8",
        "lineEnding": "crlf",
        "preDelay": 0,
        "postDelay": 0,
        "selected": true,
        "status": "pending",
        "repeatCount": 1,
        "successThreshold": 1,
        "stopWhenReached": true,
        "attemptInterval": 1000,
        "timeout": 3000,
        "validation": "custom",
        "validationPattern": "\\+CSQ:",
        "validationMode": "regex",
        "extractConfig": {
          "enabled": true,
          "parseType": "regex",
          "parsePattern": "\\+CSQ:\\s*(\\d+),(\\d+)",
          "parameterMap": {
            "rssi": "1",
            "ber": "2"
          }
        },
        "onFailure": "abort"
      },
      {
        "id": "cmd_log_rssi",
        "type": "command",
        "name": "Log RSSI Value",
        "content": "AT+LOG=RSSI,${rssi}",
        "dataFormat": "utf8",
        "lineEnding": "crlf",
        "preDelay": 0,
        "postDelay": 0,
        "selected": true,
        "status": "pending",
        "repeatCount": 1,
        "successThreshold": 1,
        "stopWhenReached": true,
        "attemptInterval": 1000,
        "timeout": 2000,
        "validation": "standard",
        "onFailure": "continue"
      }
    ]
  }
}
```

### Example 3: URC Guard + Nested Sub-case

```json
{
  "version": "2.0",
  "rootCase": {
    "id": "case_network",
    "name": "Network Registration with Guard",
    "targetPort": "P1",
    "runCount": 1,
    "onFailure": "abort",
    "selected": true,
    "isExpanded": true,
    "status": "pending",
    "children": [
      {
        "id": "case_sub",
        "name": "Registration Sub-Case",
        "runCount": 1,
        "onFailure": "end-round",
        "maxSelfRetries": 2,
        "selected": true,
        "isExpanded": true,
        "status": "pending",
        "children": [
          {
            "id": "guard_dereg",
            "type": "urc-guard",
            "name": "Deregistration Guard",
            "description": "Restart round on +CREG: 0",
            "content": "",
            "dataFormat": "utf8",
            "lineEnding": "none",
            "preDelay": 0,
            "postDelay": 0,
            "selected": true,
            "status": "pending",
            "pattern": "+CREG: 0",
            "matchMode": "contains",
            "scope": "case",
            "action": "restart-round",
            "rearm": "continuous"
          },
          {
            "id": "cmd_creg",
            "type": "command",
            "name": "Wait for Registration",
            "content": "AT+CREG=1",
            "dataFormat": "utf8",
            "lineEnding": "crlf",
            "preDelay": 0,
            "postDelay": 0,
            "selected": true,
            "status": "pending",
            "repeatCount": 1,
            "successThreshold": 1,
            "stopWhenReached": true,
            "attemptInterval": 1000,
            "timeout": 15000,
            "validation": "custom",
            "validationPattern": "\\+CREG:\\s*[15]",
            "validationMode": "regex",
            "onFailure": "end-round"
          }
        ]
      }
    ]
  }
}
```

---

## 6. FAQ

### Q1: Does root case require targetPort?

**A:** Not strictly. It defaults to `"P1"` when omitted, but **explicitly setting** `targetPort` (`"P1"` or `"P2"`) in the root case is recommended to avoid ambiguity. Sub-cases inherit this value.

### Q2: How to prevent command failure from affecting subsequent execution?

**A:** Set `onFailure: "continue"`. The command will be skipped on failure and execution continues to the next sibling.

### Q3: Difference between repeatCount and successThreshold?

**A:** 
- `repeatCount`: Max send attempts (e.g. `3` = send up to 3 times)
- `successThreshold`: Required success count (e.g. `1` = at least 1 success)
- `stopWhenReached`: Stop immediately on threshold (`true` = stop after 1 success; `false` = send all 3 attempts)

### Q4: Relationship between validation="none" and timeout?

**A:** When `validation="none"`, command succeeds immediately after send with no response wait. The `timeout` field is ignored.

### Q5: Choose root or case for URC guard scope?

**A:**
- `root` — Guard active during entire test (e.g. monitor module restart, network loss)
- `case` — Guard active only during owning case (e.g. monitor specific phase anomalies)

### Q6: How to debug regex patterns?

**A:** 
- Use the "Regex Tester" tool in the toolbox: input response text and regex, instantly view match results and capture groups
- Online tool: <https://regex101.com/> (select JavaScript flavor)

### Q7: Does extraction failure cause errors?

**A:** No. On extraction failure, variable value is empty string, no impact on command execution. Recommend validating response format in `validationPattern` first to ensure extraction success.

### Q8: How to implement "send 10 times, at least 8 successes"?

**A:** Set `repeatCount: 10`, `successThreshold: 8`, `stopWhenReached: false`.

---

## 7. Generating Test Cases with AI

Provide this document along with your test requirements (manual, flowchart, text description) to an AI, using this prompt:

```
Based on the attached test requirements and the format spec in testcases/README_EN.md,
generate a JSON test case file. Requirements:
1. Strictly follow field types and enum values
2. rootCase must include targetPort field ("P1" or "P2")
3. All commands must specify type field ("command" or "urc-guard")
4. validation and onFailure must use enum values listed in the spec
5. Add description for key commands to explain intent
6. Output complete JSON that can be saved directly as a .json file
```

**Post-generation checklist:**
- ✅ Is `version` set to `"2.0"`?
- ✅ Does `rootCase.targetPort` exist and equal `"P1"` or `"P2"`?
- ✅ Do all commands include `type` field?
- ✅ Are enum fields like `validation` / `onFailure` / `matchMode` valid?
- ✅ When `validation="custom"`, are `validationPattern` and `validationMode` specified?
- ✅ Is JSON syntax valid? (verify at <https://jsonlint.com/>)

---

## 8. Technical Notes

- **Execution model**: Recursive tree traversal, no program counter, no flattening, no jumps (v1 model)
- **State management**: Each node maintains independent `status`; parent updates based on child states
- **Variable scope**: Global variable pool; all extracted variables shared across entire test
- **Concurrency**: Only one command executes at a time; URC guards listen asynchronously in background
- **Backward compatibility**: Old version (`version: "1.0"`) files auto-migrate to v2 format on import

---

**Related files:**
- [Command Library Format Specification](../commands/README_EN.md)
- [中文版](./README.md)
