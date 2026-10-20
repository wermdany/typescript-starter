import type { Request, Response } from 'express';

import type { AuthConfigService } from '@/config/auth.config.js';

/**
 * refreshToken 的 Cookie 名（唯一出处，controller 与中间件共用）。
 *
 * ⚠️ 刻意**不用** `__Host-` 前缀：该前缀强制要求 `Path=/`，而我们把 Path 收窄到
 * `/auth/refresh` 缩小发送面 —— 两者互斥，浏览器会直接拒绝写入（curl 的 jar 同样拒绝）。
 * 子域覆写风险由 `SameSite=Strict` 覆盖；生产 HTTPS 由 Secure 标记保证。
 */
export const REFRESH_COOKIE = 'refresh_token';

/**
 * 从请求中取 refreshToken：**Cookie 优先，body 兜底**。
 *
 * - Cookie 方案下前端永远接触不到 RT 明文（HttpOnly），XSS 偷不走
 * - body 兼容分支保留给非浏览器客户端（App / 脚本），它们没有 Cookie 机制
 */
export function resolveRefreshToken(
  req: Request,
  bodyRefreshToken?: string,
): string | undefined {
  return (
    (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE] ??
    bodyRefreshToken
  );
}

/** Cookie 的公共属性：set 与 clear 必须一致，才能命中同一条 Cookie */
function cookieOptions(config: AuthConfigService) {
  return {
    httpOnly: true,
    // __Host- 前缀要求浏览器强制 Secure；本地 HTTP 开发由 NODE_ENV 关闭
    secure: config.config.refreshCookie.secure,
    // /auth/refresh 是唯一需要携带它的端点；Path 收窄缩小泄露面
    path: '/auth/refresh',
    // Strict：跨站请求不带 Cookie，CSRF 无从谈起（refresh 本身也不写业务数据）
    sameSite: 'strict' as const,
  };
}

/** 给响应写入轮换后的 refreshToken Cookie（HttpOnly，前端/JS 不可读） */
export function setRefreshCookie(
  res: Response,
  refreshToken: string,
  config: AuthConfigService,
): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(config),
    maxAge: config.config.refreshCookie.maxAgeMs,
  });
}

/** 登出 / 被踢出时清除 Cookie（幂等：没有该 Cookie 也不报错） */
export function clearRefreshCookie(
  res: Response,
  config: AuthConfigService,
): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
}
