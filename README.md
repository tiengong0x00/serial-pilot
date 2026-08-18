# Serial Pilot / 串口领航员

<div align="center">

一款面向嵌入式开发的专业串口调试与自动化测试工具

A professional serial port debugging and automated testing tool for embedded development

[English](#english) | [中文](#中文)

</div>

---

## English

### 📖 Introduction

Serial Pilot is a powerful desktop application designed for embedded developers and hardware engineers. It provides comprehensive serial port debugging capabilities with advanced automation features, built on modern web technologies (Tauri 2 + React).

### ✨ Features

- **🔌 Multi-Port Management**
  - Dual serial port independent connection (P1/P2)
  - Batch port configuration and operation
  - Real-time data monitoring with filtering

- **🧪 Test Automation**
  - Visual test case editor and manager
  - Automated test execution with assertions
  - Custom script and command sequences
  - Comprehensive test reports and logs

- **🛠️ Built-in Toolbox**
  - Data format conversion (Hex, Base64, Binary, Decimal)
  - Checksum calculators (CRC8/16/32, XOR, Sum)
  - Network utilities (Ping, Port Scanner)
  - Regular expression tester

- **🎨 Customization**
  - Terminal themes and background images
  - Syntax highlighting with custom rules
  - Flexible keyboard shortcuts
  - Workspace layout persistence

- **🌍 Internationalization**
  - Chinese and English UI
  - Easy language switching

- **🔄 Auto-Update**
  - Built-in update checker
  - Secure signature verification
  - Background download with progress
  - One-click installation

### 📦 Installation

Download the latest installer from the [Releases](../../releases) page:

- **Windows**: `serial-pilot.exe` (portable) or `.msi` installer
- **Recommended**: Use the signed portable executable for auto-update support

> **Note**: If Windows SmartScreen shows a warning, click "More info" → "Run anyway" to proceed.

### 🚀 Quick Start

1. Launch Serial Pilot
2. Select a COM port from the dropdown
3. Configure baud rate and other parameters
4. Click "Connect" to start debugging
5. Use the built-in terminal or test cases for automation

### 🔧 Development

```bash
# Clone the repository
git clone https://github.com/tiengong0x00/serial-pilot.git
cd serial-pilot

# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build

# Run tests
npm test
```

### 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **Backend**: Tauri 2, Rust, tokio-serial
- **Testing**: Vitest, Playwright
- **Build**: GitHub Actions

### 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 中文

### 📖 项目介绍

串口领航员是一款专为嵌入式开发者和硬件工程师设计的强大桌面应用。它提供全面的串口调试功能，并结合先进的自动化测试特性，基于现代 Web 技术（Tauri 2 + React）构建。

### ✨ 功能特性

- **🔌 多串口管理**
  - 双串口独立连接管理（P1/P2）
  - 批量端口配置与操作
  - 实时数据监控与高级过滤

- **🧪 测试自动化**
  - 可视化测试用例编辑器与管理器
  - 带断言的自动化测试执行
  - 自定义脚本与命令序列
  - 完整的测试报告与日志记录

- **🛠️ 内置工具箱**
  - 数据格式转换（十六进制、Base64、二进制、十进制）
  - 校验和计算器（CRC8/16/32、异或、求和）
  - 网络工具（Ping、端口扫描）
  - 正则表达式测试器

- **🎨 个性化定制**
  - 终端主题与背景图片
  - 自定义语法高亮规则
  - 灵活的快捷键系统
  - 工作区布局持久化

- **🌍 国际化支持**
  - 中英文界面
  - 便捷的语言切换

- **🔄 自动更新**
  - 内置更新检查器
  - 安全的签名验证
  - 后台下载与进度显示
  - 一键安装升级

### 📦 安装说明

从 [Releases](../../releases) 页面下载最新的安装包：

- **Windows**: `serial-pilot.exe`（绿色版）或 `.msi` 安装包
- **推荐**: 使用签名的绿色版可执行文件以支持自动更新

> **注意**: 如果 Windows SmartScreen 显示警告，点击「更多信息」→「仍要运行」继续。

### 🚀 快速开始

1. 启动串口领航员
2. 从下拉菜单选择 COM 端口
3. 配置波特率等参数
4. 点击「连接」开始调试
5. 使用内置终端或测试用例进行自动化操作

### 🔧 开发说明

```bash
# 克隆仓库
git clone https://github.com/tiengong0x00/serial-pilot.git
cd serial-pilot

# 安装依赖
npm install

# 开发模式运行
npm run tauri:dev

# 生产构建
npm run tauri:build

# 运行测试
npm test
```

### 🛠️ 技术栈

- **前端**: React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **后端**: Tauri 2, Rust, tokio-serial
- **测试**: Vitest, Playwright
- **构建**: GitHub Actions

### 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。
