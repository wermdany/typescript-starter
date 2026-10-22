import { UnauthorizedException } from '@nestjs/common';
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

describe('AuthGuard（纯逻辑）', () => {
  it('公开路由：即使无身份也放行', () => {
    expect(guard.canActivate(undefined, { isPublic: true })).toBe(true);
    expect(guard.canActivate(STUDENT, { isPublic: true })).toBe(true);
  });

  it('无身份且非公开 → 401（文案统一「请先登录」）', () => {
    expect(() => guard.canActivate(undefined, { isPublic: false })).toThrow(
      UnauthorizedException,
    );
  });

  it('有身份 → 放行（角色与权限点不由本守卫判定）', () => {
    expect(guard.canActivate(STUDENT, { isPublic: false })).toBe(true);
  });
});
