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
 * 会话认证中间件的**纯工厂**（无 DI）：把 accessToken 翻译成 `req.user`。
 *
 * 三条规则：
 * 1. **没有 `Authorization` 头就直接放行、不查库** —— 匿名请求（登录、健康检查、
 *    未命中路由）不该付认证成本
 * 2. **失败不抛错、不短路**：token 无效时只留空 `req.user`，由 `AccessGuard` 统一出 401，
 *    保证「过滤器是唯一失败出口」的契约不被中间件打破
 * 3. **不信任 token 里的任何内容**：身份与角色一律以会话 + 用户表为准，
 *    因此改角色、删用户、踢设备对下一次请求立即生效
 *
 * 保留成工厂函数是为了可测：`__tests__` 直接给它假依赖，不必起 Nest 容器。
 * 生产路径走下面的 {@link SessionAuthenticator}。
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
          roles: user.roles,
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
 * 为什么需要这一层：中间件必须用 `app.use()` 挂载（早于 listen、与访问日志同层），
 * 而 `app.use()` 需要的是函数而不是 provider 实例。`server.ts` 的 `createApp()`
 * 因此只依赖本类的一个方法，不必知道中间件依赖了谁。
 *
 * 名字是 `SessionAuthenticator`（动词化的装配体）而不是 `...Handler`：
 * 项目约定禁用 `*.handler.ts` 这类自造后缀命名，类名与文件名保持同族。
 */
@Injectable()
export class SessionAuthenticator {
  private readonly middleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>;

  constructor(tokens: TokenService, sessions: SessionService) {
    const deps: SessionAuthDependencies = { tokens, sessions };
    this.middleware = createSessionAuthMiddleware(deps);
  }

  /** 交给 `app.use()`（经 `registerRequestStages()`） */
  use(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.middleware(req, res, next);
  }
}
