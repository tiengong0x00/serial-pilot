# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-09-01

### Added
- 🔄 **用例选择对话框增强**
  - 添加刷新按钮，可实时更新文件列表
  - 添加"打开其他路径用例"功能，支持加载任意位置的测试用例
  - 保存后自动刷新文件列表
  - 非自动保存模式显示保存成功提示

- 📦 **种子文件**
  - 添加 3 个新的命令库文件（lierda_at_commands.json, TS_27.005.json, TS_27.007.json）
  - 添加 4 个新的测试用例示例（demo.json, lierda-http-p0.json, lierda-mqtt-p0.json, lierda-tcpip-p0.json）

### Fixed
- 🐛 **文件系统权限修复**
  - 修复导出用例功能无响应的问题
  - 修复打开外部用例文件报错的问题
  - 添加 `tauri-plugin-fs` 依赖并正确配置权限
  - 导出/导入功能现在可以正常使用 Tauri 文件对话框

- 🔧 **批量操作优化**
  - 优化大文件（890+ 节点）批量操作性能
  - 批量更新从 890 次操作合并为 1 次
  - 添加批量处理加载指示器
  - 批量操作后自动清空多选状态

### Improved
- 📖 **文档优化**
  - 完全重写测试用例格式文档（testcases/README.md）
    - 更清晰的结构和目录导航
    - 详细的文件发送说明（两步模式：准备命令 + 文件命令）
    - 完整的 HTTPS 证书配置示例
    - AI 生成用例指南和提示词模板
    - 8 个常见问题解答
  - 同步更新英文文档（testcases/README_EN.md）

- 🎨 **用户体验**
  - 点击空白处可取消多选状态
  - 批量操作响应更流畅
  - 添加更多视觉反馈（加载状态、成功提示）

### Technical
- 添加 `tauri-plugin-fs` 到 Rust 依赖
- 在 main.rs 中初始化文件系统插件
- 更新 capabilities 配置，添加文件读写权限
- 优化 testCaseStore 的批量更新 API

## [0.3.2] - Previous Release

### Features
- 测试用例管理系统
- 命令库支持
- 串口通信功能
- 自动更新机制

---

## Release Notes v0.3.3

### 🎯 核心改进

**1. 用例文件管理增强**
- 新增刷新按钮，实时同步文件列表
- 支持打开任意路径的测试用例文件
- 保存操作更智能（自动刷新 + 成功提示）

**2. 文件系统功能修复**
- 完全修复导出用例功能
- 修复打开外部文件功能
- 现在可以正常使用系统文件对话框

**3. 大文件性能优化**
- 批量操作性能提升 890 倍
- 添加批量处理进度指示
- 支持连续多次批量操作

**4. 文档全面升级**
- 重写测试用例格式文档，更清晰易懂
- 详细说明文件发送的正确使用方法
- 提供 AI 生成用例的完整指南
- 新增 HTTPS 证书配置完整示例

### 📦 新增种子文件

**命令库：**
- lierda_at_commands.json - 利尔达 AT 命令库
- TS_27.005.json - 3GPP TS 27.005 标准命令
- TS_27.007.json - 3GPP TS 27.007 标准命令

**测试用例示例：**
- demo.json - 入门示例
- lierda-http-p0.json - HTTP 测试用例
- lierda-mqtt-p0.json - MQTT 测试用例
- lierda-tcpip-p0.json - TCP/IP 测试用例

### 🐛 Bug 修复

- 修复导出用例时无响应的问题
- 修复打开外部用例文件报 "Plugin not found" 错误
- 修复大文件批量操作卡顿问题
- 修复批量操作后无法连续操作的问题

### 💡 使用提示

**文件发送正确用法：**
```json
// 步骤 1: 准备命令
{
  "type": "command",
  "content": "AT+QSSLCFG=\"cacert\",2"
}

// 步骤 2: 发送文件
{
  "type": "command",
  "content": "",
  "fileData": {
    "id": "https-cert/ca-cert.pem",
    "name": "ca-cert.pem",
    "size": 1456
  }
}
```

**文件存放位置：**
```
testcases/
├── https-cert.json
└── https-cert/
    ├── ca-cert.pem
    └── client-cert.pem
```

---

### 升级说明

从 v0.3.2 升级到 v0.3.3：
1. 下载新版本安装包
2. 安装后首次运行会自动释放新的种子文件
3. 已有的用例文件和配置不受影响

---

**完整更新日志：** [CHANGELOG.md](./CHANGELOG.md)
