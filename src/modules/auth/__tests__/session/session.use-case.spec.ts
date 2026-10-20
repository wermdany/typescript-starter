import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SessionManagerService } from '@/modules/auth/session/session-manager.service.js';
import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import type { PageResponse } from '@/shared/common.js';

/** 假仓储：只实现用例层会用到的方法（SessionManagerService 现在只依赖 SessionService） */
function setup(
  sessions: Partial<
    ConstructorParameters<typeof SessionManagerService>[0]
  > = {},
) {
  const sessionStub = {
    listForUser: vi.fn(async () => emptyPage()),
    revoke: vi.fn(async () => true),
    revokeAllForUser: vi.fn(async () => 2),
    revokeForUser: vi.fn(async () => true),
    findById: vi.fn(async () => ({ id: 99, userId: 2, revokedAt: null })),
    userExists: vi.fn(async () => true),
    ...sessions,
  };
  const useCase = new SessionManagerService(sessionStub as never);
  return { useCase, sessionStub };
}

function emptyPage(): PageResponse<never> {
  return { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 };
}

const STUDENT: AuthenticatedUser = {
  id: 1,
  studentNo: '2019010001',
  nickname: '学生',
  role: 'student',
  sessionId: 7,
};

describe('SessionManagerService（越权判定都在这一层）', () => {
  it('我的会话列表：只按 user.id 过滤，并给当前会话打 current 标记', async () => {
    const { useCase, sessionStub } = setup();
    sessionStub.listForUser = vi.fn(async () => ({
      items: [
        {
          id: 7,
          clientName: 'x',
          clientType: 'web',
          ip: '',
          lastUsedAt: null,
          expiresAt: new Date(),
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
        },
        {
          id: 8,
          clientName: 'y',
          clientType: 'web',
          ip: '',
          lastUsedAt: null,
          expiresAt: new Date(),
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
        },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    }));

    const result = await useCase.listMine(STUDENT, { page: 1, pageSize: 10 });

    expect(sessionStub.listForUser).toHaveBeenCalledWith(1, 1, 10);
    expect(result.items.map((i) => i.current)).toEqual([true, false]);
  });

  it('退出全部设备：默认包含当前设备（keepCurrent=false）', async () => {
    const { useCase, sessionStub } = setup();
    const result = await useCase.revokeAllMine(STUDENT, { keepCurrent: false });

    expect(sessionStub.revokeAllForUser).toHaveBeenCalledWith(
      1,
      'user_revoke_all',
      {
        exceptSessionId: undefined,
      },
    );
    expect(result).toEqual({ revoked: 2, currentRevoked: true });
  });

  it('退出全部设备：keepCurrent=true 时保留当前会话', async () => {
    const { useCase, sessionStub } = setup();
    await useCase.revokeAllMine(STUDENT, { keepCurrent: true });

    expect(sessionStub.revokeAllForUser).toHaveBeenCalledWith(
      1,
      'user_revoke_all',
      {
        exceptSessionId: 7,
      },
    );
  });

  it('踢自己的某台设备：仓储按 (userId, sessionId) 过滤，未命中 → 404', async () => {
    const { useCase, sessionStub } = setup();
    sessionStub.revokeForUser = vi.fn(async () => false);

    await expect(useCase.revokeMine(STUDENT, 999)).rejects.toThrow(
      NotFoundException,
    );
    expect(sessionStub.revokeForUser).toHaveBeenCalledWith(1, 999, 'logout');
  });

  it('管理员踢全部：目标账号不存在 → 404（对空气操作直接拒绝）', async () => {
    const { useCase, sessionStub } = setup();
    sessionStub.userExists = vi.fn(async () => false);

    await expect(useCase.revokeUserSessions(404)).rejects.toThrow('用户不存在');
    expect(sessionStub.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('管理员踢单个会话：会话存在但不属于目标用户 → 404（不泄漏他人会话 ID）', async () => {
    const { useCase, sessionStub } = setup();
    sessionStub.findById = vi.fn(async () => ({
      id: 99,
      userId: 2,
      revokedAt: null,
    }));

    await expect(useCase.revokeUserSession(1, 99)).rejects.toThrow(
      NotFoundException,
    );
    expect(sessionStub.revoke).not.toHaveBeenCalled();
  });

  it('管理员踢单个会话：归属匹配 → 以 admin_revoke 吊销', async () => {
    const { useCase, sessionStub } = setup();
    sessionStub.findById = vi.fn(async () => ({
      id: 99,
      userId: 1,
      revokedAt: null,
    }));

    await useCase.revokeUserSession(1, 99);
    expect(sessionStub.revoke).toHaveBeenCalledWith(99, 'admin_revoke');
  });

  it('登出：以 logout 理由吊销当前会话', async () => {
    const { useCase, sessionStub } = setup();
    await useCase.logout(STUDENT);
    expect(sessionStub.revoke).toHaveBeenCalledWith(7, 'logout');
  });
});
