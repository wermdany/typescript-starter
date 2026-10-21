import { describe, expect, it, vi } from 'vitest';

import {
  createSessionAuthMiddleware,
  type SessionAuthDependencies,
} from '@/modules/auth/session/session-auth.middleware.js';
import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import { hashToken } from '@/shared/auth/token.js';
import type { Request, Response } from 'express';

/** 构造依赖与请求 */
type Deps = SessionAuthDependencies;

function setup(overrides: Partial<Deps> = {}) {
  const user: AuthenticatedUser = {
    id: 1,
    studentNo: '2019010001',
    nickname: '学生',
    roles: ['student'],
    sessionId: 7,
  };
  const deps = {
    tokens: { hashAccessToken: (t: string) => hashToken(t) },
    sessions: {
      // 默认：任何 token 都命中同一会话（返回类型与真实签名对齐，含"未命中"分支）
      findAuthenticatable: vi.fn(
        async (): Promise<{
          id: number;
          userId: number;
          lastUsedAt: Date | null;
        } | null> => ({ id: 7, userId: 1, lastUsedAt: new Date() }),
      ),
      findAuthUserById: vi.fn(
        async (): Promise<
          | {
              id: number;
              studentNo: string;
              nickname: string;
              roles: string[];
            }
          | undefined
        > => ({
          id: 1,
          studentNo: '2019010001',
          nickname: '学生',
          roles: ['student'],
        }),
      ),
      touch: vi.fn(async () => undefined),
    },
    ...overrides,
  };
  const middleware = createSessionAuthMiddleware(deps as unknown as Deps);
  const req = { headers: {} } as unknown as Request;
  const next = vi.fn();
  return { deps, middleware, req, next, user };
}

/** Object.defineProperty 挂 user（Request 的 user 是可选字段，直接赋值即可，这里为了断言方便保留原引用） */
function header(token?: string) {
  return { authorization: token ? `Bearer ${token}` : undefined };
}

describe('createSessionAuthMiddleware', () => {
  it('无 Authorization 头 → 直接放行，零查询（匿名请求不付认证成本）', async () => {
    const { deps, middleware, req, next } = setup();
    req.headers = header(undefined);

    await middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(deps.sessions.findAuthenticatable).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('合法 token → 注入 req.user（身份来自会话 + 用户表）', async () => {
    const { middleware, req, next } = setup();
    req.headers = header('good-token');

    await middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: 1,
      sessionId: 7,
      roles: ['student'],
    });
  });

  it('会话未命中 → 不注入，放行交给守卫出 401（中间件不短路）', async () => {
    const { deps, middleware, req, next } = setup();
    deps.sessions.findAuthenticatable = vi.fn(async () => null);
    req.headers = header('stale-token');

    await middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('会话有效但用户已删除 → 不注入（软删用户立即失去登录态）', async () => {
    const { deps, middleware, req, next } = setup();
    deps.sessions.findAuthUserById = vi.fn(async () => undefined);
    req.headers = header('good-token');

    await middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('查询抛错（基础设施故障）→ 不注入、放行，请求不变成 500', async () => {
    const { deps, middleware, req, next } = setup();
    deps.sessions.findAuthenticatable = vi.fn(async () => {
      throw new Error('db down');
    });
    req.headers = header('any');

    await middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
  });

  it('lastUsedAt 新鲜 → 不触发 touch（节流，避免写放大）', async () => {
    const { deps, middleware, req, next } = setup();
    req.headers = header('good');
    await middleware(req, {} as Response, next);
    expect(deps.sessions.touch).not.toHaveBeenCalled();
  });

  it('lastUsedAt 超过 5 分钟 → touch 一次；touch 失败不影响请求', async () => {
    const { deps, middleware, req, next } = setup();
    deps.sessions.findAuthenticatable = vi.fn(async () => ({
      id: 7,
      userId: 1,
      lastUsedAt: new Date(Date.now() - 10 * 60 * 1000),
    }));
    req.headers = header('good');
    await middleware(req, {} as Response, next);
    expect(deps.sessions.touch).toHaveBeenCalledWith(7);

    // touch 抛错也不冒泡
    deps.sessions.touch = vi.fn(async () => {
      throw new Error('write fail');
    });
    await middleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
