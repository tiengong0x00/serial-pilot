# Test Case Format Specification

This directory stores automated test case JSON files. Each file represents a complete test scenario with support for tree nesting, variable extraction, loops, and retries.

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [File Structure](#file-structure)
3. [Field Reference](#field-reference)
4. [Command Types](#command-types)
5. [Variable System](#variable-system)
6. [Failure Strategies](#failure-strategies)
7. [Complete Examples](#complete-examples)
8. [FAQ](#faq)

---

## 🚀 Quick Start

### Minimal Example

Fill only the key fields, defaults will be applied automatically:

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "Basic AT Test",
    "children": [
      {
        "type": "command",
        "name": "AT Handshake",
        "content": "AT"
      }
    ]
  }
}
```

**Auto-filled defaults:**
- Data format: UTF-8, Line ending: CRLF
- Repeat count: 1, Timeout: 2000ms
- Validation: Standard (response contains OK)
- Failure strategy: Abort test

### Adding Your Own Test Cases

1. **Copy example file** - Start from `demo.json`
2. **Modify case name and commands** - Adjust the `content` field as needed
3. **Adjust parameters** (optional) - Modify timeout, retry count, etc.
4. **Save and import** - Load the file in the application

---

## 📦 File Structure

```
test-case.json
├── version          # Format version (fixed "2.0")
├── createdAt        # Creation time (optional)
└── rootCase         # Root case
    ├── name         # Case name
    ├── targetPort   # Target port (omit = auto)
    ├── runCount     # Loop count
    ├── onFailure    # Failure strategy
    └── children     # Child array
        ├── Command 1   # type="command"
        ├── Guard       # type="urc-guard"
        └── Sub-case    # Nested case
```

**Hierarchy:**
- **Root Case**: Top level, defines target port and global strategy
- **Sub-cases**: Can nest multiple levels for modular testing
- **Commands**: Actual AT commands to send
- **Guards**: Background monitors for URC reports

---

## 📖 Field Reference

### Root-level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `string` | ✅ | Format version, fixed at `"2.0"` |
| `createdAt` | `string` | ❌ | ISO 8601 timestamp (optional) |
| `rootCase` | `object` | ✅ | Root case object |

### Case Fields (rootCase / Sub-case)

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| **Basic Info** ||||
| `name` | `string` | Case name | `"Unnamed Case"` |
| `description` | `string` | Case description | - |
| `targetPort` | `string` | Target port (root only) | Auto |
| **Execution Control** ||||
| `runCount` | `number` | Loop count (0=infinite) | `1` |
| `onFailure` | `string` | Failure strategy | `"abort"` |
| `maxSelfRetries` | `number` | Retry limit for `retry-self` | `1` |
| **UI State** ||||
| `selected` | `boolean` | Whether to execute | `false` |
| `isExpanded` | `boolean` | Whether expanded | `true` |
| `status` | `string` | Execution status | `"pending"` |
| **Children** ||||
| `children` | `array` | Commands or sub-cases | Required |

#### targetPort Explanation

- **Omit or leave empty** (recommended) - Auto mode:
  - Single port: Use the connected port
  - Dual port: Follow send area selection (P1/P2/ALL)
- **`"P1"`** - Pin to first serial port
- **`"P2"`** - Pin to second serial port

> 💡 **Recommendation**: Omit this field unless you need to pin a specific port

---

## 🔧 Command Types

### 1. Standard Command (type="command")

Send AT commands and wait for responses.

#### Basic Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `type` | `string` | Command type | `"command"` |
| `name` | `string` | Command name | - |
| `content` | `string` | Command content (supports variables) | Required |
| `dataFormat` | `string` | Data format | `"utf8"` |
| `lineEnding` | `string` | Line ending | `"crlf"` |
| `delay` | `number` | Delay in ms | `0` |

**dataFormat options:** `"utf8"` | `"hex"`  
**lineEnding options:** `"none"` | `"lf"` | `"cr"` | `"crlf"`

#### Repeat Sending

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `repeatCount` | `number` | Max send attempts | `1` |
| `successThreshold` | `number` | Required successes | `1` |
| `stopWhenReached` | `boolean` | Stop when threshold met | `true` |

**Example:** "Send 10 times, need at least 8 successes"
```json
{
  "repeatCount": 10,
  "successThreshold": 8,
  "stopWhenReached": false
}
```

#### Response Validation

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `timeout` | `number` | Wait timeout (ms) | `2000` |
| `validation` | `string` | Validation type | `"standard"` |
| `validationPattern` | `string` | Pattern (required for custom) | - |
| `validationMode` | `string` | Match mode (required for custom) | - |

**validation Types:**

| Type | Description | Use Case |
|------|-------------|----------|
| `"none"` | Succeed immediately after send | Commands with no response |
| `"standard"` | Response contains `OK` | Standard AT commands |
| `"custom"` | Custom pattern matching | Special response formats |

**validationMode Options:**

| Mode | Description | Example |
|------|-------------|---------|
| `"contains"` | Contains string | Response has `+CSQ:` |
| `"exact"` | Exact match | Response equals `OK` |
| `"regex"` | Regular expression | Matches `\+CSQ:\s*\d+` |
| `"startsWith"` | Starts with | Response starts with `AT+` |
| `"endsWith"` | Ends with | Response ends with `OK` |

#### File Sending

Commands can attach files for sending (certificates, firmware, config files, etc.).

| Field | Type | Description |
|-------|------|-------------|
| `fileData` | `object` | File data `{ id, name, size }` |

**File Storage Rules:**

Files must be placed in a subdirectory with the same name as the test case:
```
testcases/
├── https-test.json          # Test case file
└── https-test/              # Same-name directory
    ├── ca-cert.pem         # Certificate file
    └── config.txt          # Config file
```

**Referencing Files in Test Cases:**

```json
{
  "type": "command",
  "name": "Upload CA Certificate",
  "content": "AT+QSSLCFG=\"cacert\",2",
  "fileData": {
    "id": "https-test/ca-cert.pem",
    "name": "ca-cert.pem",
    "size": 1234
  },
  "validation": "standard"
}
```

**Field Descriptions:**
- `id` - Relative path format: `"case-name/filename"` (case name without `.json` extension)
- `name` - Filename (for display)
- `size` - File size (in bytes)

**Complete Example: HTTPS Certificate Configuration**

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "HTTPS Certificate Setup",
    "children": [
      {
        "type": "command",
        "name": "Configure SSL Version",
        "content": "AT+QSSLCFG=\"sslversion\",2,4"
      },
      {
        "type": "command",
        "name": "Prepare CA Certificate Upload",
        "content": "AT+QSSLCFG=\"cacert\",2",
        "timeout": 2000
      },
      {
        "type": "command",
        "name": "Send CA Certificate File",
        "content": "",
        "fileData": {
          "id": "https-cert/ca-cert.pem",
          "name": "ca-cert.pem",
          "size": 1456
        },
        "timeout": 5000
      },
      {
        "type": "command",
        "name": "Prepare Client Certificate Upload",
        "content": "AT+QSSLCFG=\"clientcert\",2",
        "timeout": 2000
      },
      {
        "type": "command",
        "name": "Send Client Certificate File",
        "content": "",
        "fileData": {
          "id": "https-cert/client-cert.pem",
          "name": "client-cert.pem",
          "size": 1234
        },
        "timeout": 5000
      },
      {
        "type": "command",
        "name": "Prepare Client Key Upload",
        "content": "AT+QSSLCFG=\"clientkey\",2",
        "timeout": 2000
      },
      {
        "type": "command",
        "name": "Send Client Key File",
        "content": "",
        "fileData": {
          "id": "https-cert/client-key.pem",
          "name": "client-key.pem",
          "size": 1678
        },
        "timeout": 5000
      },
      {
        "type": "command",
        "name": "Enable Certificate Verification",
        "content": "AT+QSSLCFG=\"seclevel\",2,2"
      }
    ]
  }
}
```

**File Sending Flow:**

File sending uses a **two-step pattern**:
1. **Prepare command** - Send AT command to notify device (`content` has value, no `fileData`)
2. **File command** - Send actual file (`content` is empty, has `fileData`)

**Example Flow:**
```
Step 1: Send "AT+QSSLCFG=\"cacert\",2"  ← Tell device to prepare for certificate
Step 2: Send file ca-cert.pem           ← Actually send certificate content
```

**AI Generation with File Sending:**

When generating test cases with file sending, use this prompt:

```
Generate test case with file sending. File placement rules:
1. Case file name: <case-name>.json
2. Attachment directory: testcases/<case-name>/
3. Reference in command via fileData:
   {
     "fileData": {
       "id": "<case-name>/<filename>",
       "name": "<filename>",
       "size": <estimated-bytes>
     }
   }
4. Files need to be manually prepared by user
5. Use two-step pattern: prepare command + file command
```

**Important Notes:**
- ⚠️ **Files need manual preparation** - AI only generates JSON, actual files need user preparation
- ✅ **Naming convention** - Case name and attachment directory must match (without `.json` extension)
- ✅ **size field** - Can use estimated value, doesn't affect sending
- ✅ **Import in app** - Drag and drop files to command editor to auto-generate `fileData`
- ✅ **Two-step pattern** - Always separate prepare command from file command

---

### 2. URC Guard (type="urc-guard")

Background monitor for device Unsolicited Result Codes.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `type` | `string` | Fixed `"urc-guard"` | Required |
| `pattern` | `string` | Match pattern (regex or string) | Required |
| `matchMode` | `string` | Match mode | `"contains"` |
| `scope` | `string` | Scope | `"case"` |
| `action` | `string` | Action on trigger | `"fail-current"` |
| `rearm` | `string` | Behavior after trigger | `"continuous"` |

#### scope

- **`"root"`** - Global guard (active throughout entire test)
- **`"case"`** - Case guard (active only during case execution)

#### action

| Action | Description | Use Case |
|--------|-------------|----------|
| `"restart-round"` | Restart current round | Detected anomaly needs retry |
| `"abort"` | Abort entire test | Fatal error |
| `"fail-current"` | Mark current node failed | Warning error |
| `"capture-only"` | Only extract variables | Data collection |
| `"log-only"` | Only log | Debug info |

#### rearm

- **`"once"`** - Trigger once then stop
- **`"continuous"`** - Keep monitoring (trigger every match)

---

## 🔄 Variable System

### Variable Extraction

Extract data from command responses for use in subsequent commands.

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

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Enable extraction |
| `parseType` | `string` | `"regex"` or `"split"` |
| `parsePattern` | `string` | Regex pattern or delimiter |
| `parameterMap` | `object` | Variable mapping `{"var": "group-index"}` |

**parseType Comparison:**

| Type | Description | Example |
|------|-------------|---------|
| `"regex"` | Regex match, capture group index | `"1"`, `"2"` |
| `"split"` | Delimiter split, fragment index | `"0"`, `"1"` |

### Variable Substitution

Use variables in command `content`:

| Syntax | Description | Example | Result |
|--------|-------------|---------|--------|
| `${varName}` | Extracted variable | `AT+AUTH=${token}` | `AT+AUTH=abc123` |
| `${rand:str:N}` | N random chars | `${rand:str:8}` | `A3kF9pQz` |
| `${rand:hex:N}` | N bytes random HEX | `${rand:hex:4}` | `3FA8B21C` |
| `${seq:start:step}` | Sequence generator | `${seq:60:20}` | 60→80→100... |
| `${seq:start:step:max}` | Capped sequence | `${seq:10:5:30}` | 10→15→...→30 |

#### Sequence Generator Features

- **Reset per round** - Auto-reset to initial value each loop iteration
- **Independent counters** - Different parameter combinations don't interfere
- **Supports negatives** - `${seq:100:-10}` for decrement (100→90→80...)
- **Max cap** - Stays at max once reached

**Practical Use:**

```json
{
  "content": "AT+TIMEOUT=${seq:60:20}",
  "repeatCount": 5
}
```

Send sequence: `AT+TIMEOUT=60` → `80` → `100` → `120` → `140`

---

## ⚠️ Failure Strategies

### onFailure Strategy Table

| Strategy | Description | Applies To |
|----------|-------------|------------|
| `"continue"` | Skip failure, continue next | Case, Command |
| `"end-round"` | End round, enter next round | Case, Command |
| `"retry-self"` | Re-execute this case | Case only |
| `"abort"` | Abort entire test | Case, Command |

### Strategy Details

#### continue - Skip Failure

```
CommandA [fail] → skip → CommandB [execute]
```

Use case: Optional steps, non-blocking commands

#### end-round - End Current Round

```
[Round 1] CommandA → CommandB [fail] → end round
[Round 2] CommandA → CommandB → ...
```

Use case: Parent has loop, failure triggers next iteration

#### retry-self - Retry Case

```
CaseA
  ├─ Command1
  ├─ Command2 [fail]
  └─ Trigger retry → Re-execute CaseA (max maxSelfRetries times)
```

Use case: Network registration, connection establishment

#### abort - Abort Test

```
CommandA → CommandB [fail] → abort test [stop]
```

Use case: Fatal error, prerequisite failure

---

## 📝 Complete Examples

### Example 1: Signal Quality Query & Extract

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "Signal Quality Query",
    "children": [
      {
        "type": "command",
        "name": "Query Signal",
        "content": "AT+CSQ",
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
        }
      },
      {
        "type": "command",
        "name": "Log Signal Values",
        "content": "AT+LOG=RSSI:${rssi},BER:${ber}",
        "validation": "standard"
      }
    ]
  }
}
```

### Example 2: Network Registration Guard

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "Network Registration Test",
    "children": [
      {
        "id": "case_registration",
        "name": "Registration Sub-case",
        "runCount": 3,
        "onFailure": "retry-self",
        "maxSelfRetries": 2,
        "children": [
          {
            "type": "urc-guard",
            "name": "Deregistration Guard",
            "pattern": "+CREG: 0",
            "matchMode": "contains",
            "scope": "case",
            "action": "restart-round",
            "rearm": "continuous"
          },
          {
            "type": "command",
            "name": "Wait for Registration",
            "content": "AT+CREG?",
            "timeout": 15000,
            "validation": "custom",
            "validationPattern": "\\+CREG:\\s*0,[15]",
            "validationMode": "regex"
          }
        ]
      }
    ]
  }
}
```

### Example 3: HTTP Timeout Sweep

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "HTTP Timeout Sweep",
    "description": "Test timeout parameters 60-140 seconds",
    "children": [
      {
        "type": "command",
        "name": "HTTP GET Request",
        "content": "AT+HTTPGET=http://example.com,${seq:60:20:140}",
        "repeatCount": 5,
        "timeout": 150000,
        "validation": "custom",
        "validationPattern": "\\+HTTPGET:\\s*200",
        "validationMode": "regex",
        "onFailure": "continue"
      }
    ]
  }
}
```

### Example 4: Stability Test (Infinite Loop)

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "AT Stability Test",
    "runCount": 0,
    "onFailure": "continue",
    "children": [
      {
        "type": "command",
        "name": "AT Handshake",
        "content": "AT",
        "repeatCount": 10,
        "successThreshold": 9,
        "stopWhenReached": false,
        "delay": 100
      }
    ]
  }
}
```

---

## ❓ FAQ

### Q1: What are the required fields?

**A:** Minimum 3 fields:
```json
{
  "version": "2.0",
  "rootCase": {
    "name": "Case Name",
    "children": [
      { "type": "command", "content": "AT" }
    ]
  }
}
```

### Q2: What should I fill for targetPort?

**A:** **Recommend omit** (auto mode). Only fill `"P1"` or `"P2"` when you need to pin a specific port.

### Q3: How to continue after command failure?

**A:** Set `"onFailure": "continue"`.

### Q4: What's validation="none" for?

**A:** Succeed immediately after send, no wait for response. Use for:
- Config commands (don't care about response)
- Continuous send scenarios (no confirmation needed)

### Q5: How to debug regex?

**A:** 
- **Toolbox** → "Regex Match Validator" - Real-time testing
- Online tool: https://regex101.com/ (select JavaScript)

### Q6: Does variable extraction fail with error?

**A:** No error. Variable value is empty string on extraction failure. Recommend validating response format with `validationPattern` first.

### Q7: When does sequence generator reset?

**A:** Auto-reset to initial value at the start of each round (each `runCount` iteration).

### Q8: How to implement conditional jumps?

**A:** This system doesn't support jumps. Alternatives:
- Use `onFailure: "continue"` to skip failed steps
- Nest sub-cases for branching logic
- Use URC guards for exception handling

---

## 🤖 AI-Generated Test Cases

### Prompt Template

```
Generate a JSON test case based on the following requirements and the testcases/README_EN.md format specification:

Requirements:
[Paste your test requirements, manual, or flowchart]

Requirements:
1. Strictly follow field types and enum values
2. Omit targetPort (use auto mode)
3. Add description for key commands
4. Output complete JSON, ready to save
5. For file sending, use two-step pattern (prepare + file)
```

### Post-Generation Checklist

- ✅ `version` is `"2.0"`
- ✅ `rootCase.targetPort` omitted or is `"P1"`/`"P2"`
- ✅ All commands have `type` field
- ✅ Enum field values are valid (`validation`/`onFailure`/`matchMode` etc.)
- ✅ `validation="custom"` has `validationPattern` and `validationMode`
- ✅ JSON syntax correct (validate at https://jsonlint.com/)
- ✅ File sending uses two-step pattern (prepare command + file command)

---

## 📚 Related Documentation

- [Command Library Format](../commands/README_EN.md) - AT command library format
- [中文版文档](./README.md) - Chinese version

---

## 🔧 Technical Notes

**Execution Model:** Recursive tree traversal  
**State Management:** Each node maintains independent state  
**Variable Scope:** Global variable pool (shared throughout test)  
**Concurrency Control:** Only one command executes at a time  
**Backward Compatibility:** v1.0 format auto-migrates to v2.0

---

**Version:** 2.0  
**Last Updated:** 2026-09
