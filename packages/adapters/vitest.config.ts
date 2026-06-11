import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // 包内 test 路径(src/**/*.test.ts + provider/**/*.test.ts 兼容现有 + 未来扩展)
    include: ['src/**/*.{test,spec}.ts', 'provider/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    // H0:dummy DATABASE_URL — embedding 测试实例化 BaseProvider 子类拉到 @ss/db(同 core 模式)
    setupFiles: ['./vitest.setup.ts'],
  },
});
