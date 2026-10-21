import type { Request } from 'express';

/**
 * 认证相关的**纯契约**：类型、状态码文案。不依赖 Nest、数据库与任何业务模块，
 * 因此 `shared`（守卫、装饰器）、`logger`、以及未来的其它业务模块都能安全引用。
 *
 * 放在 `common` 而不是 `modules/auth`：`shared/auth/auth.guard.ts` 需要它，而 shared 不允许依赖业务模块。
 */

/**
 * 业务角色码全集（内置角色）。
 *
 * 与 `roles.code` 一致：内置三个属于"系统角色"，运行时可再往 `roles` 表里加
 * （本常量是内置集合的编译期镜像，不约束数据表）。
 *
 * 之所以导出**运行时数组**而不只是类型：DTO 校验（`z.enum(ROLE_CODES)`）与
 * 类型（`RoleCode`）必须出自同一处，否则加角色时会漏改其中一边。
 */
export const ROLE_CODES = ['student', 'teacher', 'admin'] as const;

/** 业务角色码。与 `roles.code` 一致 */
export type RoleCode = (typeof ROLE_CODES)[number];

/** 角色枚举的 TS 侧镜像，与 `database/schema/rbac.schema.ts` 的 `roles.code` 保持一致 */
export type UserRole = RoleCode;

/** 通过认证后挂在请求上的身份（来自会话 + 用户表 + user_roles，不含任何 token） */
export interface AuthenticatedUser {
  /** 用户 ID */
  id: number;
  /** 学号（登录账号） */
  studentNo: string;
  nickname: string;
  /**
   * 角色集合（多角色）。
   *
   * - 顺序不作保证，**不要**用 `roles[0]` 当"主角色"
   * - 迁移期由 `0005` 回填保证"每个用户至少一个角色"，但代码不得依赖该假设
   *   做安全判定：空数组在 `hasRole()` 下自然为 false（fail-closed）
   */
  roles: readonly RoleCode[];
  /** 本次请求所依据的会话 ID（登出 / 踢设备要用） */
  sessionId: number;
}

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

/** 管理员角色字面量：唯一出处，与 `roles.code` 中的超级管理员一致 */
export const ADMIN_ROLE: RoleCode = 'admin';

/** 角色集合的最小结构（只要求有 `roles`，便于纯函数复用与测试构造） */
type RoleHolder = { roles: readonly RoleCode[] };

/**
 * 是否持有某个角色（多角色判定的**唯一**原语）。
 *
 * 空数组 / 缺字段一律返回 false —— 权限判定永远 fail-closed。
 */
export function hasRole(user: RoleHolder, role: RoleCode): boolean {
  return user.roles.includes(role);
}

/** 是否持有给定角色中的**任意一个**（OR 语义；空入参为 false） */
export function hasAnyRole(
  user: RoleHolder,
  roles: readonly RoleCode[],
): boolean {
  return roles.some((role) => user.roles.includes(role));
}

/**
 * 判断是否为超级管理员（**全部**越权判定的唯一入口，禁止手写
 * `roles.includes('admin')`）。
 *
 * 语义：持有 `admin` 角色即超级管理员。权限粒度判定应改用权限码
 * （`@RequirePermission`），不要拿本函数当业务分支条件。
 */
export function isAdmin(user: RoleHolder): boolean {
  return hasRole(user, ADMIN_ROLE);
}
