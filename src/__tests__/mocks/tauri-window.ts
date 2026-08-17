import { vi } from 'vitest';

// Mock @tauri-apps/api/window
export const getCurrentWindow = vi.fn(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
}));

export const appWindow = getCurrentWindow();
