import { users, type Users } from '@/database/schema/users.schema.js';

/**
 * 认证用例查询用户时使用的全量白名单（无敏感列）。
 *
 * - 与 `modules/user/user.projection.ts` 的 `userPublicColumns` **刻意分开**：
 *   那个是"用户资料"的对外契约，这个只服务登录/会话用例，字段需求各自演进，
 *   两模块互不 import
 * - 同样不含 `passwordHash`：需要时另行显式 select
 */
export const authUserColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
  role: users.role,
  points: users.points,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/** 认证用例里的用户记录 */
export type AuthUser = Pick<Users, keyof typeof authUserColumns>;

/**
 * 登录响应里内嵌的用户摘要。
 *
 * 只含前端登录后立即可用的身份字段；**不含** `points` / `createdAt` 等资料字段
 * （需要完整资料时走 `GET /users/:id`），也**不含** `passwordHash`。
 */
export const userSummaryColumns = {
  id: users.id,
  studentNo: users.studentNo,
  nickname: users.nickname,
  role: users.role,
} as const;

/** 登录响应里的用户摘要 */
export type UserSummary = Pick<Users, keyof typeof userSummaryColumns>;
