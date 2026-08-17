# Command Library Format Specification

This directory stores serial AT command library files, used for autocomplete and quick reference.

---

## 1. File Format Overview

Each `.json` file represents a command library. On startup, the app auto-loads all JSON files under `commands/`, merged in filename order (earlier files take priority; duplicate commands are skipped).

**Basic structure:**

```json
{
  "version": "1.0",
  "name": "Command Library Display Name",
  "commands": [
    {
      "command": "AT+CSQ",
      "category": "network",
      "description": "Query signal quality",
      "example": "AT+CSQ"
    }
  ]
}
```

---

## 2. Field Details

### Root-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `string` | ✅ | Format version, currently fixed at `"1.0"` |
| `name` | `string` | ✅ | Library name (for display, e.g. "General Commands") |
| `commands` | `array` | ✅ | Command list, at least 1 command |

### `commands` array element fields

| Field | Type | Required | Description | Example / Allowed values |
|-------|------|----------|-------------|--------------------------|
| `command` | `string` | ✅ | AT command syntax | `"AT"`, `"AT+CSQ"`, `"AT+CGDCONT=1,\"IP\",\"cmnet\""` |
| `category` | `string` | ✅ | Command category (customizable) | Any string; suggested: `"info"` / `"network"` / `"sim"` / `"call"` / `"sms"` / `"general"` |
| `description` | `string` | ✅ | Short description (1-2 sentences) | `"Query signal quality"` |
| `example` | `string` | ❌ | Usage example (optional) | `"AT+CFUN=1"` |

**`category` suggested values:**
- `info` — Device info (firmware version, IMEI)
- `network` — Network related (signal, registration, data connection)
- `sim` — SIM card operations (PIN, phonebook)
- `call` — Call control (dial, answer, hang up)
- `sms` — SMS operations (send, read, delete)
- `general` — General commands (AT handshake, echo, reset)

**Note:** `category` is a free-form string. You can define custom categories (e.g. `"mqtt"`, `"http"`, `"custom"`) as needed; the values above are just common suggestions.

---

## 3. Complete Examples

### Example 1: Basic command library

```json
{
  "version": "1.0",
  "name": "General Commands",
  "commands": [
    {
      "command": "AT",
      "category": "general",
      "description": "Test AT communication"
    },
    {
      "command": "ATE0",
      "category": "general",
      "description": "Disable command echo"
    },
    {
      "command": "AT+CFUN",
      "category": "general",
      "description": "Set functionality level",
      "example": "AT+CFUN=1"
    }
  ]
}
```

### Example 2: Network command library

```json
{
  "version": "1.0",
  "name": "Network Commands",
  "commands": [
    {
      "command": "AT+CSQ",
      "category": "network",
      "description": "Query signal quality"
    },
    {
      "command": "AT+CREG?",
      "category": "network",
      "description": "Query network registration status"
    },
    {
      "command": "AT+COPS",
      "category": "network",
      "description": "Operator selection",
      "example": "AT+COPS=0"
    }
  ]
}
```

---

## 4. FAQ

### Q1: Are there filename requirements?

**A:** No hard requirement, but `at-<category>.json` (e.g. `at-network.json`) is recommended. Filename alphabetical order affects dedup priority (earlier files win).

### Q2: Are commands case-sensitive?

**A:** No. Lookups are uppercased internally, but uppercase is recommended to match AT conventions.

### Q3: What if the same command appears in multiple files?

**A:** Sorted by filename; the first occurrence is kept, later duplicates are skipped. To override, delete or rename the old file.

### Q4: Is dynamic parameter completion supported?

**A:** The current version only supports command prefix matching (typing `AT+C` lists all commands starting with `AT+C`). Parameter completion must be written manually per device docs.

### Q5: How to add new commands?

**A:** Edit any `.json` file under `commands/`, or create a new file, and add to the `commands` array. Changes load on next startup (or trigger "Refresh command library" in settings).

---

## 5. Generating Command Libraries with AI

If you have your device's AT command manual (PDF, Word, web page, etc.), provide this document along with the manual to an AI (e.g. ChatGPT, Claude), using this prompt:

```
Based on the attached AT command manual and the format spec in commands/README_EN.md,
generate a JSON command library file. Requirements:
1. Strictly follow field types and enum values
2. Can I customize the category field?
   - **Yes**. While we suggest using common categories like info/network/sim/call/sms/general for consistency, you can define custom categories (e.g. `"mqtt"`, `"http"`, `"custom"`) based on your needs.
3. Keep descriptions short and clear, 1-2 sentences
4. Only include commands explicitly listed in the manual
5. Output complete JSON that can be saved directly as a .json file
```

**Post-generation checklist:**
- ✅ Is `version` set to `"1.0"`?
- ✅ Is `category` one of the 6 enum values?
- ✅ Are all required fields (command/category/description) present?
- ✅ Is the JSON syntax valid? (verify at <https://jsonlint.com/>)

---

## 6. Technical Notes

- **Loading**: On startup, the Tauri backend reads all `.json` under `commands/`, and the frontend builds an in-memory Trie for millisecond prefix matching
- **Performance**: Handles thousands of commands with no perf loss; lookup complexity O(prefix length)
- **Hot reload**: After editing files, click "Refresh command library" in settings for immediate effect, no restart needed
- **Forward compatibility**: Future versions may add fields (e.g. `syntax`, `response`); old files remain compatible

---

**Related files:**
- [Test Case Format Specification](../testcases/README_EN.md)
- [中文版](./README.md)
