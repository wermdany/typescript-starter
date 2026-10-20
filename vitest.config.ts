import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // 测试与被测代码同目录，统一放 __tests__
    include: ['src/**/__tests__/**/*.spec.ts'],
    coverage: {
      exclude: ['**/__tests__/**'],
    },
  },
});
