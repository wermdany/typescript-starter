import type { RoleCode } from '@/common/auth/auth.contract.js';
import { users, type Users } from '@/database/schema/users.schema.js';

/**
 * 认证用例查询用户时使用的全量白名单（无敏感列）。
 *
 * - 与 `modules/user` 的资料投影**刻意分开**：那个是"用户资料"的对外契约，
 *   这个只服务登录/会话用例，字段需求各自演进，两模块互不 import
 * - 同样不含 `passwordHash`：需要时另行显式 select
 * - **不含角色**：多角色在 `user_roles`，由 `AccountService.findRoleCodes()` 单独取
 */
export const authUserColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
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
 *
 * `role`（单数）已改为 `roles`（多角色），这是一次**破坏性契约变更**：
 * 角色来自 `user_roles` 关联表，顺序按 `roles.level` 降序。
 */
export interface UserSummary {
  id: number;
  studentNo: string;
  nickname: string;
  roles: readonly RoleCode[];
}
