import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // 多页应用配置：主窗口 + 工具箱窗口
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        toolbox: path.resolve(__dirname, "toolbox.html"),
      },
    },
  },
});
