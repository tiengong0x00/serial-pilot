# 命令库格式规范 (Command Library Format Specification)

本目录存放串口 AT 命令库文件，用于自动补全和快速参考。

---

## 一、文件格式概览

每个 `.json` 文件代表一个命令库，应用启动时自动加载 `commands/` 目录下的所有 JSON 文件，按文件名排序合并（靠前文件优先，重复命令会被跳过）。

**基本结构：**

```json
{
  "version": "1.0",
  "name": "命令库显示名称",
  "commands": [
    {
      "command": "AT+CSQ",
      "category": "network",
      "description": "查询信号质量",
      "example": "AT+CSQ"
    }
  ]
}
```

---

## 二、字段详细说明

### 根级字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | `string` | ✅ | 格式版本，当前固定为 `"1.0"` |
| `name` | `string` | ✅ | 命令库名称（显示用，如 "General Commands"） |
| `commands` | `array` | ✅ | 命令列表，至少包含 1 个命令 |

### commands 数组元素字段

| 字段 | 类型 | 必填 | 说明 | 示例/取值范围 |
|------|------|------|------|--------------|
| `command` | `string` | ✅ | AT 命令语法 | `"AT"`, `"AT+CSQ"`, `"AT+CGDCONT=1,\"IP\",\"cmnet\""` |
| `category` | `string` | ✅ | 命令分类（可自定义） | 任意字符串，建议参考：`"info"` / `"network"` / `"sim"` / `"call"` / `"sms"` / `"general"` |
| `description` | `string` | ✅ | 简短说明（建议 1-2 句话） | `"查询信号质量"` |
| `example` | `string` | ❌ | 用法示例（可选） | `"AT+CFUN=1"` |

**category 分类建议：**
- `info` —— 设备信息（如固件版本、IMEI）
- `network` —— 网络相关（信号、注册、数据连接）
- `sim` —— SIM 卡操作（PIN、电话本）
- `call` —— 通话控制（拨号、接听、挂断）
- `sms` —— 短信操作（发送、读取、删除）
- `general` —— 通用命令（AT 握手、回显、复位）

**注意：** category 为自由字符串字段，可根据实际需求自定义分类（如 `"mqtt"`、`"http"`），上述仅为常见参考。

---

## 三、完整示例

### 示例 1：基础命令库

```json
{
  "version": "1.0",
  "name": "General Commands",
  "commands": [
    {
      "command": "AT",
      "category": "general",
      "description": "测试 AT 通信"
    },
    {
      "command": "ATE0",
      "category": "general",
      "description": "关闭命令回显"
    },
    {
      "command": "AT+CFUN",
      "category": "general",
      "description": "设置功能级别",
      "example": "AT+CFUN=1"
    }
  ]
}
```

### 示例 2：网络命令库

```json
{
  "version": "1.0",
  "name": "Network Commands",
  "commands": [
    {
      "command": "AT+CSQ",
      "category": "network",
      "description": "查询信号质量"
    },
    {
      "command": "AT+CREG?",
      "category": "network",
      "description": "查询网络注册状态"
    },
    {
      "command": "AT+COPS",
      "category": "network",
      "description": "运营商选择",
      "example": "AT+COPS=0"
    }
  ]
}
```

---

## 四、常见问题 (FAQ)

### Q1: 文件名有要求吗？

**A:** 无强制要求，但建议用 `at-<category>.json` 格式（如 `at-network.json`），按分类组织便于维护。文件名按字母序影响去重优先级（靠前文件优先）。

### Q2: 命令大小写敏感吗？

**A:** 不敏感。内部查找时统一转大写，但建议保持大写以符合 AT 规范。

### Q3: 同一命令在多个文件中出现会怎样？

**A:** 按文件名排序，首次出现的版本保留，后续重复项被跳过。如需覆盖，可删除或重命名旧文件。

### Q4: 支持命令参数的动态补全吗？

**A:** 当前版本仅支持命令前缀匹配（如输入 `AT+C` 会列出所有 `AT+C` 开头的命令）。参数补全需根据设备文档手动编写。

### Q5: 如何添加新命令？

**A:** 编辑 `commands/` 目录下的任意 `.json` 文件，或新建文件，添加到 `commands` 数组。保存后应用下次启动时自动加载（或在设置中触发"刷新命令库"）。

---

## 五、使用 AI 生成命令库

如果你有设备的 AT 命令手册（PDF、Word、网页等），可以将本文档和手册一起提供给 AI（如 ChatGPT、Claude），使用以下提示词：

```
请根据附件中的 AT 命令手册，按照 commands/README.md 中的格式规范，生成一个 JSON 格式的命令库文件。要求：
1. 严格遵守字段类型和枚举值
2. category 字段可以自定义吗？
   - **可以**。虽然建议使用 info/network/sim/call/sms/general 这些常见分类便于统一管理，但你可以根据实际需求自定义任意分类名（如 `"mqtt"`、`"http"`、`"custom"`）。
3. description 简短清晰，1-2 句话
4. 仅包含手册中明确列出的命令
5. 输出完整的 JSON，可直接保存为 .json 文件
```

**AI 生成后的检查清单：**
- ✅ `version` 是否为 `"1.0"`
- ✅ `category` 是否在 6 个枚举值中
- ✅ 所有必填字段（command/category/description）是否齐全
- ✅ JSON 语法是否正确（可用 <https://jsonlint.com/> 校验）

---

## 六、技术说明

- **加载机制**：应用启动时通过 Tauri 后端读取 `commands/` 下所有 `.json`，前端构建内存 Trie 树实现毫秒级前缀匹配
- **性能**：支持数千条命令无性能损失，查找复杂度 O(前缀长度)
- **热更新**：修改文件后可在设置中点击"刷新命令库"立即生效，无需重启
- **向后兼容**：未来版本可能新增字段（如 `syntax`、`response`），旧文件保持兼容

---

**相关文件：**
- [测试用例格式规范](../testcases/README.md)
- [English Version](./README_EN.md)
