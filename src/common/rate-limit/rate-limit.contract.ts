import type { Request } from 'express';

/**
 * 全局限流的**纯契约**：文案、豁免路径、中间件选项。
 *
 * 与登录失败的限流是两件事，不要合并：
 * - 登录限流（`LoginLogService.countRecentFailures`）按「学号 + IP」查库统计，
 *   目的是挡撞库，代价是每请求一次 COUNT
 * - 全局限流（本目录）只按客户端 IP 计令牌，不碰数据库，
 *   目的是挡住"一个来源打爆所有接口"，不针对某一次业务动作
 *
 * 两者共存：登录接口先过全局那层（粗），进业务后再过登录那层（细）。
 */

/**
 * 全局限流被拒时的文案。
 *
 * 不复用 `TOO_MANY_ATTEMPTS_MESSAGE`：那句是"登录尝试过于频繁"，
 * 挂在 `GET /users` 上会让人以为账号有问题。
 */
export const RATE_LIMITED_MESSAGE = '请求过于频繁，请稍后再试';

/**
 * 不参与限流的前缀（按路径段边界匹配，`/health` 同时覆盖 `/health/ready`）。
 *
 * - `/health`：编排器与负载均衡的探针。被限流等于让健康检查失败，
 *   服务会被误判为下线并摘除流量 —— 这比"少挡几个请求"严重得多
 * - `/api-docs`：静态文档站，不是业务接口；本地调试时刷新几次就被 429 会很难用
 */
export const RATE_LIMIT_EXEMPT_PREFIXES = ['/health', '/api-docs'] as const;

/** 限流中间件的装配参数（由 `server.ts` 从 ENV / APP_CONFIG 组装后传入） */
export interface RateLimitOptions {
  /** 总开关。关闭时中间件只透传，不做任何统计 */
  readonly enabled: boolean;
  /** 令牌桶容量 = 允许的瞬时突发请求数 */
  readonly capacity: number;
  /** 每秒补充的令牌数 = 长期平均速率上限 */
  readonly refillPerSecond: number;
  /** 内存里最多保留多少个键（每个来源一个），超出后按最久未使用淘汰 */
  readonly maxKeys: number;
  /**
   * 键的取法，通常返回客户端 IP。
   *
   * 由调用方注入而不是在这里 import `@/shared/auth` 的 `resolveClientIp`：
   * `common/**` 不得依赖 `@/shared/*`（见 `http-stages.ts` 的分层不变式），
   * 而 IP 解析要跟随 `trustProxy` 配置，只有装配处同时知道这两件事。
   */
  readonly resolveKey: (req: Request) => string;
}
