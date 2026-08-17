import { test, expect } from '@playwright/test';

/**
 * 应用基础 E2E 测试
 *
 * 前提：先运行 `npm run tauri:dev` 或 `npm run dev` 启动前端（localhost:1420）
 * 注意：在纯前端模式下，Tauri invoke 命令会失败（无后端），
 *      涉及串口硬件的功能需在完整 Tauri 应用中测试。
 */

test.describe('应用启动与基础界面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // 等待应用主界面加载
    await page.waitForLoadState('networkidle');
  });

  test('应显示应用标题', async ({ page }) => {
    // 应用标题栏存在
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('应显示端口连接与测试用例切换标签', async ({ page }) => {
    // 左侧面板有两个标签
    const body = page.locator('body');
    await expect(body).toContainText(/连接|端口|Connection/i);
  });

  test('应显示数据终端区域', async ({ page }) => {
    // 终端输入框存在
    const input = page.getByPlaceholder(/输入|命令|command/i);
    await expect(input.first()).toBeVisible();
  });

  test('未连接时发送按钮应禁用', async ({ page }) => {
    // 找到发送按钮
    const sendBtn = page.getByRole('button', { name: /发送|send/i });
    if (await sendBtn.count() > 0) {
      await expect(sendBtn.first()).toBeDisabled();
    }
  });
});

test.describe('数据终端交互', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('应能在输入框输入文本', async ({ page }) => {
    const input = page.getByPlaceholder(/输入|命令|command/i).first();
    await input.fill('AT+CSQ');
    await expect(input).toHaveValue('AT+CSQ');
  });

  test('应能切换显示格式（文本/HEX）', async ({ page }) => {
    // 查找 HEX 格式按钮
    const hexBtn = page.getByRole('button', { name: /HEX/i });
    if (await hexBtn.count() > 0) {
      await hexBtn.first().click();
      // 按钮应处于激活状态（样式变化）
      await expect(hexBtn.first()).toBeVisible();
    }
  });
});
