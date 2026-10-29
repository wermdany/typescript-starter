/**
 * 权限判定的**纯契约**：`PermissionChecker` 接口、DI token、403 文案。
 *
 * 与 `auth.contract.ts` 同层同风格 —— 不依赖 Nest、数据库与任何业务模块，
 * 因此 `shared`（守卫）与 `modules/rbac`（实现类）都能安全引用，依赖方向不会反转。
 */

/** 权限码：`资源:动作`（如 `user:read`）；`*` 为通配 */
export type PermissionCode = string;

/** 通配权限码：持有它即拥有全部权限（超级管理员） */
export const WILDCARD_PERMISSION: PermissionCode = '*';

/**
 * 权限解析的输入：只需要角色码集合。
 *
 * 刻意只声明最小形状而不直接引用 `AuthenticatedUser` —— `AuthenticatedUser`
 * 的 `roles: readonly string[]` 天然满足本接口，契约文件本身不必跟着改。
 */
export interface PermissionSubject {
  readonly roles: readonly string[];
}

/**
 * 权限解析器：把身份解析成其持有的权限码集合。
 *
 * 入参是**身份**而非角色 —— 多角色取并集由实现类完成，将来换存储（库 / 配置 / 远端）
 * 不需要改动本接口。
 */
export interface PermissionChecker {
  /**
   * 解析身份持有的全部权限码。
   *
   * 实现类负责缓存（Tier-1：角色 → 权限码）与失败时的 fail-closed 处理。
   */
  resolveCodes(user: PermissionSubject): Promise<ReadonlySet<PermissionCode>>;
}

/** `PermissionChecker` 的 DI token（实现类由 `modules/rbac` 提供） */
export const PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');

/** 已登录但权限不足（403） */
export const PERMISSION_DENIED_MESSAGE = '无权执行该操作';
