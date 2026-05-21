import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['packages/**/src/**', 'packages/**/storyboard/**', 'packages/**/generation/**'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
  },
});
