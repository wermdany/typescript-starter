import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  varchar,
  integer,
  index,
  uniqueIndex,
  text,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';

export const userRoleEnum = pgEnum('user_role', [
  'student',
  'teacher',
  'admin',
]);

export const users = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    studentNo: varchar('student_no', { length: 20 }).notNull().unique(),
    email: text().notNull(),
    nickname: varchar('nickname', { length: 50 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('student'),
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
