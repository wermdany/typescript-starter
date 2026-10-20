import type { Request } from 'express';

/**
 * 认证相关的**纯契约**：类型、状态码文案。不依赖 Nest、数据库与任何业务模块，
 * 因此 `shared`（守卫、装饰器）、`logger`、以及未来的其它业务模块都能安全引用。
 *
 * 放在 `common` 而不是 `modules/auth`：`shared/auth/auth.guard.ts` 需要它，而 shared 不允许依赖业务模块。
 */

/** 通过认证后挂在请求上的身份（来自会话 + 用户表，不含任何 token） */
export interface AuthenticatedUser {
  /** 用户 ID */
  id: number;
  /** 学号（登录账号） */
  studentNo: string;
  nickname: string;
  role: UserRole;
  /** 本次请求所依据的会话 ID（登出 / 踢设备要用） */
  sessionId: number;
}

/** 角色枚举的 TS 侧镜像，与 `users.schema.ts` 的 `userRoleEnum` 保持一致 */
export type UserRole = 'student' | 'teacher' | 'admin';

/** 认证中间件注入身份后的请求 */
export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

/** 未登录 / token 无效（401） */
export const UNAUTHENTICATED_MESSAGE = '请先登录';

/** 已登录但角色不足（403） */
export const FORBIDDEN_MESSAGE = '无权访问该资源';

/** 登录失败：账号不存在与密码错误共用同一文案，避免账号枚举（401） */
export const BAD_CREDENTIALS_MESSAGE = '学号或密码错误';

/** 登录尝试过于频繁（429） */
export const TOO_MANY_ATTEMPTS_MESSAGE = '登录尝试过于频繁，请稍后再试';

/** 管理员角色字面量：唯一出处，与 `users.schema.ts` 的 `userRoleEnum` 对齐 */
export const ADMIN_ROLE: UserRole = 'admin';

/**
 * 判断是否为管理员（**全部**越权判定的唯一入口，禁止手写 `role === 'admin'`）。
 *
 * 将来引入角色层级（如 owner）或权限点时，只改这一处函数。
 */
export function isAdmin(user: Pick<AuthenticatedUser, 'role'>): boolean {
  return user.role === ADMIN_ROLE;
}
