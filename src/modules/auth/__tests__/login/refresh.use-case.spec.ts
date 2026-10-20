import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { RefreshService } from '@/modules/auth/login/refresh.service.js';
import type { ClientContext } from '@/modules/auth/login/client-context.js';

const CLIENT: ClientContext = {
  clientName: '测试',
  clientType: 'web',
  ip: '203.0.113.1',
  userAgent: 'UA',
};

const USER = {
  id: 1,
  studentNo: '2019010001',
  email: 'a@b.c',
  nickname: '学生',
  role: 'student' as const,
  points: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(session?: {
  id: number;
  userId: number;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
}) {
  const accounts = {
    findById: vi.fn(async () => USER as typeof USER | undefined),
  };
  const sessions = {
    findByRefreshHash: vi.fn(async () => session as typeof session | undefined),
    rotate: vi.fn(async () => true),
    revokeAllForUser: vi.fn(async () => 3),
    findByRefreshHistory: vi.fn(
      async (): Promise<
        { id: number; userId: number; studentNo: string } | undefined
      > => undefined,
    ),
  };
  const logs = { record: vi.fn(async () => undefined) };
  const tokens = {
    hashRefreshToken: vi.fn(() => 'hashed'),
    issue: vi.fn(() => ({
      accessToken: 'AT2',
      refreshToken: 'RT2',
      accessTokenHash: 'ath2',
      refreshTokenHash: 'rth2',
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
  };
  const database = {
    transaction: async <T>(fn: (tx: never) => Promise<T>) =>
      fn(undefined as never),
  };
  const useCase = new RefreshService(
    database as never,
    accounts as never,
    tokens as never,
    sessions as never,
    logs as never,
  );
  return { useCase, accounts, sessions, logs, tokens };
}

describe('RefreshService（一次性轮换 + 重放检测）', () => {
  it('正常续期：轮换成功 → 返回新 token 对与用户摘要', async () => {
    const { useCase, sessions } = setup({
      id: 7,
      userId: 1,
      refreshExpiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    });

    const result = await useCase.execute('old-refresh', CLIENT);

    expect(result).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT2' });
    expect(sessions.rotate).toHaveBeenCalledWith(
      7,
      'hashed',
      expect.anything(),
    );
  });

  it('续期返回的用户与旧会话同源（user.id 来自会话）', async () => {
    const { useCase, accounts } = setup({
      id: 7,
      userId: 1,
      refreshExpiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    });
    const result = await useCase.execute('old-refresh', CLIENT);
    expect(accounts.findById).toHaveBeenCalledWith(1);
    expect(result.user.id).toBe(1);
  });

  it('refreshToken 不存在 → 401，且不触发轮换', async () => {
    const { useCase, sessions } = setup(undefined);

    await expect(useCase.execute('forged', CLIENT)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.rotate).not.toHaveBeenCalled();
  });

  it('会话已吊销 → 401，不轮换也不判重放（客户端应重新登录）', async () => {
    const { useCase, sessions } = setup({
      id: 7,
      userId: 1,
      refreshExpiresAt: new Date(Date.now() + 86400_000),
      revokedAt: new Date(),
    });

    await expect(useCase.execute('old-refresh', CLIENT)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.rotate).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('轮换失败（并发抢输 / 旧 token 已被替换）→ 按重放处理：吊销全部会话 + token_replay 审计', async () => {
    const { useCase, sessions, logs } = setup({
      id: 7,
      userId: 1,
      refreshExpiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    });
    sessions.rotate = vi.fn(async () => false);
    sessions.findByRefreshHistory = vi.fn(async () => ({
      id: 7,
      userId: 1,
      studentNo: '2019010001',
    }));

    await expect(useCase.execute('stolen', CLIENT)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(1, 'token_replay', {
      executor: undefined,
    });
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        failureReason: 'token_replay',
        userId: 1,
        sessionId: 7,
      }),
      undefined,
    );
  });

  it('重放但定位不到用户（随手伪造）→ 不吊销任何人（不误杀）', async () => {
    const { useCase, sessions, logs } = setup(undefined);
    sessions.findByRefreshHistory = vi.fn(async () => undefined);

    await expect(useCase.execute('random', CLIENT)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    expect(logs.record).not.toHaveBeenCalled();
  });

  it('会话对应用户已被删除 → 401', async () => {
    const { useCase, accounts } = setup({
      id: 7,
      userId: 1,
      refreshExpiresAt: new Date(Date.now() + 86400_000),
      revokedAt: null,
    });
    accounts.findById = vi.fn(async () => undefined);

    await expect(useCase.execute('old-refresh', CLIENT)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
