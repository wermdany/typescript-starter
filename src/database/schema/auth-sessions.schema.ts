import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';
import { users } from './users.schema.js';

/**
 * 登录会话：一次登录 = 一条记录，是"登录态"的唯一真相。
 *
 * - 同一用户可并存多条（多平台登录），踢出 = 批量写 `revoked_at`
 * - 双 token 只存 sha256 摘要，明文永不入库；续期时原地更新两个 hash，`id` 不变，
 *   因此「我的设备」列表不会因为续期冒出新条目
 * - `refresh_expires_at` 是会话的硬上限，`access_expires_at` 短得多，靠续期续命
 * - 客户端信息（UA / IP / 设备名）只用于展示与审计，**不参与鉴权判定**
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessTokenHash: varchar('access_token_hash', { length: 64 })
      .notNull()
      .unique(),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 })
      .notNull()
      .unique(),
    /**
     * 上一次轮换前的 refreshToken 摘要。
     *
     * 轮换会覆盖 `refresh_token_hash`，旧值只能靠这里留存；旧 refreshToken 再次出现时
     * 据此定位到会话与用户，判定为重放并吊销全部会话。
     */
    previousRefreshTokenHash: varchar('previous_refresh_token_hash', {
      length: 64,
    }),
    accessExpiresAt: timestamp('access_expires_at', {
      withTimezone: true,
    }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', {
      withTimezone: true,
    }).notNull(),
    /** 设备展示名，如 `Chrome · macOS`；识别不出时为「未知设备」 */
    clientName: varchar('client_name', { length: 64 })
      .notNull()
      .default('未知设备'),
    /** 设备形态：web / mobile / desktop */
    clientType: varchar('client_type', { length: 16 }).notNull().default('web'),
    ip: varchar('ip', { length: 45 }).notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** 吊销原因：logout / user_revoke_all / admin_revoke / password_changed / account_deleted / token_replay */
    revokedReason: varchar('revoked_reason', { length: 32 }),
    ...timestamps(),
  },
  (t) => [
    index('auth_sessions_user_alive_idx')
      .on(t.userId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('auth_sessions_refresh_expires_idx').on(t.refreshExpiresAt),
    // 重放检测按旧摘要反查会话
    index('auth_sessions_previous_refresh_idx')
      .on(t.previousRefreshTokenHash)
      .where(sql`${t.previousRefreshTokenHash} IS NOT NULL`),
  ],
);

export type AuthSessions = typeof authSessions.$inferSelect;
export type NewAuthSessions = typeof authSessions.$inferInsert;
