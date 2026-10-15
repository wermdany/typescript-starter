import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // e2e 不依赖 .env 文件：必填变量在此注入测试占位值
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    },
  },
});
