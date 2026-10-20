import { users, type Users } from '@/database/schema/users.schema.js';

/**
 * 对外公开字段**白名单**（响应契约的唯一出处）。
 *
 * 交给 Drizzle 做列投影，数据库层就不返回敏感列，也不需要映射函数：
 *
 * ```ts
 * this.db.select(userPublicColumns).from(users).where(...)
 * this.db.insert(users).values(...).returning(userPublicColumns)
 * this.db.update(users).set(...).returning(userPublicColumns)
 * ```
 *
 * 用白名单而非 `Omit` 黑名单：新增列默认不对外，列的增删改都在这里编译期暴露。
 *
 * - `passwordHash` 需要时另行显式 select，不要加进来
 * - 单个接口需要额外字段时另建投影，不要撑大这份公共白名单
 * - `deletedAt` 刻意不对外：它是软删除的持久化标记，所有读路径都带 `isNull`，
 *   未删用户返回的它恒为 `null`
 */
export const userPublicColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
  role: users.role,
  points: users.points,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/** 对外用户响应：由白名单的键推导，与 SQL 投影同形 */
export type UserResponse = Pick<Users, keyof typeof userPublicColumns>;
