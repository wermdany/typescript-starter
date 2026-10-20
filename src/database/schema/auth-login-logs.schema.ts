import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';
import { users } from './users.schema.js';

/**
 * 登录审计流水：**成功与失败都记**，只增不改。
 *
 * - 与 `auth_sessions` 分开：失败登录没有会话可挂，而失败的尝试恰恰是安全审计
 *   最需要盯的事件（撞库、暴力破解的识别素材）
 * - `student_no` 冗余保存：账号不存在时 `user_id` 为空，仍要看得出"谁在试"
 * - 外键 `on delete set null`：用户被删除后审计记录保留
 * - 不记密码、不记 token
 */
export const authLoginLogs = pgTable(
  'auth_login_logs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 尝试登录时提交的学号快照 */
    studentNo: varchar('student_no', { length: 20 }).notNull(),
    success: boolean('success').notNull(),
    /** 失败原因：bad_credentials / rate_limited / token_replay；成功为空 */
    failureReason: varchar('failure_reason', { length: 32 }),
    ip: varchar('ip', { length: 45 }).notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    /** 成功登录时对应的会话 ID，失败为空 */
    sessionId: integer('session_id'),
    ...timestamps(),
  },
  (t) => [
    index('auth_login_logs_user_idx').on(t.userId, t.createdAt),
    // 限流按「学号 + IP + 时间窗口」统计，复合索引直接服务这条查询
    index('auth_login_logs_attempt_idx').on(t.studentNo, t.ip, t.createdAt),
    index('auth_login_logs_created_idx')
      .on(t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type AuthLoginLogs = typeof authLoginLogs.$inferSelect;
export type NewAuthLoginLogs = typeof authLoginLogs.$inferInsert;
