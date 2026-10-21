import type { RoleCode } from '@/common/auth/auth.contract.js';
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
 *
 * 这里只放**单表列**：`roles` 来自 `user_roles` 关联表，不能进 RETURNING
 * （PostgreSQL 的 RETURNING 不允许子查询），所以由 `UserResponse` 单独声明、
 * 由 service 用一次批量查询补齐（见 `UserService.rolesOf`）。
 */
export const userPublicColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
  points: users.points,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/** 单表列投影的结果形态（数据库直接返回的部分） */
export type UserScalars = Pick<Users, keyof typeof userPublicColumns>;

/**
 * 对外用户响应 = 公开列 + 角色集合。
 *
 * `roles` 是**派生**字段（来自 `user_roles`），与 `AuthenticatedUser.roles` 同源，
 * 客户端拿到的角色集合与鉴权时用的那一份不会有两套真相。
 * 顺序按 `roles.level` 降序、`code` 升序稳定排列。
 */
export interface UserResponse extends UserScalars {
  roles: RoleCode[];
}

/** 把"公开列 + 角色集合"合成为响应对象 */
export function toUserResponse(
  scalars: UserScalars,
  roles: RoleCode[],
): UserResponse {
  return { ...scalars, roles };
}
