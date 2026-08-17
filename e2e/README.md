# E2E 测试指南

## 前提条件
1. Chromium 已安装：`npx playwright install chromium`
2. 前端开发服务器运行中：`npm run dev`（仅前端）或 `npm run tauri:dev`（完整应用）

## 运行 E2E 测试

### 方式一：仅前端测试（无 Tauri 后端）
适合测试 UI 交互、路由、组件渲染等不涉及串口硬件的功能。

```bash
# 终端 1：启动前端
npm run dev

# 终端 2：运行 E2E 测试
npm run test:e2e
```

**限制**：
- Tauri `invoke` 命令会失败（无后端响应）
- 串口连接、数据收发等功能无法测试
- 适合测试纯前端交互

### 方式二：完整 Tauri 应用测试
测试真实应用，包含串口功能（需要虚拟串口或真实硬件）。

```bash
# 终端 1：启动 Tauri 应用
npm run tauri:dev

# 终端 2：运行 E2E 测试
npm run test:e2e
```

**注意**：Playwright 连接的是 `http://localhost:1420`（Tauri 内嵌的前端），但 Tauri 的 webview 与真实浏览器有差异，部分交互可能不一致。

### 调试模式

```bash
# UI 模式（可视化测试运行器）
npm run test:e2e:ui

# 调试模式（逐步执行，暂停截图）
npm run test:e2e:debug
```

## 编写 E2E 测试

测试文件位于 `e2e/` 目录，命名为 `*.spec.ts`。

### 示例：测试输入框交互

```typescript
import { test, expect } from '@playwright/test';

test('应能输入并清空命令', async ({ page }) => {
  await page.goto('/');
  
  const input = page.getByPlaceholder(/输入命令/i);
  await input.fill('AT+CSQ');
  await expect(input).toHaveValue('AT+CSQ');
  
  await input.clear();
  await expect(input).toHaveValue('');
});
```

### 示例：测试串口连接（需 Tauri 后端）

```typescript
test('应能连接串口', async ({ page }) => {
  await page.goto('/');
  
  // 选择串口
  const portSelect = page.locator('select').first();
  await portSelect.selectOption('COM5');
  
  // 点击连接
  const connectBtn = page.getByRole('button', { name: /连接/i });
  await connectBtn.click();
  
  // 验证连接状态
  await expect(page.getByText(/已连接/i)).toBeVisible({ timeout: 5000 });
});
```

## 最佳实践

1. **页面对象模式**：复杂页面封装成 Page Object，避免重复选择器
2. **等待策略**：用 `waitForLoadState('networkidle')` 等待页面稳定
3. **容错选择器**：用正则 `/发送|send/i` 支持中英文
4. **截图失败**：配置已开启 `screenshot: 'only-on-failure'`
5. **串行执行**：Tauri 单实例，`workers: 1` 避免冲突

## 限制与已知问题

- **Tauri webview 差异**：Playwright 测试的是 Chromium，真实 Tauri 用的是系统 webview（Windows 用 WebView2），行为可能不同
- **串口硬件依赖**：测试真实串口功能需要物理设备或虚拟串口对（如 com0com）
- **窗口管理**：Tauri 多窗口需单独配置，当前仅测主窗口
- **自动启动限制**：`webServer` 自动启动 `tauri:dev` 在 Windows 可能不稳定，建议手动启动

## 报告

测试完成后生成 HTML 报告：
```bash
npx playwright show-report
```
