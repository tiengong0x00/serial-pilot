import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 测试配置（Tauri 应用）
 *
 * 运行方式：
 * 1. 启动开发服务器：npm run tauri:dev
 * 2. 等待应用窗口打开
 * 3. 运行测试：npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Tauri 应用单实例，串行执行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // 单进程，避免多实例冲突
  reporter: 'html',

  use: {
    // Tauri dev 的前端地址
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Tauri webview 基于系统浏览器，但测试用 Chromium 模拟
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  /* 可选：自动启动 Tauri dev（实验性）
  webServer: {
    command: 'npm run tauri:dev',
    url: 'http://localhost:1420',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  */
});
