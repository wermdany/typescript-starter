import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/config/env.js';

const env = loadEnv();

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
