import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // 包内 test 路径(src/**/*.test.ts + provider/**/*.test.ts 兼容现有 + 未来扩展)
    include: ['src/**/*.{test,spec}.ts', 'provider/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
  },
});
