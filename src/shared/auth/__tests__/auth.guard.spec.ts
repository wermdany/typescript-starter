import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import { AuthGuard } from '@/shared/auth/auth.guard.js';

const guard = new AuthGuard();

const STUDENT: AuthenticatedUser = {
  id: 1,
  studentNo: '2019010001',
  nickname: '学生',
  roles: ['student'],
  sessionId: 7,
};
const ADMIN: AuthenticatedUser = { ...STUDENT, roles: ['admin'], id: 2 };

describe('AuthGuard（纯逻辑）', () => {
  it('公开路由：即使无身份也放行', () => {
    expect(
      guard.canActivate(undefined, { isPublic: true, adminOnly: false }),
    ).toBe(true);
    expect(
      guard.canActivate(STUDENT, { isPublic: true, adminOnly: true }),
    ).toBe(true);
  });

  it('无身份且非公开 → 401（文案统一「请先登录」）', () => {
    expect(() =>
      guard.canActivate(undefined, { isPublic: false, adminOnly: false }),
    ).toThrow(UnauthorizedException);
  });

  it('有身份 → 放行（普通路由不区分角色）', () => {
    expect(
      guard.canActivate(STUDENT, { isPublic: false, adminOnly: false }),
    ).toBe(true);
  });

  it('仅管理员路由 + 非管理员 → 403', () => {
    expect(() =>
      guard.canActivate(STUDENT, { isPublic: false, adminOnly: true }),
    ).toThrow(ForbiddenException);
  });

  it('仅管理员路由 + 管理员 → 放行', () => {
    expect(guard.canActivate(ADMIN, { isPublic: false, adminOnly: true })).toBe(
      true,
    );
  });

  it('无身份 + 仅管理员路由 → 401（先登录再谈角色）', () => {
    expect(() =>
      guard.canActivate(undefined, { isPublic: false, adminOnly: true }),
    ).toThrow(UnauthorizedException);
  });
});
