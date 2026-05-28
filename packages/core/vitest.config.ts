import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // 三十六收工 R2 Phase D:dummy DATABASE_URL,防 @ss/db 模块顶部 createPrisma() throw
    setupFiles: ['./vitest.setup.ts'],
  },
});
