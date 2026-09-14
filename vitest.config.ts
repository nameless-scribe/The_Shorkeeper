import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 与 vite.config.ts 保持一致：renderer 组件可通过 @/ 引用 src 内的纯逻辑模块。
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // 默认 5s 对本仓库偏紧：不少用例要建临时库、跑 migration 或加载 better-sqlite3 /
    // ExcelJS 这类重依赖，单独跑都在 1–4s，但全量并发时会被拉长到 5s 以上而偶发失败
    // （实测 adapter-contract 与 progress-skill-validation 都中过）。
    // 放宽到 15s 只是消除并发抖动，真正的死循环或挂起仍然会被判失败。
    testTimeout: 15_000,
  },
});
