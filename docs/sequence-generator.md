# 序列生成器功能说明

## 概述

Serial Pilot 支持在测试用例命令中使用序列生成器，实现参数自动递增。适用于需要连续发送不同参数值的测试场景。

## 语法

### 基础序列生成器
```
${seq:起始值:步长}
```

### 带上限的序列生成器
```
${seq:起始值:步长:最大值}
```

## 使用示例

### 示例 1：基础递增

**配置**：
```json
{
  "type": "command",
  "content": "AT+HTTPGET=${seq:60:20}",
  "repeatCount": 5
}
```

**实际发送**：
```
AT+HTTPGET=60
AT+HTTPGET=80
AT+HTTPGET=100
AT+HTTPGET=120
AT+HTTPGET=140
```

### 示例 2：带上限递增

**配置**：
```json
{
  "type": "command",
  "content": "SET_POWER=${seq:10:5:30}",
  "repeatCount": 10
}
```

**实际发送**：
```
SET_POWER=10
SET_POWER=15
SET_POWER=20
SET_POWER=25
SET_POWER=30
SET_POWER=30  # 达到上限，保持 30
SET_POWER=30
...
```

### 示例 3：多序列共存

**配置**：
```json
{
  "type": "command",
  "content": "TEST id=${seq:1:1} val=${seq:100:10}",
  "repeatCount": 3
}
```

**实际发送**：
```
TEST id=1 val=100
TEST id=2 val=110
TEST id=3 val=120
```

### 示例 4：负数和递减

**配置**：
```json
{
  "type": "command",
  "content": "COUNTDOWN=${seq:100:-10}",
  "repeatCount": 5
}
```

**实际发送**：
```
COUNTDOWN=100
COUNTDOWN=90
COUNTDOWN=80
COUNTDOWN=70
COUNTDOWN=60
```

## 重要特性

### 1. 每轮重置
序列计数器在每轮用例执行开始时自动重置。

**场景**：用例设置 `runCount: 3`，每轮都从初始值开始

```json
{
  "name": "压力测试",
  "runCount": 3,
  "children": [
    {
      "type": "command",
      "content": "AT+TEST=${seq:1:1}",
      "repeatCount": 3
    }
  ]
}
```

**实际发送**：
```
第1轮:
  AT+TEST=1
  AT+TEST=2
  AT+TEST=3

第2轮:
  AT+TEST=1  # 重置，重新从 1 开始
  AT+TEST=2
  AT+TEST=3

第3轮:
  AT+TEST=1
  AT+TEST=2
  AT+TEST=3
```

### 2. 独立计数
不同参数组合的序列生成器各自独立计数，互不干扰。

```
${seq:60:20}   # 计数器 A: 60, 80, 100...
${seq:60:10}   # 计数器 B: 60, 70, 80...（不同步长，独立计数）
${seq:0:1}     # 计数器 C: 0, 1, 2...
```

### 3. 与其他变量混用

序列生成器可以与提取型变量、随机生成器混合使用：

```json
{
  "type": "command",
  "content": "AT+REQ=${seq:1:1},${token},${rand:hex:4}"
}
```

其中：
- `${seq:1:1}` - 序列递增：1, 2, 3...
- `${token}` - 从响应提取的变量
- `${rand:hex:4}` - 随机生成 8 位十六进制字符

## 典型应用场景

### 场景 1：HTTP 超时递增测试
```json
{
  "name": "HTTP 超时测试",
  "children": [
    {
      "type": "command",
      "content": "AT+HTTPGET=${seq:60:20:180}",
      "repeatCount": 7,
      "validation": "standard"
    }
  ]
}
```
测试 60、80、100...180 秒的超时参数，找到最佳值。

### 场景 2：功率等级扫描
```json
{
  "name": "功率扫描",
  "children": [
    {
      "type": "command",
      "content": "AT+TXPOWER=${seq:0:5:30}",
      "repeatCount": 7
    },
    {
      "type": "command",
      "content": "AT+MEASURE",
      "validation": "standard"
    }
  ]
}
```
从 0 到 30 dBm，每 5 dBm 测量一次信号质量。

### 场景 3：数据包大小测试
```json
{
  "name": "包大小测试",
  "children": [
    {
      "type": "command",
      "content": "AT+SEND=${seq:64:64:1024},${rand:hex:${seq:64:64:1024}}",
      "repeatCount": 15
    }
  ]
}
```
测试 64、128、192...1024 字节的数据包传输。

## 技术细节

- **正则表达式**：`/\$\{seq:(-?\d+):(-?\d+)(?::(-?\d+))?\}/g`
- **支持负数**：起始值、步长、最大值均可为负数
- **上限检查**：超过最大值时保持最大值，不会溢出
- **状态存储**：计数器存储在 `ExecutionContext.sequenceCounters` Map 中
- **重置时机**：根用例每轮执行开始时（`runCount` 循环的每次迭代）

## 注意事项

1. **参数必须为整数**：不支持小数（如 `${seq:1.5:0.1}` 无效）
2. **步长不能为 0**：会导致计数器停滞
3. **上限仅适用于正向递增**：负步长时上限检查可能不符合预期
4. **区分大小写**：必须使用小写 `seq`，`${SEQ:1:1}` 不会被识别

## 更新日志

- **v0.2.3** (2026-08-18): 新增序列生成器功能，支持 `${seq:start:step}` 和 `${seq:start:step:max}` 语法
