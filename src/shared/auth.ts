/**
 * 认证基础件的统一出口：守卫、装饰器、token 与客户端信息工具、401/403/429 文案。
 *
 * 这一层只管"身份"：是否登录；管理员与业务权限点都由 RBAC 层（`PermissionGuard`）管。
 * 依赖 Nest 与 express，但**不依赖任何业务模块、数据库与配置** ——
 * 因此 `shared/auth/auth.module.ts`（注册全局守卫）与后续模块都可以安全引用。
 *
 * @example
 * import { Public, CurrentUser, type AuthenticatedUser } from '@/shared/auth.js';
 */
export {
  AUTHENTICATED_KEY,
  Authenticated,
  PUBLIC_KEY,
  Public,
} from '@/shared/auth/decorators/auth.decorator.js';
export {
  OWNER_KEY,
  PERMISSION_KEY,
  OwnerOrPermission,
  RequirePermission,
  type OwnerRequirement,
} from '@/shared/auth/decorators/rbac.decorator.js';
export { CurrentUser } from '@/shared/auth/decorators/current-user.decorator.js';
export {
  OWNERSHIP_DENIED_MESSAGE,
  assertOwnership,
} from '@/shared/auth/ownership.js';
export {
  SYSTEM_ACTOR_ID,
  actorIdOf,
  isSystemActor,
  ownsResource,
  systemActor,
  type Actor,
  type SystemActor,
} from '@/common/auth/ownership.contract.js';
export {
  AuthGuard,
  HttpAuthGuard,
  HttpPermissionGuard,
  PermissionGuard,
  type AuthRequirement,
  type PermissionContext,
  type PermissionRequirement,
} from '@/shared/auth/auth.guard.js';
export { ADMIN_ROLE, isAdmin } from '@/common/auth/auth.contract.js';
export {
  DUMMY_PASSWORD_HASH,
  generateToken,
  hashToken,
} from '@/shared/auth/token.js';
export {
  UNKNOWN_CLIENT_NAME,
  USER_AGENT_MAX_LENGTH,
  describeClient,
  normalizeUserAgent,
  resolveClientIp,
  type ClientInfo,
  type ClientType,
} from '@/shared/auth/client-info.js';
export {
  BAD_CREDENTIALS_MESSAGE,
  FORBIDDEN_MESSAGE,
  ROLE_CODES,
  TOO_MANY_ATTEMPTS_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  hasAnyRole,
  hasRole,
  type AuthenticatedUser,
  type RoleCode,
  type UserRole,
} from '@/common/auth/auth.contract.js';
export {
  PERMISSION_CHECKER,
  PERMISSION_DENIED_MESSAGE,
  WILDCARD_PERMISSION,
  type PermissionChecker,
  type PermissionCode,
  type PermissionSubject,
} from '@/common/auth/permission.contract.js';
