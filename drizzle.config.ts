import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/config/env.js';

const env = loadEnv();

export default defineConfig({
  out: './drizzle',
  schema: './src/database/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
