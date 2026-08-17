import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tauri-apps/api/core': path.resolve(__dirname, './src/__tests__/mocks/tauri-core.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, './src/__tests__/mocks/tauri-event.ts'),
      '@tauri-apps/api/window': path.resolve(__dirname, './src/__tests__/mocks/tauri-window.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './src/__tests__/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/*',
        'src/main.tsx',
      ],
    },
  },
});
