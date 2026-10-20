import { describe, expect, it } from 'vitest';

import { sessionPublicColumns } from '@/modules/auth/session/dto/session.dto.js';
import { loginLogPublicColumns } from '@/modules/auth/log/dto/login-log.dto.js';
import { userSummaryColumns } from '@/modules/auth/login/dto/user.dto.js';
import { authUserColumns } from '@/modules/auth/login/dto/user.dto.js';

/**
 * 把「对外字段白名单」冻结成可回归的契约：加列必须显式改这里的断言。
 * 重点是**敏感列永不出现**：token 哈希、密码哈希、软删标记、userAgent。
 */
describe('sessionPublicColumns（会话对外白名单）', () => {
  it('逻辑字段冻结为契约', () => {
    expect(Object.keys(sessionPublicColumns).sort()).toEqual([
      'clientName',
      'clientType',
      'createdAt',
      'expiresAt',
      'id',
      'ip',
      'lastUsedAt',
      'revokedAt',
      'revokedReason',
    ]);
  });

  it('expiresAt 映射到 refresh_expires_at（对外只暴露会话硬上限）', () => {
    expect(sessionPublicColumns.expiresAt.name).toBe('refresh_expires_at');
  });

  it('不含 token 哈希、userAgent、软删标记', () => {
    expect(sessionPublicColumns).not.toHaveProperty('accessTokenHash');
    expect(sessionPublicColumns).not.toHaveProperty('refreshTokenHash');
    expect(sessionPublicColumns).not.toHaveProperty('previousRefreshTokenHash');
    expect(sessionPublicColumns).not.toHaveProperty('userAgent');
    expect(sessionPublicColumns).not.toHaveProperty('deletedAt');
  });
});

describe('loginLogPublicColumns（登录记录对外白名单）', () => {
  it('逻辑字段冻结为契约', () => {
    expect(Object.keys(loginLogPublicColumns).sort()).toEqual([
      'createdAt',
      'failureReason',
      'id',
      'ip',
      'success',
    ]);
  });

  it('不含 userAgent、学号快照、会话 ID、软删标记', () => {
    expect(loginLogPublicColumns).not.toHaveProperty('userAgent');
    expect(loginLogPublicColumns).not.toHaveProperty('studentNo');
    expect(loginLogPublicColumns).not.toHaveProperty('sessionId');
    expect(loginLogPublicColumns).not.toHaveProperty('deletedAt');
  });
});

describe('userSummaryColumns（登录响应里的用户摘要）', () => {
  it('只含身份四字段，不含密码哈希等敏感列', () => {
    expect(Object.keys(userSummaryColumns).sort()).toEqual([
      'id',
      'nickname',
      'role',
      'studentNo',
    ]);
    expect(userSummaryColumns).not.toHaveProperty('passwordHash');
  });
});

describe('authUserColumns（认证用例的用户投影）', () => {
  it('含完整资料但不含密码哈希与软删标记', () => {
    expect(Object.keys(authUserColumns).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'nickname',
      'points',
      'role',
      'studentNo',
      'updatedAt',
    ]);
    expect(authUserColumns).not.toHaveProperty('passwordHash');
    expect(authUserColumns).not.toHaveProperty('deletedAt');
  });
});
