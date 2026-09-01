# Command Library Format Specification

This directory stores serial AT command library files, used for command autocomplete, ghost-text hints, and quick reference.

---

## 1. File Format Overview

Each `.json` file represents a command library. On startup, the app auto-loads all JSON files under `commands/`, merged in filename order (earlier files take priority; duplicate commands are skipped).

**Basic structure:**

```json
{
  "name": "Command Library Display Name",
  "commands": [
    {
      "cmd": "AT+CSQ",
      "desc": "Query signal quality",
      "keywords": ["network", "signal"],
      "templates": [
        { "s": "AT+CSQ", "d": "Exec: query signal strength" }
      ]
    }
  ]
}
```

---

## 2. Field Details

### Root-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | recommended | Library name (for display, e.g. "General Commands"); falls back to filename if omitted |
| `commands` | `array` | ✅ | Command list, at least 1 command |

### `commands` array element fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `cmd` | `string` | ✅ | Owner command name (without params) | `"AT"`, `"AT+CSQ"`, `"AT+CGDCONT"` |
| `desc` | `string` | recommended | Short description (1-2 sentences) | `"Query signal quality"` |
| `keywords` | `string[]` | ❌ | Keyword array for fuzzy search | `["network", "signal", "csq"]` |
| `templates` | `array` | ✅ | Example list under this command, at least 1 |  |

### `templates` array element fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `s` | `string` | ✅ | Example syntax, may contain placeholders `<...>` | `"AT+CGDCONT=<cid>,<PDP_type>,<APN>"` |
| `d` | `string` | ❌ | Example description | `"Set: define PDP context"` |

**Placeholders and optional segments:**
- Angle brackets denote parameter placeholders, e.g. `<cid>`, `<APN>`; during completion a placeholder matches any value.
- Square brackets denote optional segments (per 3GPP notation), e.g. `AT+CGDCONT=<cid>[,<PDP_type>[,<APN>]]`; brackets are flattened automatically during matching.

---

## 3. Complete Example

```json
{
  "name": "Network Commands",
  "commands": [
    {
      "cmd": "AT+CSQ",
      "desc": "Query signal quality",
      "keywords": ["network", "signal", "csq"],
      "templates": [
        { "s": "AT+CSQ", "d": "Exec: returns signal strength and bit error rate" }
      ]
    },
    {
      "cmd": "AT+CGDCONT",
      "desc": "Define PDP context",
      "keywords": ["network", "pdp", "apn"],
      "templates": [
        { "s": "AT+CGDCONT?", "d": "Read: query configured PDP contexts" },
        { "s": "AT+CGDCONT=?", "d": "Test: query supported value ranges" },
        { "s": "AT+CGDCONT=<cid>[,<PDP_type>[,<APN>]]", "d": "Set: define PDP context" },
        { "s": "AT+CGDCONT=1,\"IP\",\"cmnet\"", "d": "Example: IP type, APN cmnet" }
      ]
    }
  ]
}
```

---

## 4. FAQ

### Q1: Are there filename requirements?

**A:** No hard requirement. Filename alphabetical order affects dedup priority (earlier files win).

### Q2: Are commands case-sensitive?

**A:** No. Lookups are uppercased internally, but uppercase is recommended to match AT conventions.

### Q3: What if the same command appears in multiple files?

**A:** Sorted by filename; the first occurrence is kept, later duplicates are skipped. To override, delete or rename the old file.

### Q4: How does completion work?

**A:** While typing, the app first shows example continuations compatible with the current input (placeholders match any value) with a ghost-text hint; when there is no compatible continuation, it falls back to fuzzy search over `cmd` / `desc` / `keywords`.

### Q5: How to add new commands?

**A:** Edit any `.json` file under `commands/`, or create a new file, and add to the `commands` array. Click "Refresh command library" in settings for immediate effect, no restart needed. You can also press Ctrl+S in the app to save a typed command into a library.

---

## 5. Generating Command Libraries with AI

If you have your device's AT command manual (PDF, Word, web page, etc.), provide this document along with the manual to an AI (e.g. ChatGPT, Claude), using this prompt:

```
Based on the attached AT command manual and the format spec in commands/README_EN.md,
generate a JSON command library file. Requirements:
1. Strictly follow the structure: { name, commands:[{ cmd, desc, keywords, templates:[{ s, d }] }] }
2. cmd is the owner command name (without params); group different usages under its templates
3. Keep desc short and clear, 1-2 sentences; provide searchable keywords
4. Example s may use placeholders <...> for params and [...] for optional segments
5. Only include commands explicitly listed in the manual
6. Output complete JSON that can be saved directly as a .json file
```

**Post-generation checklist:**
- ✅ Is the root `{ name, commands }` with no extra fields?
- ✅ Does each command have `cmd` and at least 1 `templates` entry?
- ✅ Is the JSON syntax valid? (verify at <https://jsonlint.com/>)

---

## 6. Technical Notes

- **Loading**: On startup, the Tauri backend reads all `.json` under `commands/`; the frontend normalizes and merges them into an in-memory command library
- **Hot reload**: After editing files, click "Refresh command library" in settings for immediate effect, no restart needed
- **Compatibility**: Older formats are normalized on load for best-effort backward compatibility

---

**Related files:**
- [Test Case Format Specification](../testcases/README_EN.md)
- [中文版](./README.md)
