import { describe, expect, it } from 'vitest';

import {
  authSessions,
  type NewAuthSessions,
} from '@/database/schema/auth-sessions.schema.js';
import {
  authLoginLogs,
  type NewAuthLoginLogs,
} from '@/database/schema/auth-login-logs.schema.js';

/**
 * 会话/审计表的**结构契约**（对齐 AGENTS.md 第 15 节）：
 * 物理列名 snake_case、键 camelCase、时间戳来自 timestamps()、敏感列确实存在且唯一。
 * 这里直接检查 schema 对象而不是连库 —— 结构改动在构建期就会暴露。
 */
describe('auth_sessions 结构契约', () => {
  it('物理列名 snake_case（显式声明，不依赖推断）', () => {
    // drizzle 的 PgTable 上除列定义外还有 enableRLS 等配置函数，只取"有 name 属性"的成员
    const names = Object.values(authSessions)
      .filter(
        (value): value is { name: string } =>
          typeof value === 'object' &&
          value !== null &&
          'name' in value &&
          typeof (value as { name: unknown }).name === 'string',
      )
      .map((value) => value.name);
    expect(names.length).toBeGreaterThanOrEqual(14);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('时间戳三列来自 timestamps()（含软删标记）', () => {
    expect(authSessions.createdAt.name).toBe('created_at');
    expect(authSessions.updatedAt.name).toBe('updated_at');
    expect(authSessions.deletedAt.name).toBe('deleted_at');
  });

  it('双 token 哈希列唯一且为 64 位 varchar', () => {
    expect(authSessions.accessTokenHash.isUnique).toBe(true);
    expect(authSessions.refreshTokenHash.isUnique).toBe(true);
    expect(authSessions.accessTokenHash.columnType).toBe('PgVarchar');
  });

  it('插入值类型强制要求用户与双哈希（编译期约束的运行时抽样）', () => {
    const base: NewAuthSessions = {
      userId: 1,
      accessTokenHash: 'a'.repeat(64),
      refreshTokenHash: 'b'.repeat(64),
      accessExpiresAt: new Date(),
      refreshExpiresAt: new Date(),
    };
    expect(base.userId).toBe(1);
  });
});

describe('auth_login_logs 结构契约', () => {
  it('时间戳三列存在；user_id 允许为空（审计类外键 set null）', () => {
    expect(authLoginLogs.createdAt.name).toBe('created_at');
    expect(authLoginLogs.deletedAt.name).toBe('deleted_at');
    expect(authLoginLogs.userId.notNull).toBe(false);
  });

  it('插入值类型：失败记录可以没有 userId（账号不存在也要留痕）', () => {
    const failed: NewAuthLoginLogs = {
      studentNo: '2099999999',
      success: false,
      failureReason: 'bad_credentials',
    };
    expect(failed.userId).toBeUndefined();
  });
});
