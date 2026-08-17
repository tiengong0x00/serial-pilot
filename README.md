# Serial Pilot

一款面向嵌入式开发的串口调试与自动化测试工具，基于 Tauri 2 + React 构建。

A serial port debugging and automated testing tool for embedded development, built with Tauri 2 + React.

## 功能特性 / Features

- 🔌 双串口独立连接管理（P1/P2）/ Dual serial port management
- 📝 测试用例编排与自动化执行 / Test case orchestration & automation
- 🧰 内置工具箱（Hex/Base64/CRC/进制转换/网络工具等）/ Built-in toolbox
- 🎨 可定制终端主题、背景图、高亮规则 / Customizable terminal theme & highlighting
- 🌏 中英文界面 / Chinese & English UI
- 🔄 手动检查更新 / Manual update check

## 安装 / Installation

从 [Releases](../../releases) 页面下载最新的 `.msi` 安装包。

Download the latest `.msi` installer from the [Releases](../../releases) page.

> **注意 / Note**: 当前版本未配置代码签名证书，首次安装时 Windows SmartScreen 会弹出警告。请点击「更多信息」→「仍要运行」继续安装。
>
> This release is not code-signed yet. Windows SmartScreen will show a warning on first install. Click "More info" → "Run anyway" to proceed.

## 开发 / Development

```bash
# 安装依赖 / Install dependencies
npm install

# 开发模式 / Dev mode
npm run tauri:dev

# 构建 / Build
npm run tauri:build

# 测试 / Test
npm test
```

## 技术栈 / Tech Stack

- **前端 / Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **后端 / Backend**: Tauri 2, Rust
- **测试 / Testing**: Vitest, Playwright

## 许可证 / License

[MIT](LICENSE)
