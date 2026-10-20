import { z } from 'zod';
import { config as loadEnvConfig } from 'dotenv';

/**
 * 环境变量 schema —— 所有环境变量的唯一出处。
 *
 * - 必填变量不写 `.default()`，缺失时 fail-fast
 * - 可选变量用 `.default()` / `.optional()`
 * - 数字类变量用 `z.coerce.number()`
 */

loadEnvConfig();

/** 布尔环境变量的真值词表；其余合法词（false/0/no/off）一律为假 */
const TRUTHY_WORDS = new Set(['true', '1', 'yes', 'on']);

/**
 * 布尔环境变量解析器。**不要用 `z.coerce.boolean()`**：它等价 `Boolean(value)`，
 * 而环境变量是字符串，`.env` 里写 `LOG_BODY=false` 会被判成开启。
 *
 * 非法值交给 `z.enum` 报标准 issue，而不是在 transform 里 `throw` ——
 * zod v4 的 `safeParse` 不接 transform 抛出的错误。
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
  /** 日志文件路径（相对路径按 cwd 解析）；置空表示只输出控制台 */
  LOG_FILE: z
    .string()
    .default('logs/app.log')
    .transform((v) => v.trim()),
  /** 是否把请求体写进日志（脱敏 + 截断），默认关闭 */
  LOG_BODY: envBoolean(false),
  DATABASE_URL: z.url(),

  // ─── 数据库连接池 ───────────────────────────────────────────
  /** 连接池上限 */
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // ─── 登录会话 ───────────────────────────────────────────────
  /** accessToken 有效期（分钟）：短，泄露窗口小，由前端静默续期 */
  AUTH_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  /** refreshToken 有效期（天）：长，决定"多久不操作才需要重新登录" */
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** 每次续期是否把 refreshToken 的有效期顺延（有活动就不掉线） */
  AUTH_REFRESH_SLIDING: envBoolean(true),
  /** 前端提前续期窗口（分钟）：剩余有效期低于它时主动刷新 */
  AUTH_REFRESH_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
  /** 单用户并发会话上限，超出时淘汰最久未使用的一条 */
  AUTH_MAX_SESSIONS_PER_USER: z.coerce.number().int().positive().default(20),

  // ─── 登录安全 ───────────────────────────────────────────────
  /** 登录失败限流：窗口内最大失败次数（按 学号 + IP 统计） */
  AUTH_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  /** 登录失败限流的统计窗口（分钟） */
  AUTH_LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  /** 是否信任反向代理传来的 x-forwarded-for（默认不信任，客户端可伪造该头） */
  AUTH_TRUST_PROXY: envBoolean(false),
  /** refreshToken 是否经 HttpOnly Cookie 下发（关闭则退回纯 body/header 模式，供非浏览器客户端） */
  AUTH_REFRESH_COOKIE: envBoolean(true),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 直接用 zod 解析 `process.env`，失败时列出所有缺失/非法变量。
 *
 * 供 `main.ts` 在 DI 容器就绪之前取日志配置使用；业务代码用 `ConfigService`。
 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `环境变量校验失败，请检查 .env 文件或部署环境的注入：\n${errors}\n` +
        `各变量的含义与默认值见 src/config/env.ts 的 schema。`,
    );
  }
  return result.data;
}
