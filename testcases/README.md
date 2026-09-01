# 测试用例格式规范

本目录存放自动化测试用例 JSON 文件。每个文件代表一个完整的测试场景，支持树形嵌套、变量提取、循环重试等高级功能。

---

## 📋 目录

1. [快速开始](#快速开始)
2. [文件结构](#文件结构)
3. [字段详解](#字段详解)
4. [命令类型](#命令类型)
5. [变量系统](#变量系统)
6. [失败策略](#失败策略)
7. [完整示例](#完整示例)
8. [常见问题](#常见问题)

---

## 🚀 快速开始

### 最小示例

只需填写关键字段，其余使用默认值：

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "基础 AT 测试",
    "children": [
      {
        "type": "command",
        "name": "AT 握手",
        "content": "AT"
      }
    ]
  }
}
```

**自动补全的默认值：**
- 数据格式：UTF-8，行尾符：CRLF
- 发送次数：1，超时：2000ms
- 校验方式：标准（响应含 OK）
- 失败策略：中断测试

### 添加自己的用例

1. **复制示例文件** - 从 `demo.json` 开始
2. **修改用例名称和命令** - 按需调整 `content` 字段
3. **调整参数**（可选）- 修改超时、重试次数等
4. **保存并导入** - 在应用中选择文件加载

---

## 📦 文件结构

```
test-case.json
├── version          # 格式版本（固定 "2.0"）
├── createdAt        # 创建时间（可选）
└── rootCase         # 根用例
    ├── name         # 用例名称
    ├── targetPort   # 目标串口（可省略=自动）
    ├── runCount     # 循环次数
    ├── onFailure    # 失败策略
    └── children     # 子项数组
        ├── 命令 1   # type="command"
        ├── 守护     # type="urc-guard"
        └── 子用例   # 嵌套用例
```

**层级关系：**
- **根用例**：最顶层，定义目标串口和全局策略
- **子用例**：可嵌套多层，实现模块化测试
- **命令**：实际发送的 AT 指令
- **守护**：后台监听 URC 上报

---

## 📖 字段详解

### 根级字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | `string` | ✅ | 格式版本，固定 `"2.0"` |
| `createdAt` | `string` | ❌ | ISO 8601 时间戳（可选） |
| `rootCase` | `object` | ✅ | 根用例对象 |

### 用例字段（rootCase / 子用例）

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| **基本信息** ||||
| `name` | `string` | 用例名称 | `"Unnamed Case"` |
| `description` | `string` | 用例说明 | - |
| `targetPort` | `string` | 目标串口（仅根用例）| 自动 |
| **执行控制** ||||
| `runCount` | `number` | 循环次数（0=无限循环）| `1` |
| `onFailure` | `string` | 失败策略 | `"abort"` |
| `maxSelfRetries` | `number` | `retry-self` 重试次数 | `1` |
| **UI 状态** ||||
| `selected` | `boolean` | 是否勾选执行 | `false` |
| `isExpanded` | `boolean` | 是否展开 | `true` |
| `status` | `string` | 运行状态 | `"pending"` |
| **子项** ||||
| `children` | `array` | 命令或子用例数组 | 必填 |

#### targetPort 说明

- **省略或留空**（推荐）- 自动模式：
  - 单串口：使用已连接的串口
  - 双串口：跟随发送区选择（P1/P2/ALL）
- **`"P1"`** - 固定使用第一个串口
- **`"P2"`** - 固定使用第二个串口

> 💡 **建议**：除非需要固定串口，否则省略此字段

---

## 🔧 命令类型

### 1. 标准命令 (type="command")

发送 AT 命令并等待响应。

#### 基本字段

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `type` | `string` | 命令类型 | `"command"` |
| `name` | `string` | 命令名称 | - |
| `content` | `string` | 命令内容（支持变量） | 必填 |
| `dataFormat` | `string` | 数据格式 | `"utf8"` |
| `lineEnding` | `string` | 行尾符 | `"crlf"` |
| `delay` | `number` | 命令延时(ms) | `0` |

**dataFormat 选项：** `"utf8"` | `"hex"`  
**lineEnding 选项：** `"none"` | `"lf"` | `"cr"` | `"crlf"`

#### 重复发送

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `repeatCount` | `number` | 最多发送次数 | `1` |
| `successThreshold` | `number` | 需成功次数 | `1` |
| `stopWhenReached` | `boolean` | 达标后立即停止 | `true` |

**示例：** "发送 10 次，至少成功 8 次"
```json
{
  "repeatCount": 10,
  "successThreshold": 8,
  "stopWhenReached": false
}
```

#### 响应校验

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `timeout` | `number` | 等待超时(ms) | `2000` |
| `validation` | `string` | 校验类型 | `"standard"` |
| `validationPattern` | `string` | 校验模式（custom 时必填） | - |
| `validationMode` | `string` | 匹配方式（custom 时必填） | - |

**validation 类型：**

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| `"none"` | 发送后立即成功 | 不需要响应的命令 |
| `"standard"` | 响应含 `OK` | 标准 AT 命令 |
| `"custom"` | 自定义匹配 | 特殊响应格式 |

**validationMode 选项：**

| 模式 | 说明 | 示例 |
|------|------|------|
| `"contains"` | 包含字符串 | 响应含 `+CSQ:` |
| `"exact"` | 完全匹配 | 响应等于 `OK` |
| `"regex"` | 正则表达式 | 匹配 `\+CSQ:\s*\d+` |
| `"startsWith"` | 以...开头 | 响应以 `AT+` 开头 |
| `"endsWith"` | 以...结尾 | 响应以 `OK` 结尾 |

#### 文件发送

命令可以关联文件进行发送（如证书、固件、配置文件等）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `fileData` | `object` | 文件数据 `{ id, name, size }` |

**文件存放规则：**

文件必须放在与用例同名的子目录中：
```
testcases/
├── https-test.json          # 用例文件
└── https-test/              # 同名目录
    ├── ca-cert.pem         # 证书文件
    └── config.txt          # 配置文件
```

**在用例中引用文件：**

```json
{
  "type": "command",
  "name": "上传 CA 证书",
  "content": "AT+QSSLCFG=\"cacert\",2",
  "fileData": {
    "id": "https-test/ca-cert.pem",
    "name": "ca-cert.pem",
    "size": 1234
  },
  "validation": "standard"
}
```

**字段说明：**
- `id` - 相对路径格式：`"用例名/文件名"`（用例名不含 `.json` 后缀）
- `name` - 文件名（显示用）
- `size` - 文件大小（字节数）

**完整示例：HTTPS 证书配置**

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "HTTPS 证书配置",
    "children": [
      {
        "type": "command",
        "name": "配置 SSL 版本",
        "content": "AT+QSSLCFG=\"sslversion\",2,4"
      },
      {
        "type": "command",
        "name": "准备上传 CA 证书",
        "content": "AT+QSSLCFG=\"cacert\",2",
        "timeout": 2000
      },
      {
        "type": "command",
        "name": "发送 CA 证书文件",
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
        "name": "准备上传客户端证书",
        "content": "AT+QSSLCFG=\"clientcert\",2",
        "timeout": 2000
      },
      {
        "type": "command",
        "name": "发送客户端证书文件",
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
        "name": "准备上传客户端密钥",
        "content": "AT+QSSLCFG=\"clientkey\",2",
        "timeout": 2000
      },
      {
        "type": "command",
        "name": "发送客户端密钥文件",
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
        "name": "启用证书验证",
        "content": "AT+QSSLCFG=\"seclevel\",2,2"
      }
    ]
  }
}
```

**文件发送流程说明：**

文件发送采用**两步模式**：
1. **准备命令** - 发送 AT 指令通知设备（`content` 有内容，无 `fileData`）
2. **文件命令** - 发送实际文件（`content` 为空，有 `fileData`）

**示例流程：**
```
步骤1: 发送 "AT+QSSLCFG=\"cacert\",2"  ← 告诉设备准备接收证书
步骤2: 发送文件 ca-cert.pem           ← 实际发送证书内容
```

**AI 生成用例时如何处理文件：**

当需要生成包含文件发送的用例时，提供以下提示词：

```
生成包含文件发送的测试用例，文件放置规则：
1. 用例文件名：<用例名>.json
2. 附件目录：testcases/<用例名>/
3. 在命令中通过 fileData 引用：
   {
     "fileData": {
       "id": "<用例名>/<文件名>",
       "name": "<文件名>",
       "size": <预估字节数>
     }
   }
4. 文件需要用户手动准备并放入附件目录
```

**注意事项：**
- ⚠️ **文件需要手动准备** - AI 只生成用例 JSON，实际文件需要用户准备
- ✅ **命名规范** - 用例名和附件目录名必须一致（不含 `.json` 后缀）
- ✅ **size 字段** - 可以填写预估值，不影响发送功能
- ✅ **导入用例** - 在应用中拖放文件到命令编辑器，自动生成 `fileData`

---

### 2. URC 守护 (type="urc-guard")

后台监听设备主动上报（Unsolicited Result Code）。

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `type` | `string` | 固定 `"urc-guard"` | 必填 |
| `pattern` | `string` | 匹配模式（正则或字符串） | 必填 |
| `matchMode` | `string` | 匹配方式 | `"contains"` |
| `scope` | `string` | 作用域 | `"case"` |
| `action` | `string` | 触发后动作 | `"fail-current"` |
| `rearm` | `string` | 触发后行为 | `"continuous"` |

#### scope 作用域

- **`"root"`** - 全局守护（整个测试期间生效）
- **`"case"`** - 用例守护（仅在所属用例执行期间生效）

#### action 动作

| 动作 | 说明 | 适用场景 |
|------|------|----------|
| `"restart-round"` | 重新开始当前轮次 | 检测到异常需要重试 |
| `"abort"` | 中断整个测试 | 致命错误 |
| `"fail-current"` | 标记当前节点失败 | 警告性错误 |
| `"capture-only"` | 仅提取变量 | 数据收集 |
| `"log-only"` | 仅记录日志 | 调试信息 |

#### rearm 触发模式

- **`"once"`** - 触发一次后停止监听
- **`"continuous"`** - 持续监听（每次匹配都触发）

---

## 🔄 变量系统

### 变量提取

从命令响应中提取数据，供后续命令使用。

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

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | `boolean` | 是否启用 |
| `parseType` | `string` | `"regex"` 或 `"split"` |
| `parsePattern` | `string` | 正则表达式或分隔符 |
| `parameterMap` | `object` | 变量映射 `{"变量名": "捕获组索引"}` |

**parseType 对比：**

| 类型 | 说明 | 示例 |
|------|------|------|
| `"regex"` | 正则匹配，捕获组索引 | `"1"`, `"2"` |
| `"split"` | 分隔符切分，分片索引 | `"0"`, `"1"` |

### 变量替换

在命令 `content` 中使用变量：

| 语法 | 说明 | 示例 | 结果 |
|------|------|------|------|
| `${变量名}` | 提取的变量 | `AT+AUTH=${token}` | `AT+AUTH=abc123` |
| `${rand:str:N}` | N 个随机字符 | `${rand:str:8}` | `A3kF9pQz` |
| `${rand:hex:N}` | N 字节随机 HEX | `${rand:hex:4}` | `3FA8B21C` |
| `${seq:起始:步长}` | 序列生成器 | `${seq:60:20}` | 60→80→100... |
| `${seq:起始:步长:上限}` | 带上限序列 | `${seq:10:5:30}` | 10→15→...→30 |

#### 序列生成器特性

- **每轮重置** - 用例每轮循环时自动重置到初始值
- **独立计数** - 不同参数组合互不干扰
- **支持负数** - `${seq:100:-10}` 实现递减（100→90→80...）
- **上限保护** - 达到上限后保持不变

**实际应用：**

```json
{
  "content": "AT+TIMEOUT=${seq:60:20}",
  "repeatCount": 5
}
```

发送序列：`AT+TIMEOUT=60` → `80` → `100` → `120` → `140`

---

## ⚠️ 失败策略

### onFailure 策略表

| 策略 | 说明 | 适用于 |
|------|------|--------|
| `"continue"` | 跳过失败，继续下一个 | 用例、命令 |
| `"end-round"` | 结束本轮，进入下一轮 | 用例、命令 |
| `"retry-self"` | 重新执行本用例 | 仅用例 |
| `"abort"` | 中断整个测试 | 用例、命令 |

### 策略详解

#### continue - 跳过失败

```
命令A [失败] → 跳过 → 命令B [执行]
```

适用场景：可选步骤、不影响后续的命令

#### end-round - 结束本轮

```
[第1轮] 命令A → 命令B [失败] → 结束本轮
[第2轮] 命令A → 命令B → ...
```

适用场景：父用例有循环时，失败后直接进入下一轮

#### retry-self - 重试本用例

```
用例A
  ├─ 命令1
  ├─ 命令2 [失败]
  └─ 触发重试 → 重新执行用例A（最多 maxSelfRetries 次）
```

适用场景：网络注册、连接建立等可重试场景

#### abort - 中断测试

```
命令A → 命令B [失败] → 中断测试 [停止]
```

适用场景：致命错误、前置条件失败

---

## 📝 完整示例

### 示例 1：信号质量查询与提取

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "信号质量查询",
    "children": [
      {
        "type": "command",
        "name": "查询信号",
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
        "name": "记录信号值",
        "content": "AT+LOG=RSSI:${rssi},BER:${ber}",
        "validation": "standard"
      }
    ]
  }
}
```

### 示例 2：网络注册守护

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "网络注册测试",
    "children": [
      {
        "id": "case_registration",
        "name": "注册子用例",
        "runCount": 3,
        "onFailure": "retry-self",
        "maxSelfRetries": 2,
        "children": [
          {
            "type": "urc-guard",
            "name": "掉网守护",
            "pattern": "+CREG: 0",
            "matchMode": "contains",
            "scope": "case",
            "action": "restart-round",
            "rearm": "continuous"
          },
          {
            "type": "command",
            "name": "等待注册",
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

### 示例 3：HTTP 超时扫描

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "HTTP 超时扫描",
    "description": "测试 60-140 秒的超时参数",
    "children": [
      {
        "type": "command",
        "name": "HTTP GET 请求",
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

### 示例 4：稳定性测试（无限循环）

```json
{
  "version": "2.0",
  "rootCase": {
    "name": "AT 稳定性测试",
    "runCount": 0,
    "onFailure": "continue",
    "children": [
      {
        "type": "command",
        "name": "AT 握手",
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

## ❓ 常见问题

### Q1: 必填字段有哪些？

**A:** 最少只需 3 个字段：
```json
{
  "version": "2.0",
  "rootCase": {
    "name": "用例名",
    "children": [
      { "type": "command", "content": "AT" }
    ]
  }
}
```

### Q2: targetPort 应该填什么？

**A:** **建议省略**（自动模式）。只有需要固定串口时才填 `"P1"` 或 `"P2"`。

### Q3: 如何让命令失败后不中断测试？

**A:** 设置 `"onFailure": "continue"`。

### Q4: validation="none" 有什么用？

**A:** 发送后立即成功，不等待响应。适用于：
- 配置类命令（不关心响应）
- 连续发送场景（无需确认）

### Q5: 正则表达式如何调试？

**A:** 
- **工具箱** → "正则匹配校验" - 实时测试
- 在线工具：https://regex101.com/（选择 JavaScript）

### Q6: 变量提取失败会报错吗？

**A:** 不会报错，变量值为空字符串。建议先用 `validationPattern` 验证响应格式。

### Q7: 序列生成器何时重置？

**A:** 每轮循环（`runCount` 的每次迭代）开始时自动重置到初始值。

### Q8: 如何实现条件跳转？

**A:** 本系统不支持跳转。替代方案：
- 使用 `onFailure: "continue"` 跳过失败步骤
- 嵌套子用例实现分支逻辑
- 使用 URC 守护实现异常处理

---

## 🤖 使用 AI 生成用例

### 提示词模板

```
请根据以下测试需求和 testcases/README.md 格式规范，生成 JSON 测试用例：

需求：
[粘贴你的测试需求、手册或流程图]

要求：
1. 严格遵守字段类型和枚举值
2. targetPort 省略（使用自动模式）
3. 为关键命令添加 description 说明
4. 输出完整 JSON，可直接保存
```

### 生成后检查清单

- ✅ `version` 是否为 `"2.0"`
- ✅ `rootCase.targetPort` 已省略或为 `"P1"`/`"P2"`
- ✅ 所有命令包含 `type` 字段
- ✅ 枚举字段值合法（`validation`/`onFailure`/`matchMode` 等）
- ✅ `validation="custom"` 时有 `validationPattern` 和 `validationMode`
- ✅ JSON 语法正确（可用 https://jsonlint.com/ 校验）

---

## 📚 相关文档

- [命令库格式规范](../commands/README.md) - AT 命令库格式说明
- [English Version](./README_EN.md) - 英文版文档

---

## 🔧 技术说明

**执行模型：** 递归树遍历  
**状态管理：** 每个节点独立维护状态  
**变量作用域：** 全局变量池（整个测试期间共享）  
**并发控制：** 同一时刻仅执行一个命令  
**向后兼容：** v1.0 格式自动迁移到 v2.0

---

**版本：** 2.0  
**最后更新：** 2026-09
