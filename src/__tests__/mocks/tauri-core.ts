import { vi } from 'vitest';

// Mock @tauri-apps/api/core
export const invoke = vi.fn();
export const convertFileSrc = vi.fn((path: string) => path);
export const transformCallback = vi.fn();
export const Channel = vi.fn();
