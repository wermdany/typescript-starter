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

/**
 * 布尔环境变量。
 *
 * 不用 `z.coerce.boolean()`：`Boolean('false') === true`，字符串 'false' 会被当成开启。
 * 这里只接受 `true` / `false`（忽略大小写与首尾空白），缺失或空串取 `fallback`。
 */
function envBoolean(fallback = false) {
  return z
    .preprocess(
      (raw) =>
        raw === undefined || raw === ''
          ? fallback
          : typeof raw === 'string'
            ? raw.trim().toLowerCase()
            : raw,
      z.union([z.boolean(), z.literal('true'), z.literal('false')]),
    )
    .transform((v) => v === true || v === 'true');
}

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
  /** 是否把请求体写进日志（脱敏 + 截断），默认关闭；只接受 true/false（其余值报错） */
  LOG_BODY: envBoolean(),

  // ─── 文件存储 ─────────────────────────────────────────────
  /**
   * 上传文件的落盘根目录（相对路径按进程 cwd 解析）。
   *
   * 只有本地存储实现（`common/storage/local-storage.ts`）读它；换成对象存储后
   * 这个值不再生效，但配置项保留 —— 换回本地实现（如测试环境）不需要改代码。
   * 业务侧的上传策略（大小上限、允许的类型）在 `modules/file/upload-policy.ts`，
   * 那些不随部署环境变化，因此不走环境变量。
   */
  FILE_STORAGE_DIR: z
    .string()
    .default('files')
    .transform((v) => v.trim())
    .pipe(z.string().min(1)),

  // ─── 接口文档 ─────────────────────────────────────────────
  /**
   * 是否挂载 OpenAPI 文档（`/<SWAGGER_PATH>`）。
   *
   * 默认关闭；`NODE_ENV=development` 时自动开启（见 `common/openapi/setup.ts`）。
   * 生产环境要开必须显式设 `true`，且只放内网 —— 文档站直接挂在 express 上，
   * **不经过 `AccessGuard`**。
   */
  SWAGGER_ENABLED: envBoolean(),
  /** 文档路径（首尾斜杠会被去掉）；JSON 在 `/<path>/json`，UI 在 `/<path>` */
  SWAGGER_PATH: z
    .string()
    .default('api-docs')
    .transform((v) => v.trim()),
  DATABASE_URL: z.url(),

  // ─── 数据库连接池 ───────────────────────────────────────────
  /** 连接池上限 */
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // ─── RBAC ─────────────────────────────────────────────────
  /**
   * 「角色 → 权限码」缓存（Tier-1）的有效期（秒）。
   *
   * 只约束角色授权表；用户的角色集合不缓存（每次请求随会话查库），
   * 因此给用户增删角色是下一次请求即生效，不受该值影响。
   */
  RBAC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // 业务配置（登录会话 / 登录安全 / Cookie 策略）不在这里：
  // 见 `app-config.ts`（业务配置独立于环境变量，业务层 `@Inject(APP_CONFIG)` 注入）
});

export type Env = z.infer<typeof envSchema>;

/**
 * 直接用 zod 解析 `process.env`，失败时列出所有缺失/非法变量。
 *
 * 供 `main.ts` 在 DI 容器就绪之前取日志配置使用；业务代码用 `ConfigService`。
 */
/** 已解析的 env 缓存：process.env 在进程生命周期内不会变，解析一次即可 */
let cachedEnv: Env | undefined;

export function loadEnv(): Env {
  cachedEnv ??= (() => {
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
  })();
  return cachedEnv;
}
