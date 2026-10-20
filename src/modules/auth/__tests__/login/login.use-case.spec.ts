import { HttpException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { LoginService } from '@/modules/auth/login/login.service.js';
import type { AuthConfigService } from '@/config/auth.config.js';
import type { ClientContext } from '@/modules/auth/login/client-context.js';
import { DUMMY_PASSWORD_HASH } from '@/shared/auth/token.js';
import { hashPassword } from '@/shared/common.js';

/** 认证配置（限流阈值 3 次便于触发） */
function configStub() {
  return {
    config: {
      session: {
        accessTtlMs: 120 * 60_000,
        refreshTtlMs: 7 * 24 * 60 * 60_000,
        slidingRefresh: true,
        refreshWindowMs: 5 * 60_000,
        maxSessionsPerUser: 2,
      },
      login: { maxAttempts: 3, windowMs: 15 * 60_000 },
      trustProxy: false,
    },
  } as unknown as AuthConfigService;
}

const CLIENT: ClientContext = {
  clientName: '测试',
  clientType: 'web',
  ip: '203.0.113.1',
  userAgent: 'UA',
};

function setup(user?: { id: number; passwordHash: string }) {
  const accounts = {
    findLoginAccount: vi.fn(async () =>
      user
        ? {
            user: {
              id: user.id,
              studentNo: '2019010001',
              nickname: '学生',
              role: 'student' as const,
            },
            passwordHash: user.passwordHash,
          }
        : undefined,
    ),
  };
  const sessions = {
    createWithLimit: vi.fn(async () => 7),
    create: vi.fn(async () => 7),
    revoke: vi.fn(async () => true),
    aliveSessionIds: vi.fn(async (): Promise<number[]> => []),
  };
  const logs = {
    countRecentFailures: vi.fn(async () => 0),
    record: vi.fn(async () => undefined),
  };
  const database = {
    // 测试里不真开事务：直接以"事务句柄 = undefined"执行回调
    transaction: async <T>(fn: (tx: never) => Promise<T>) =>
      fn(undefined as never),
  };
  const useCase = new LoginService(
    configStub(),
    database as never,
    accounts as never,
    {} as never, // TokenService 只在 issue/hash 中使用，用例里通过注入替身
    sessions as never,
    logs as never,
  );
  // 替换 TokenService：签发固定的假 token 对，便于断言
  Object.assign(useCase, {
    tokens: {
      issue: vi.fn(() => ({
        accessToken: 'AT',
        refreshToken: 'RT',
        accessTokenHash: 'ath',
        refreshTokenHash: 'rth',
        accessExpiresAt: new Date(Date.now() + 1000),
        refreshExpiresAt: new Date(Date.now() + 2000),
      })),
      describeLifetime: vi.fn(() => ({
        tokenType: 'Bearer' as const,
        expiresAt: new Date(),
        expiresIn: 7200,
        refreshTokenExpiresAt: new Date(),
        refreshWindowSeconds: 300,
      })),
    },
  });
  return { useCase, accounts, sessions, logs };
}

describe('LoginService（防枚举 + 限流 + 会话上限）', () => {
  it('密码正确 → 建会话、写成功审计、返回双 token 与用户摘要', async () => {
    const passwordHash = await hashPassword('pass1234');
    const { useCase, sessions, logs } = setup({ id: 1, passwordHash });

    const result = await useCase.execute({
      studentNo: '2019010001',
      password: 'pass1234',
      client: CLIENT,
    });

    expect(result).toMatchObject({
      accessToken: 'AT',
      refreshToken: 'RT',
      tokenType: 'Bearer',
      user: {
        id: 1,
        studentNo: '2019010001',
        nickname: '学生',
        role: 'student',
      },
    });
    expect(sessions.createWithLimit).toHaveBeenCalledWith(
      1,
      expect.anything(),
      CLIENT,
      2,
    );
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, sessionId: 7, userId: 1 }),
      undefined, // 测试桩不开真事务，句柄为 undefined
    );
  });

  it('密码错误 → 401 + bad_credentials 审计（userId 记录在案）', async () => {
    const passwordHash = await hashPassword('pass1234');
    const { useCase, logs } = setup({ id: 1, passwordHash });

    await expect(
      useCase.execute({
        studentNo: '2019010001',
        password: 'wrong',
        client: CLIENT,
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        failureReason: 'bad_credentials',
        userId: 1,
      }),
    );
  });

  it('账号不存在 → 仍跑一次假哈希校验，401 文案与密码错误一致，审计 userId 为空', async () => {
    const { useCase, accounts, logs } = setup(undefined);

    const t0 = performance.now();
    await expect(
      useCase.execute({
        studentNo: '2099999999',
        password: 'whatever1',
        client: CLIENT,
      }),
    ).rejects.toThrow('学号或密码错误');
    // 假哈希陪跑 scrypt：耗时显著大于 0（防时序探测）
    expect(performance.now() - t0).toBeGreaterThan(5);

    expect(accounts.findLoginAccount).toHaveBeenCalledWith('2099999999');
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        failureReason: 'bad_credentials',
        userId: undefined,
        studentNo: '2099999999',
      }),
    );
  });

  it('陪跑哈希确实不匹配任何密码（万一成为真实用户密码也不至于误登录）', async () => {
    const { verifyPassword } = await import('@/shared/common.js');
    expect(await verifyPassword('12345678', DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it('窗口内失败达到阈值 → 429 + rate_limited 审计，且不再查账号（省掉 scrypt）', async () => {
    const { useCase, accounts, logs } = setup({ id: 1, passwordHash: 'x' });
    logs.countRecentFailures = vi.fn(async () => 3);

    await expect(
      useCase.execute({
        studentNo: '2019010001',
        password: 'pass1234',
        client: CLIENT,
      }),
    ).rejects.toMatchObject({ status: 429 });

    expect(accounts.findLoginAccount).not.toHaveBeenCalled();
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: 'rate_limited',
        success: false,
      }),
    );
  });

  it('429 是 HttpException（过滤器契约兼容），message 固定', async () => {
    const { useCase, logs } = setup({ id: 1, passwordHash: 'x' });
    logs.countRecentFailures = vi.fn(async () => 3);

    const err = await useCase
      .execute({
        studentNo: '2019010001',
        password: 'pass1234',
        client: CLIENT,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).message).toBe('登录尝试过于频繁，请稍后再试');
  });
});
