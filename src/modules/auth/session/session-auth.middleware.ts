import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { SessionService } from './session.service.js';
import { TokenService } from '@/modules/auth/token/token.service.js';

/** `Authorization: Bearer <token>` */
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/** `last_used_at` 的刷新节流间隔：每个请求都写一次库只会制造无意义的写放大 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** 中间件依赖（以接口注入，测试可直接给假实现） */
export interface SessionAuthDependencies {
  tokens: Pick<TokenService, 'hashAccessToken'>;
  sessions: Pick<
    SessionService,
    'findAuthenticatable' | 'findAuthUserById' | 'touch'
  >;
}

/**
 * 会话认证中间件：把 accessToken 翻译成 `req.user`。
 *
 * 三条规则：
 * 1. **没有 `Authorization` 头就直接放行、不查库** —— 匿名请求（登录、健康检查、
 *    未命中路由）不该付认证成本
 * 2. **失败不抛错、不短路**：token 无效时只留空 `req.user`，由 `AuthGuard` 统一出 401，
 *    保证「过滤器是唯一失败出口」的契约不被中间件打破
 * 3. **不信任 token 里的任何内容**：身份与角色一律以会话 + 用户表为准，
 *    因此改角色、删用户、踢设备对下一次请求立即生效
 *
 * 用工厂函数而不是 Nest provider：它要经 `server.ts` 的 `app.use()` 手动挂载
 * （必须早于 `listen()` 且与 access 日志同层），此时拿不到模块内的注入实例；
 * 依赖由 {@link SessionAuthHandler} 从容器取出后传入。
 */
export function createSessionAuthMiddleware(
  deps: SessionAuthDependencies,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, _res, next) => {
    const token = BEARER_PATTERN.exec(req.headers.authorization ?? '')?.[1];
    if (!token) {
      next();
      return;
    }

    try {
      const session = await deps.sessions.findAuthenticatable(
        deps.tokens.hashAccessToken(token),
      );
      // 用户可能在校验之后被删除：会话与用户必须同时有效
      const user = session
        ? await deps.sessions.findAuthUserById(session.userId)
        : null;
      if (session && user) {
        req.user = {
          id: user.id,
          studentNo: user.studentNo,
          nickname: user.nickname,
          role: user.role,
          sessionId: session.id,
        };
        await touchIfStale(deps.sessions, session.id, session.lastUsedAt);
      }
    } catch {
      // 认证基础设施故障不应把请求变成 500：放弃本次识别，交给守卫按未登录处理。
      // 真正的库故障会在业务查询处再次暴露并进入 5xx 日志。
    }
    next();
  };
}

/** 节流刷新 `last_used_at`：它只影响设备列表的展示，失败不该让请求失败 */
async function touchIfStale(
  sessions: SessionAuthDependencies['sessions'],
  sessionId: number,
  lastUsedAt: Date | null,
): Promise<void> {
  const stale =
    !lastUsedAt || Date.now() - lastUsedAt.getTime() > TOUCH_INTERVAL_MS;
  if (!stale) return;
  try {
    await sessions.touch(sessionId);
  } catch {
    // 忽略：展示用时间戳不值得让请求失败
  }
}
/**
 * 会话认证中间件的**容器装配**：把依赖注入进来，产出可交给 `app.use()` 的处理函数。
 *
 * 为什么需要这一层：中间件必须在 `server.ts` 里 `app.use()` 挂载（早于 listen、
 * 与访问日志同层），而 `app.use()` 需要的是函数而不是 provider 实例。
 * `createApp()` 因此只依赖本类的一个方法，不必知道中间件依赖了谁。
 */
@Injectable()
export class SessionAuthHandler {
  private readonly middleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>;

  constructor(tokens: TokenService, sessions: SessionService) {
    const deps: SessionAuthDependencies = { tokens, sessions };
    this.middleware = createSessionAuthMiddleware(deps);
  }

  /** 交给 `app.use()` */
  use(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.middleware(req, res, next);
  }
}
