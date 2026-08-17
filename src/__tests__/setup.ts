import { vi } from 'vitest';

// Mock sonner toast (用于 terminalStore 自动保存提示)
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// 仅在 jsdom 环境加载 jest-dom（组件测试）
if (typeof document !== 'undefined') {
  // @ts-expect-error - jest-dom 类型声明问题，运行时正常
  await import('@testing-library/jest-dom');
}

// Mock 其他 Tauri plugins
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
}));
