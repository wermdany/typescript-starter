import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  integer,
  index,
  uniqueIndex,
  text,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';

/**
 * 用户表。
 *
 * 刻意**没有** `role` 列：角色是独立的 `user_roles` 多对多关系（见 `rbac.schema.ts`）。
 * 曾经的单值 `role` 枚举列已在 `0006` 迁移里删除 —— 单值列与多角色并存时，
 * 两份真相必然会漂移（谁在什么时候被改的、以哪边为准），所以一次性收口。
 */
export const users = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    studentNo: varchar('student_no', { length: 20 }).notNull().unique(),
    email: text().notNull(),
    nickname: varchar('nickname', { length: 50 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    points: integer('points').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    // 部分唯一索引：只约束未删除行，软删除用户的邮箱可被重新使用
    uniqueIndex('users_email_alive_idx')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
    index('users_nickname_idx').on(t.nickname),
  ],
);

export type Users = typeof users.$inferSelect;
export type NewUsers = typeof users.$inferInsert;
