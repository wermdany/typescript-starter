import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveAccess,
  type AccessIntent,
  type AccessSubject,
} from '@/common/auth/access.js';
import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import type { PermissionCode } from '@/common/auth/permission.contract.js';

/**
 * `resolveAccess` 的纯逻辑测试（由原 `shared/auth/__tests__/auth.guard.spec.ts` 迁移而来）。
 *
 * 覆盖四类意图 × 身份有无 × 权限码命中与否。判定逻辑不碰 HTTP 上下文，
 * 因此可以直接给假身份与假 `params`，不需要起 Nest 容器。
 */

const STUDENT: AuthenticatedUser = {
  id: 1,
  studentNo: '2019010001',
  nickname: '学生',
  roles: ['student'],
  sessionId: 7,
};

/** 构造 subject：`resolveCodes` 默认返回空集合，按用例覆盖 */
function subjectOf(overrides: Partial<AccessSubject> = {}): AccessSubject {
  return {
    user: STUDENT,
    params: {},
    resolveCodes: async () => new Set<PermissionCode>(),
    ...overrides,
  };
}

/** 记录 `resolveCodes` 是否被调用（用于断言"本人分支不查权限表"） */
function spyResolve(codes: PermissionCode[]) {
  return vi.fn(async () => new Set<PermissionCode>(codes));
}

describe('resolveAccess / 公开与登录即可', () => {
  it('public：即使无身份也放行', async () => {
    const intent: AccessIntent = { kind: 'public' };

    await expect(
      resolveAccess(intent, subjectOf({ user: undefined })),
    ).resolves.toBe(true);
  });

  it('public：不读取权限解析器（公开路由不查库）', async () => {
    const resolveCodes = spyResolve(['user:read']);

    await resolveAccess({ kind: 'public' }, subjectOf({ resolveCodes }));

    expect(resolveCodes).not.toHaveBeenCalled();
  });

  it('authenticated：有身份放行，且不查权限码', async () => {
    const resolveCodes = spyResolve(['user:read']);

    await expect(
      resolveAccess({ kind: 'authenticated' }, subjectOf({ resolveCodes })),
    ).resolves.toBe(true);
    expect(resolveCodes).not.toHaveBeenCalled();
  });

  it('意图缺失 → 按 authenticated 处理（漏标 fail-closed）', async () => {
    await expect(resolveAccess(undefined, subjectOf())).resolves.toBe(true);
    await expect(
      resolveAccess(undefined, subjectOf({ user: undefined })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('无身份且非公开 → 401（文案统一「请先登录」）', async () => {
    const scenarios: AccessIntent[] = [
      { kind: 'authenticated' },
      { kind: 'permission', codes: ['user:read'] },
      { kind: 'owner', ownerParam: 'id', codes: [] },
    ];

    for (const intent of scenarios) {
      await expect(
        resolveAccess(intent, subjectOf({ user: undefined })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
});

describe('resolveAccess / @RequirePermission', () => {
  it('权限码为空 → 放行（等价于登录即可），且不查库', async () => {
    const resolveCodes = spyResolve([]);

    await expect(
      resolveAccess(
        { kind: 'permission', codes: [] },
        subjectOf({ resolveCodes }),
      ),
    ).resolves.toBe(true);
    expect(resolveCodes).not.toHaveBeenCalled();
  });

  it('持有任一权限码 → 放行', async () => {
    await expect(
      resolveAccess(
        { kind: 'permission', codes: ['user:read', 'user:update'] },
        subjectOf({ resolveCodes: spyResolve(['user:read']) }),
      ),
    ).resolves.toBe(true);
  });

  it('通配 * 短路所有权限码', async () => {
    await expect(
      resolveAccess(
        { kind: 'permission', codes: ['user:delete'] },
        subjectOf({ resolveCodes: spyResolve(['*']) }),
      ),
    ).resolves.toBe(true);
  });

  it('一个码都不命中 → 403（文案「无权执行该操作」）', async () => {
    await expect(
      resolveAccess(
        { kind: 'permission', codes: ['user:delete'] },
        subjectOf({ resolveCodes: spyResolve(['user:read']) }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('resolveAccess / @OwnerOrPermission', () => {
  it('本人（URL id === user.id）→ 放行，且不查权限表', async () => {
    const resolveCodes = spyResolve([]);

    await expect(
      resolveAccess(
        { kind: 'owner', ownerParam: 'id', codes: ['user:update'] },
        subjectOf({ params: { id: '1' }, resolveCodes }),
      ),
    ).resolves.toBe(true);
    expect(resolveCodes).not.toHaveBeenCalled();
  });

  it('非本人但持有权限码 → 放行', async () => {
    await expect(
      resolveAccess(
        { kind: 'owner', ownerParam: 'id', codes: ['user:update'] },
        subjectOf({
          params: { id: '99' },
          resolveCodes: spyResolve(['user:update']),
        }),
      ),
    ).resolves.toBe(true);
  });

  it('非本人且 codes 为空（只允许本人）→ 403，且不查权限表', async () => {
    const resolveCodes = spyResolve(['user:update']);

    await expect(
      resolveAccess(
        { kind: 'owner', ownerParam: 'id', codes: [] },
        subjectOf({ params: { id: '99' }, resolveCodes }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resolveCodes).not.toHaveBeenCalled();
  });

  it('参数不是整数（如 abc）→ 不当作本人，按权限码判定', async () => {
    await expect(
      resolveAccess(
        { kind: 'owner', ownerParam: 'id', codes: ['user:update'] },
        subjectOf({
          params: { id: 'abc' },
          resolveCodes: spyResolve(['user:update']),
        }),
      ),
    ).resolves.toBe(true);
  });

  it('参数缺失 → 不当作本人', async () => {
    await expect(
      resolveAccess(
        { kind: 'owner', ownerParam: 'id', codes: [] },
        subjectOf({ params: {} }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
