# 测试用例格式规范 (Test Case Format Specification)

本目录存放自动化测试用例 JSON 文件，每个文件代表一个完整的测试场景。

---

## 一、文件格式概览

每个 `.json` 文件包含一个根用例（root case），根用例下可以嵌套子用例和命令，形成树形结构。

**基本结构：**

```json
{
  "version": "2.0",
  "createdAt": "2026-08-13T00:00:00.000Z",
  "rootCase": {
    "id": "case_demo_root",
    "name": "测试场景名称",
    "targetPort": "P1",
    "runCount": 1,
    "onFailure": "abort",
    "selected": true,
    "isExpanded": true,
    "status": "pending",
    "children": [ /* 命令或子用例 */ ]
  }
}
```

---

## 二、字段详细说明

> **只填关键参数即可。** 导入时软件会自动补齐缺失字段的默认值，你手写 / 用 AI 生成 JSON 时通常只需填写标记为 ✅ 的字段，其余可省略（省略即用下表"默认值"）。
> 另外这几项**填了也会被覆盖**，无需关心：`id`（导入时自动重新分配，避免冲突）、`status`（自动重置为 `"pending"`）、`selected`（导入后自动取消勾选，由你在界面上再勾选要跑的项）。

### 根级字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | `string` | ✅ | 格式版本，当前固定为 `"2.0"` |
| `createdAt` | `string` | ❌ | ISO 8601 时间戳（可选） |
| `rootCase` | `object` | ✅ | 根用例对象（必须包含 `targetPort`） |

### 根用例 (rootCase) 字段

| 字段 | 类型 | 必填 | 说明 | 取值范围/默认值 |
|------|------|------|------|-----------------|
| `id` | `string` | ❌ | 唯一标识（导入时自动重新分配，可省略） | 建议格式：`case_<timestamp>_<random>` |
| `name` | `string` | ✅ | 用例名称（建议填写，省略默认 `"Unnamed Case"`） | 任意字符串 |
| `description` | `string` | ❌ | 用例说明（可选） | - |
| `targetPort` | `string` | ❌ | **目标端口**（根用例特有，建议显式指定） | `"P1"` / `"P2"`，默认 `"P1"` |
| `runCount` | `number` | ❌ | 循环次数 | `≥1`（普通循环），`0`（无限循环，需手动停止），默认 `1` |
| `onFailure` | `string` | ❌ | 失败策略（枚举） | `"continue"` / `"end-round"` / `"retry-self"` / `"abort"`，默认 `"abort"` |
| `maxSelfRetries` | `number` | ❌ | `retry-self` 的重试上限 | 默认 `1`，耗尽后转 `continue` |
| `selected` | `boolean` | ❌ | 是否执行（导入后自动取消勾选，可省略） | `true` / `false` |
| `isExpanded` | `boolean` | ❌ | UI 展开状态 | `true` / `false`，默认 `true` |
| `status` | `string` | ❌ | 运行状态（导入时自动重置，可省略） | `"pending"` / `"running"` / `"success"` / `"failed"` / `"interrupted"` / `"skipped"` |
| `children` | `array` | ✅ | 子项数组（命令或子用例） | 至少包含 1 个子项 |

**targetPort 说明：**
- `"P1"` —— 第一个已连接的串口（**建议使用**）
- `"P2"` —— 第二个已连接的串口
- 必须在根用例（rootCase）中指定，子用例不需要该字段

**onFailure 策略详解：**
- `continue` —— 跳过失败，继续执行下一个兄弟节点
- `end-round` —— 结束本轮（父用例有循环则进入下一轮；无循环则结束本用例）
- `retry-self` —— 重新执行本用例（受 `maxSelfRetries` 限制，仅用例支持）
- `abort` —— 中断整个测试

### 子用例 (sub-case) 字段

子用例与根用例字段相同，**但无需 `targetPort`**（继承父用例的目标端口）。

---

## 三、命令类型

`children` 数组可包含两种命令类型：

### 3.1 标准命令 (type="command")

用于发送 AT 命令并等待响应。

| 字段 | 类型 | 必填 | 说明 | 取值范围/默认值 |
|------|------|------|------|-----------------|
| `id` | `string` | ❌ | 唯一标识（导入时自动重新分配，可省略） | 建议格式：`cmd_<timestamp>_<random>` |
| `type` | `string` | ✅ | 命令类型（省略默认按 `"command"` 处理） | `"command"` |
| `name` | `string` | ❌ | 命令显示名称 | - |
| `description` | `string` | ❌ | 命令说明 | - |
| `content` | `string` | ✅ | **命令内容**（支持变量替换） | 见"变量语法"章节 |
| `dataFormat` | `string` | ❌ | 数据格式 | `"utf8"` / `"hex"`，默认 `"utf8"` |
| `lineEnding` | `string` | ❌ | 行尾符 | `"none"` / `"lf"` / `"cr"` / `"crlf"`，默认 `"crlf"` |
| `preDelay` | `number` | ❌ | 发送前延迟(ms) | `≥0`，默认 `0` |
| `postDelay` | `number` | ❌ | 成功后延迟(ms) | `≥0`，默认 `0` |
| `selected` | `boolean` | ❌ | 是否执行（导入后自动取消勾选，可省略） | `true` / `false` |
| `status` | `string` | ❌ | 运行状态（导入时自动重置，可省略） | 同用例 `status` |
| **重复策略** | | | | |
| `repeatCount` | `number` | ❌ | 发送次数 | `≥1`（`1` = 不重复），默认 `1` |
| `successThreshold` | `number` | ❌ | 需成功几次才算命令成功 | `≤ repeatCount`，默认 `1` |
| `stopWhenReached` | `boolean` | ❌ | 达到阈值后立即停止 | `true`（立即停）/ `false`（发满 repeatCount），默认 `true` |
| `attemptInterval` | `number` | ❌ | 重发间隔(ms) | `≥0`，默认 `1000` |
| **响应校验** | | | | |
| `timeout` | `number` | ❌ | 单次等待超时(ms) | `≥0`，默认 `2000`，`validation="none"` 时不生效 |
| `validation` | `string` | ❌ | 校验类型 | `"none"` / `"standard"` / `"custom"`，默认 `"standard"` |
| `validationPattern` | `string` | ❌ | 校验模式（`custom` 时必需） | 正则或字符串 |
| `validationMode` | `string` | ❌ | 匹配方式（`custom` 时必需） | `"contains"` / `"exact"` / `"regex"` / `"startsWith"` / `"endsWith"` |
| **变量提取** | | | | |
| `extractConfig` | `object` | ❌ | 变量提取配置（可选） | 见"变量提取"章节 |
| **失败处理** | | | | |
| `onFailure` | `string` | ❌ | 失败策略 | `"continue"` / `"end-round"` / `"abort"`（命令不支持 `retry-self`），默认 `"abort"` |
| **文件发送** | | | | |
| `fileData` | `object` | ❌ | 文件数据（可选） | `{ name, size, base64 }` |

**validation 类型详解：**
- `none` —— 发送后立即成功，不等待响应
- `standard` —— 标准 AT 校验（响应包含 `OK` 即通过）
- `custom` —— 自定义模式匹配（需指定 `validationPattern` 和 `validationMode`）

**validationMode 详解：**
- `contains` —— 响应包含指定字符串
- `exact` —— 响应完全匹配
- `regex` —— 正则表达式匹配
- `startsWith` —— 响应以指定字符串开头
- `endsWith` —— 响应以指定字符串结尾

### 3.2 URC 后台守护 (type="urc-guard")

用于监听设备主动上报（Unsolicited Result Code），触发后执行指定动作。

| 字段 | 类型 | 必填 | 说明 | 取值范围/默认值 |
|------|------|------|------|-----------------|
| `id` | `string` | ❌ | 唯一标识（导入时自动重新分配，可省略） | - |
| `type` | `string` | ✅ | 命令类型（固定） | `"urc-guard"` |
| `name` | `string` | ❌ | 守护名称 | - |
| `description` | `string` | ❌ | 守护说明 | - |
| `content` | `string` | ❌ | 无实际意义（历史兼容，留空） | `""` |
| `dataFormat` | `string` | ❌ | 固定 | `"utf8"` |
| `lineEnding` | `string` | ❌ | 固定 | `"none"` |
| `preDelay` | `number` | ❌ | 固定 | `0` |
| `postDelay` | `number` | ❌ | 固定 | `0` |
| `selected` | `boolean` | ❌ | 是否执行（导入后自动取消勾选，可省略） | `true` / `false` |
| `status` | `string` | ❌ | 运行状态（导入时自动重置，可省略） | - |
| **守护配置** | | | | |
| `pattern` | `string` | ✅ | 匹配模式 | 正则或字符串 |
| `matchMode` | `string` | ❌ | 匹配方式 | 同标准命令的 `validationMode`，默认 `"contains"` |
| `scope` | `string` | ❌ | 作用域 | `"root"` / `"case"`，默认 `"case"` |
| `action` | `string` | ❌ | 命中后动作 | `"restart-round"` / `"abort"` / `"fail-current"` / `"capture-only"` / `"log-only"`，默认 `"fail-current"` |
| `rearm` | `string` | ❌ | 触发后行为 | `"once"` / `"continuous"`，默认 `"continuous"` |
| `extractConfig` | `object` | ❌ | 变量提取配置（可选） | - |

**scope 详解：**
- `root` —— 全局作用域（整个测试期间生效）
- `case` —— 用例作用域（仅在所属用例执行期间生效）

**action 详解：**
- `restart-round` —— 重新开始当前轮次
- `abort` —— 中断整个测试
- `fail-current` —— 将当前节点标记为失败
- `capture-only` —— 仅提取变量，不影响执行
- `log-only` —— 仅记录日志

**rearm 详解：**
- `once` —— 触发一次后停止监听
- `continuous` —— 持续监听（每次收到匹配数据都触发）

---

## 四、变量提取与替换

### 4.1 变量提取 (extractConfig)

从命令响应中提取数据到变量池，供后续命令使用。

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

| 字段 | 类型 | 必填 | 说明 | 取值范围 |
|------|------|------|------|---------|
| `enabled` | `boolean` | ✅ | 是否启用提取 | `true` / `false` |
| `parseType` | `string` | ✅ | 解析方式 | `"regex"` / `"split"` |
| `parsePattern` | `string` | ✅ | 正则表达式或分隔符 | `regex`：正则表达式<br>`split`：分隔符字符串 |
| `parameterMap` | `object` | ✅ | 变量映射表 | `{ "变量名": "捕获组索引或分片索引" }` |

**parseType 详解：**
- `regex` —— 用正则表达式匹配，`parameterMap` 的值是捕获组索引（`"1"`, `"2"`, ...）
- `split` —— 用分隔符切分，`parameterMap` 的值是分片索引（`"0"`, `"1"`, ...）

### 4.2 变量替换

命令内容 (`content`) 支持以下变量语法：

| 语法 | 说明 | 示例 |
|------|------|------|
| `${变量名}` | 提取型变量（从响应中提取） | `AT+CMD=${token}` |
| `${rand:str:N}` | 生成 N 个随机可见字符 | `${rand:str:8}` → `A3kF9pQz` |
| `${rand:hex:N}` | 生成 N 字节随机数据，输出 2N 个大写 HEX 字符 | `${rand:hex:4}` → `3FA8B21C`（4 字节 = 8 个 hex） |
| `${seq:起始:步长}` | 序列生成器，每次调用自增 | `${seq:60:20}` → 60, 80, 100... |
| `${seq:起始:步长:上限}` | 带上限的序列生成器（达到上限后保持） | `${seq:10:5:30}` → 10, 15, 20, 25, 30, 30... |

**示例：**

```json
{
  "content": "AT+AUTH=${token},${rand:hex:8}",
  ...
}
```

如果 `token` 变量值为 `abc123`，实际发送内容可能为：

```
AT+AUTH=abc123,4F9A2E1B3C7D6A8F
```

**动态长度：** 变量替换是先字典后函数，所以长度参数也可用提取变量：

```json
{
  "content": "${rand:hex:${len}}"
}
```

如果 `len=4`，先替换成 `${rand:hex:4}`，再生成 8 个 hex 字符。

**序列生成器说明：**

序列生成器用于实现参数自动递增，适用于超时测试、功率扫描等场景：

```json
{
  "content": "AT+HTTPGET=${seq:60:20}",
  "repeatCount": 5
}
```

实际发送：`AT+HTTPGET=60` → `AT+HTTPGET=80` → `AT+HTTPGET=100` → `AT+HTTPGET=120` → `AT+HTTPGET=140`

特性：
- **每轮重置**：用例每轮（`runCount` 的每次循环）开始时，计数器自动重置到初始值
- **独立计数**：不同参数组合的序列生成器各自独立计数（如 `${seq:60:20}` 和 `${seq:0:1}` 互不干扰）
- **支持负数**：起始值、步长均可为负数，实现递减（如 `${seq:100:-10}` → 100, 90, 80...）
- **上限保护**：带上限时，达到最大值后保持该值不再递增

详细文档请参考：[序列生成器完整说明](../docs/sequence-generator.md)

---

## 五、完整示例

### 示例 0：最小写法（只填关键参数，其余用默认值）

导入后软件自动补齐 `dataFormat`/`lineEnding`/`repeatCount`/`timeout`/`validation`/`onFailure` 等字段：

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

上面这条命令等价于：发一次 `AT`（CRLF 结尾），标准校验（响应含 `OK` 即通过），超时 2000ms，失败即中断。需要覆盖某项时再显式写出对应字段即可。

### 示例 1：基础 AT 握手（完整字段）

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

### 示例 2：变量提取与替换

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

### 示例 3：URC 守护 + 嵌套子用例

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

## 六、常见问题 (FAQ)

### Q1: 根用例必须有 targetPort 吗？

**A:** 不强制。省略时默认 `"P1"`，但**建议在根用例显式指定** `targetPort`（`"P1"` 或 `"P2"`）以免歧义。子用例会继承该值，无需重复指定。

### Q2: 如何让命令失败后不影响后续执行？

**A:** 设置 `onFailure: "continue"`，该命令失败后会跳过，继续执行下一个兄弟节点。

### Q3: repeatCount 和 successThreshold 的区别？

**A:** 
- `repeatCount`：最多发送几次（如 `3` = 最多发 3 次）
- `successThreshold`：需成功几次才算命令成功（如 `1` = 至少成功 1 次）
- `stopWhenReached`：达到阈值后是否立即停止（`true` = 成功 1 次就停；`false` = 发满 3 次）

### Q4: validation="none" 和 timeout 的关系？

**A:** `validation="none"` 时，命令发送后立即成功，不等待响应，`timeout` 字段无效。

### Q5: URC 守护的 scope 选 root 还是 case？

**A:**
- `root` —— 守护在整个测试期间生效（如监听模块重启、断网）
- `case` —— 守护仅在所属用例执行期间生效（如监听特定阶段的异常）

### Q6: 如何调试正则表达式？

**A:** 
- 使用工具箱中的"正则匹配校验"工具，输入响应文本和正则表达式，即时查看匹配结果和捕获组
- 在线工具：<https://regex101.com/>（选择 JavaScript flavor）

### Q7: 变量提取失败会报错吗？

**A:** 不会。提取失败时变量值为空字符串，不影响命令执行。建议在 `validationPattern` 中先校验响应格式，确保提取成功。

### Q8: 如何实现"发送 10 次，至少成功 8 次"？

**A:** 设置 `repeatCount: 10`，`successThreshold: 8`，`stopWhenReached: false`。

---

## 七、使用 AI 生成测试用例

将本文档和你的测试需求（手册、流程图、文字描述）一起提供给 AI，使用以下提示词：

```
请根据附件中的测试需求和 testcases/README.md 中的格式规范，生成一个 JSON 格式的测试用例文件。要求：
1. 严格遵守字段类型和枚举值
2. rootCase 必须包含 targetPort 字段（"P1" 或 "P2"）
3. 所有命令必须指定 type 字段（"command" 或 "urc-guard"）
4. validation 和 onFailure 必须使用文档中列出的枚举值
5. 为关键命令添加 description 说明意图
6. 输出完整的 JSON，可直接保存为 .json 文件
```

**AI 生成后的检查清单：**
- ✅ `version` 是否为 `"2.0"`
- ✅ `rootCase.targetPort` 是否存在且为 `"P1"` 或 `"P2"`
- ✅ 所有命令是否包含 `type` 字段
- ✅ `validation` / `onFailure` / `matchMode` 等枚举字段是否合法
- ✅ `validation="custom"` 时是否指定了 `validationPattern` 和 `validationMode`
- ✅ JSON 语法是否正确（可用 <https://jsonlint.com/> 校验）

---

## 八、技术说明

- **执行模型**：递归树遍历，无程序计数器、无扁平化、无跳转（v1 模型）
- **状态管理**：每个节点独立维护 `status`，父节点根据子节点状态更新自身状态
- **变量作用域**：全局变量池，所有提取的变量在整个测试期间共享
- **并发控制**：同一时刻只执行一个命令，URC 守护在后台异步监听
- **向后兼容**：旧版本（`version: "1.0"`）文件会在导入时自动迁移到 v2 格式

---

**相关文件：**
- [命令库格式规范](../commands/README.md)
- [English Version](./README_EN.md)
