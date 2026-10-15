import { z } from 'zod';
import { config as loadEnvConfig } from 'dotenv';

/**
 * 环境变量 Schema —— 所有环境变量集中在此定义
 *
 * 规则：
 * - 必填变量：不写 .default()，启动时缺失会 fail-fast
 * - 可选变量：用 .default() 或 .optional() 声明
 * - 非字符串值（如端口）：用 z.coerce 自动转换
 */

loadEnvConfig();

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z
    .enum(['debug', 'verbose', 'log', 'warn', 'error', 'fatal'])
    .default('log'),
  LOG_FILE: z.string().min(1).optional(),
  // 示例：后续新增变量在此追加
  DATABASE_URL: z.url(),
  // JWT_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof envSchema>;

/**
 * ConfigModule 的 drizzle 归一化环境变量
 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `环境变量校验失败，请检查 .env 文件或部署环境的注入：\n${errors}\n` +
        `参考 .env.example 了解各变量的说明。`,
    );
  }
  return result.data;
}
