import { z } from 'zod';

/**
 * 业务配置 —— **业务/领域配置的唯一出处**，与 `env.ts` 明确分工：
 *
 * - `env.ts` —— **底层/运维配置**（随部署环境变化，写 .env）：日志、数据库、端口，
 *   由 `ENV` provider 注入，键名与环境变量一一对应
 * - 本文件 —— **业务/领域配置**（登录会话、登录策略、HTTP 幂等窗口，不随部署环境变化，
 *   写在代码里）：业务层 `@Inject(APP_CONFIG)` 拿打平的 camelCase 字段，感知不到环境变量
 *
 * 新增业务配置项：在 `appConfigSchema` 声明字段，在下方 `appConfigSource` 给值，
 * 启动时经 zod 校验 fail-fast。
 */

/** 分钟 → 毫秒 / 天 → 毫秒 */
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** AppConfig 的 DI provider token（业务层 `@Inject(APP_CONFIG)` 注入用） */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** 业务配置 schema：字段即业务视角（毫秒、布尔），不做环境变量换算 */
export const appConfigSchema = z.object({
  // ─── 登录会话 ───
  /** accessToken 有效期（毫秒）：短，泄露窗口小，由前端静默续期 */
  accessTtlMs: z.number().int().positive(),
  /** refreshToken 有效期（毫秒）：长，决定"多久不操作才需要重新登录" */
  refreshTtlMs: z.number().int().positive(),
  /** 每次续期是否把 refreshToken 的有效期顺延（有活动就不掉线） */
  slidingRefresh: z.boolean(),
  /** 前端提前续期窗口（毫秒）：剩余有效期低于它时主动刷新 */
  refreshWindowMs: z.number().int().positive(),
  /** 单用户并发会话上限，超出时淘汰最久未使用的一条 */
  maxSessionsPerUser: z.number().int().positive(),

  // ─── 登录安全 ───
  /** 登录失败限流：窗口内最大失败次数（按 学号 + IP 统计） */
  loginMaxAttempts: z.number().int().positive(),
  /** 登录失败限流的统计窗口（毫秒） */
  loginWindowMs: z.number().int().positive(),
  /** 客户端 IP 是否取代理头（部署在可信反向代理之后才开启） */
  trustProxy: z.boolean(),

  // ─── refreshToken Cookie ───
  /** RT 走 HttpOnly Cookie（关闭则退回 body/header 传 RT，供非浏览器客户端） */
  refreshCookieEnabled: z.boolean(),

  // ─── 全局限流 ───
  //
  // 与「登录安全」是两层：`loginMaxAttempts` 挡撞库（按学号 + IP，查库统计），
  // 这里挡"一个来源打爆所有接口"（按 IP 计令牌，不碰数据库）。
  /** 令牌桶容量 = 允许的瞬时突发请求数 */
  rateLimitBurst: z.number().int().positive(),
  /**
   * 每秒补充的令牌数 = 长期平均速率上限。
   *
   * 部署在共享出口后面（校园网 / 企业 NAT，成百上千人同一个 IP）时必须上调，
   * 否则会把正常用户一起限掉；此时更该补一层"认证之后按用户限流"。
   */
  rateLimitRefillPerSecond: z.number().int().positive(),
  /** 内存里最多保留多少个来源的桶；超出后按最久未使用淘汰 */
  rateLimitMaxKeys: z.number().int().positive(),

  // ─── HTTP 幂等 ───
  //
  // 这三个键刻意**不走环境变量**：它们只影响"重复提交"这一种边缘路径，
  // 不属于运维视角需要按环境调整的底层配置（对照 `env.ts`）。改动上线走代码评审，
  // 同时避免 `.env.example` 与 envSchema 的同步成本。
  /** 成功快照的保留时长（毫秒）：超过后同一个 `Idempotency-Key` 视为新请求 */
  idempotencyTtlMs: z.number().int().positive(),
  /** 内存幂等表的条目上限（插入序淘汰最旧一条），防无界增长 */
  maxEntries: z.number().int().positive(),
  /** in-flight 占位的超时（毫秒）：超时视为陈旧允许接管，防进程内死锁 */
  inFlightTimeoutMs: z.number().int().positive(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/** 业务配置原始值（分钟/天等易读单位），经 schema 换算并校验后得到 AppConfig */
const appConfigSource = {
  accessTtlMinutes: 120,
  refreshTtlDays: 7,
  slidingRefresh: true,
  refreshWindowMinutes: 5,
  maxSessionsPerUser: 20,

  loginMaxAttempts: 10,
  loginWindowMinutes: 15,
  trustProxy: false,

  refreshCookieEnabled: true,

  // 突发 300 次、持续 20 次/秒（≈1200 次/分钟）。取值偏宽是刻意的：
  // 真洪水挡得住，共享出口的正常用户不至于被误伤
  rateLimitBurst: 300,
  rateLimitRefillPerSecond: 20,
  rateLimitMaxKeys: 10_000,

  idempotencyTtlHours: 24,
  maxEntries: 1000,
  inFlightTimeoutSeconds: 30,
} as const;

/**
 * 已校验的业务配置（模块加载时解析一次，非法值直接抛错 fail-fast）。
 * 时间统一换算为毫秒；`cookieSecure` 在使用处由 `NODE_ENV === 'production'` 派生，
 * 不作为独立配置项。
 */
export const appConfig: AppConfig = appConfigSchema.parse({
  accessTtlMs: appConfigSource.accessTtlMinutes * MINUTE_MS,
  refreshTtlMs: appConfigSource.refreshTtlDays * DAY_MS,
  slidingRefresh: appConfigSource.slidingRefresh,
  refreshWindowMs: appConfigSource.refreshWindowMinutes * MINUTE_MS,
  maxSessionsPerUser: appConfigSource.maxSessionsPerUser,

  loginMaxAttempts: appConfigSource.loginMaxAttempts,
  loginWindowMs: appConfigSource.loginWindowMinutes * MINUTE_MS,
  trustProxy: appConfigSource.trustProxy,

  refreshCookieEnabled: appConfigSource.refreshCookieEnabled,

  rateLimitBurst: appConfigSource.rateLimitBurst,
  rateLimitRefillPerSecond: appConfigSource.rateLimitRefillPerSecond,
  rateLimitMaxKeys: appConfigSource.rateLimitMaxKeys,

  idempotencyTtlMs: appConfigSource.idempotencyTtlHours * HOUR_MS,
  maxEntries: appConfigSource.maxEntries,
  inFlightTimeoutMs: appConfigSource.inFlightTimeoutSeconds * 1000,
});
