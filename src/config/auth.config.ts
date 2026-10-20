import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/config/env.js';

/**
 * 认证配置（**业务视角**，不暴露环境变量名）。
 *
 * 会话层、用例层只认这个对象：环境变量名、默认值、单位换算都收口在
 * {@link AuthConfigService} 里，业务代码换不动也猜不到 env key。
 */
export interface AuthConfig {
  /** accessToken / refreshToken 的有效期 */
  session: {
    accessTtlMs: number;
    refreshTtlMs: number;
    /** 续期时 refreshToken 有效期是否顺延 */
    slidingRefresh: boolean;
    /** 前端提前续期的窗口（响应里回给前端的 `refreshAfter` 依据） */
    refreshWindowMs: number;
    /** 单用户并发会话上限 */
    maxSessionsPerUser: number;
  };
  /** 登录失败限流（按 学号 + IP） */
  login: {
    maxAttempts: number;
    windowMs: number;
  };
  /** 客户端 IP 是否取代理头 */
  trustProxy: boolean;
  /** refreshToken 走 HttpOnly Cookie（前端不接触 RT 明文） */
  refreshCookie: {
    /** 是否启用；关闭时退回 body/header 传 RT（非浏览器客户端） */
    enabled: boolean;
    /** Cookie 名：__Host- 前缀要求浏览器强制 Secure + 无 Domain + Path=/ */
    name: string;
    /** Secure 标记：生产必须开（HTTPS），本地 HTTP 开发为 false */
    secure: boolean;
    /** 有效期（毫秒），与 refreshToken TTL 一致 */
    maxAgeMs: number;
  };
}

/** 分钟 → 毫秒 / 天 → 毫秒 */
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * 把 `ConfigService` 里的环境变量读成 {@link AuthConfig}。
 *
 * 全项目**只有这里**读 `AUTH_*` 变量；单例注入，构造时读一次。
 *
 * 业务层注入的是 `AuthConfigService` 而不是裸 `ConfigService`：拿到的是一份只读的认证配置，
 * 感知不到环境变量名，也不会顺手去读别的配置造成耦合。
 */
@Injectable()
export class AuthConfigService {
  readonly config: AuthConfig;

  constructor(config: ConfigService<Env, true>) {
    this.config = toAuthConfig((key) => config.get(key, { infer: true }));
  }
}

/**
 * 纯函数：env 取值 → AuthConfig。
 *
 * 入参是"按键取值"的函数而不是 `ConfigService`，单位换算与字段映射因此可以脱离
 * Nest 容器直接单测。
 */
export function toAuthConfig(
  get: <K extends keyof Env>(key: K) => Env[K],
): AuthConfig {
  return {
    session: {
      accessTtlMs: get('AUTH_ACCESS_TTL_MINUTES') * MINUTE_MS,
      refreshTtlMs: get('AUTH_REFRESH_TTL_DAYS') * DAY_MS,
      slidingRefresh: get('AUTH_REFRESH_SLIDING'),
      refreshWindowMs: get('AUTH_REFRESH_WINDOW_MINUTES') * MINUTE_MS,
      maxSessionsPerUser: get('AUTH_MAX_SESSIONS_PER_USER'),
    },
    login: {
      maxAttempts: get('AUTH_LOGIN_MAX_ATTEMPTS'),
      windowMs: get('AUTH_LOGIN_WINDOW_MINUTES') * MINUTE_MS,
    },
    trustProxy: get('AUTH_TRUST_PROXY'),
    refreshCookie: {
      enabled: get('AUTH_REFRESH_COOKIE'),
      // __Host- 前缀：浏览器强制 Secure、无 Domain、Path=/，防子域覆写与路径放宽
      name: '__Host-refresh',
      // 生产环境必须 HTTPS；NODE_ENV 由部署方保证，这里按值判断
      secure: get('NODE_ENV') === 'production',
      maxAgeMs: get('AUTH_REFRESH_TTL_DAYS') * DAY_MS,
    },
  };
}
