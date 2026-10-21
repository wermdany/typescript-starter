import { z } from 'zod';

/**
 * 业务配置 —— **业务/领域配置的唯一出处**，与 `env.ts` 明确分工：
 *
 * - `env.ts` —— **底层/运维配置**（随部署环境变化，写 .env）：日志、数据库、端口，
 *   由 `ENV` provider 注入，键名与环境变量一一对应
 * - 本文件 —— **业务/领域配置**（登录会话与登录策略，不随部署环境变化，写在代码里）：
 *   业务层 `@Inject(APP_CONFIG)` 拿打平的 camelCase 字段，感知不到环境变量
 *
 * 新增业务配置项：在 `appConfigSchema` 声明字段，在下方 `appConfigSource` 给值，
 * 启动时经 zod 校验 fail-fast。
 */

/** 分钟 → 毫秒 / 天 → 毫秒 */
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

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
});
