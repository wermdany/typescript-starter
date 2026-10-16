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

/** 布尔环境变量的真值词表；其余合法词（false/0/no/off）一律为假 */
const TRUTHY_WORDS = new Set(['true', '1', 'yes', 'on']);

/**
 * 布尔环境变量解析器 —— **不要用 `z.coerce.boolean()`**。
 *
 * `z.coerce.boolean()` 等价于 `Boolean(value)`，而环境变量永远是字符串，
 * 于是 `Boolean('false') === true`：`.env` 里明明写了 `LOG_BODY=false`，结果却被判为开启。
 *
 * 这里先把值归一化，再用 `z.enum` 校验：非法值走标准 issue（`loadEnv()` / ConfigModule
 * 能统一聚合报错），而**不是在 transform 里 throw** —— zod v4 的 transform 抛错不会被
 * `safeParse` 接住，会直接冒泡，破坏上面那套错误聚合。
 */
const envBoolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => raw?.trim().toLowerCase() ?? '')
    .pipe(
      z.union([
        z.literal(''),
        z.enum(['true', '1', 'yes', 'on', 'false', '0', 'no', 'off']),
      ]),
    )
    .transform((word) => (word === '' ? defaultValue : TRUTHY_WORDS.has(word)));

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z
    .enum(['debug', 'verbose', 'log', 'warn', 'error', 'fatal'])
    .default('log'),
  // 日志文件路径（相对路径按 cwd 解析）。默认落盘到 logs/app.log；
  // 显式置空（LOG_FILE=）表示只输出控制台 —— 用空串而不是删掉这一行，语义更直白
  LOG_FILE: z
    .string()
    .default('logs/app.log')
    .transform((v) => v.trim()),
  // 是否把请求体写进日志（脱敏 + 截断）。默认关闭 —— 生产环境不宜默认落请求体，
  // 需要排查"写操作为何失败"时显式设为 true
  LOG_BODY: envBoolean(false),
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
        `各变量的含义与默认值见本文件顶部的 schema 注释。`,
    );
  }
  return result.data;
}
