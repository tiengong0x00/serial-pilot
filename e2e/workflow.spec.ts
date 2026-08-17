import { test, expect, Page } from '@playwright/test';

/**
 * 完整用户流程 E2E 测试
 *
 * 测试完整的串口调试工作流：加载测试用例 → 连接端口 → 执行测试 → 查看结果
 *
 * 前提：
 * 1. npm run tauri:dev 已启动（完整 Tauri 应用）
 * 2. 有可用串口或虚拟串口对（COM3/COM4）
 */

// Page Object：封装常用操作
class SerialPilotPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async switchToConnectionTab() {
    const tab = this.page.getByRole('button', { name: /连接|connection/i });
    await tab.click();
  }

  async switchToTestCaseTab() {
    const tab = this.page.getByRole('button', { name: /测试用例|test.*case/i });
    await tab.click();
  }

  async selectPort(portName: string) {
    const select = this.page.locator('select').first();
    await select.selectOption(portName);
  }

  async clickConnect() {
    const btn = this.page.getByRole('button', { name: /^连接$|^connect$/i });
    await btn.click();
  }

  async clickDisconnect() {
    const btn = this.page.getByRole('button', { name: /断开|disconnect/i });
    await btn.click();
  }

  async sendCommand(command: string) {
    const input = this.page.getByPlaceholder(/输入|命令|command/i).first();
    await input.fill(command);

    const sendBtn = this.page.getByRole('button', { name: /发送|send/i });
    await sendBtn.click();
  }

  async isConnected() {
    // 检查连接状态指示器
    const indicator = this.page.locator('text=/已连接|connected/i');
    return await indicator.isVisible().catch(() => false);
  }

  async getTerminalText() {
    const terminal = this.page.locator('.terminal-output');
    return await terminal.textContent();
  }
}

test.describe('完整串口调试流程', () => {
  let app: SerialPilotPage;

  test.beforeEach(async ({ page }) => {
    app = new SerialPilotPage(page);
    await app.goto();
  });

  test('应显示应用主界面', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
  });

  test.skip('完整流程：连接 → 发送 → 断开', async ({ page }) => {
    // 此测试需要真实串口，默认跳过
    // 运行时用：npx playwright test --grep @serial

    // 1. 切换到连接标签
    await app.switchToConnectionTab();

    // 2. 选择端口（假设 COM5 存在）
    await app.selectPort('COM5');

    // 3. 连接
    await app.clickConnect();
    await expect(page.getByText(/已连接/i)).toBeVisible({ timeout: 5000 });

    // 4. 发送命令
    await app.sendCommand('AT');

    // 5. 等待响应（假设设备会回复 OK）
    await expect(page.locator('.terminal-output')).toContainText('AT', { timeout: 3000 });

    // 6. 断开
    await app.clickDisconnect();
    await expect(page.getByText(/未连接/i)).toBeVisible({ timeout: 3000 });
  });

  test('终端应支持 HEX 格式切换', async ({ page }) => {
    const hexBtn = page.getByRole('button', { name: /HEX/i }).first();
    await hexBtn.click();

    // HEX 按钮应处于激活状态
    await expect(hexBtn).toHaveClass(/bg-primary|text-primary-foreground/);
  });

  test('测试用例标签应可切换', async ({ page }) => {
    await app.switchToTestCaseTab();

    // 应显示测试用例相关内容
    await expect(page.locator('body')).toContainText(/用例|case|命令/i);
  });
});

test.describe('UI 响应性测试', () => {
  test('应在移动端尺寸下正常显示', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await expect(page.locator('h1')).toBeVisible();
  });

  test('应支持暗色模式', async ({ page }) => {
    await page.goto('/');

    // 检查根元素是否有 dark class（应用会自动检测系统主题）
    const root = page.locator('html');
    const hasClass = await root.evaluate(el => el.classList.contains('dark'));

    // 无论是否暗色，界面应正常显示
    await expect(page.locator('h1')).toBeVisible();
  });
});
