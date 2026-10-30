import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MemoryRateLimiter } from './memory-limiter.js';
import {
  RATE_LIMIT_EXEMPT_PREFIXES,
  RATE_LIMITED_MESSAGE,
  type RateLimitOptions,
} from './rate-limit.contract.js';

// 模块级即可：Logger 在每次调用时才解析当前注册的 logger 实例，能被 FileLogger 接管
const logger = new Logger('RateLimit');

/** Express 风格中间件签名（与 `http-stages.ts` 的 `RequestMiddleware` 结构一致） */
export type RateLimitMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

/**
 * 全局限流中间件（**P1，在认证之前**）。
 *
 * ## 为什么必须在认证之前
 *
 * 限流的价值是"用最便宜的动作挡住洪水"。放到守卫或拦截器里，每个被拦下的请求
 * 都已经走完 token 解析、`req.user` 注入，甚至一次会话查库 —— 攻击者用无效令牌
 * 就能让数据库忙起来，限流本身反而成了放大器。
 *
 * 位置由 `http-stages.ts` 的 `registerRequestStages()` 固定：紧接访问日志之后、
 * `cookieParser()` 之前。放在访问日志之后是为了让 429 也有一行 access 记录
 * （否则"为什么用户全在报错"查不到证据）。
 *
 * ## 为什么按 IP 而不是按用户
 *
 * 按用户要等认证完成，与上一条冲突；而且未登录请求根本没有用户可归。
 * 代价是**共享出口 IP 会被误伤**（校园网、企业 NAT 后所有用户同一个 IP），
 * 所以阈值默认给了较宽的突发容量 —— 部署在这种网络下要么上调
 * `rateLimitRefillPerSecond`，要么另加一层认证之后的按用户限流。
 *
 * ## 拒绝走全局过滤器
 *
 * 这里不自己写响应：`HttpExceptionFilter` 是失败响应的**唯一出口**，
 * 手写 `res.status().json()` 会绕开统一信封与 access 日志的失败摘要。
 */
export function createRateLimitMiddleware(
  options: RateLimitOptions,
): RateLimitMiddleware {
  const limiter = new MemoryRateLimiter(
    options.capacity,
    options.refillPerSecond,
    options.maxKeys,
  );

  return (req, res, next) => {
    if (!options.enabled) {
      next();
      return;
    }
    if (isExempt(req.path)) {
      next();
      return;
    }

    // 解析不出 IP 时归到同一个桶：宁可让少量异常请求共享配额，也不要给它们开绿灯
    const key = options.resolveKey(req) || 'unknown';
    const decision = limiter.take(key, Date.now());

    if (decision.allowed) {
      next();
      return;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(decision.retryAfterMs / 1000),
    );
    // 标准头：客户端与网关据此退避，比只给一个 429 更有用
    res.setHeader('Retry-After', String(retryAfterSeconds));

    if (decision.shouldLog) {
      // 用 `req.path` 而不是 `originalUrl`：query 可能带敏感参数，日志不该原样落盘
      logger.warn(
        `限流触发 key=${key} ${req.method} ${req.path} retryAfter=${retryAfterSeconds}s`,
      );
    }

    next(
      new HttpException(RATE_LIMITED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS),
    );
  };
}

/**
 * 是否豁免限流。
 *
 * 按**路径段边界**匹配而不是裸前缀：`/health` 要覆盖 `/health/ready`，
 * 但不能连带放过 `/healthcheck` 这类将来的业务路由。
 */
function isExempt(path: string): boolean {
  return RATE_LIMIT_EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
