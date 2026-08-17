import { vi } from 'vitest';

// Mock @tauri-apps/api/event
export const listen = vi.fn(() => Promise.resolve(() => {}));
export const once = vi.fn(() => Promise.resolve(() => {}));
export const emit = vi.fn(() => Promise.resolve());

export type UnlistenFn = () => void;
