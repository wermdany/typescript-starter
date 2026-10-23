/**
 * 认证**纯工具**的统一出口：归属断言、token、客户端信息、401/403/429 文案。
 *
 * 这一层只管"身份相关的纯计算/纯断言"，**不含 Nest 组件** ——
 * 守卫与访问意图装饰器在 `@/common/auth/`（`access.guard.ts` / `access.decorator.ts`），
 * 因为它们是横切能力、由 `common/http-stages.ts` 统一注册。
 *
 * 依赖 Nest（`assertOwnership` 抛 `ForbiddenException`）与 express，但**不依赖任何
 * 业务模块、数据库与配置**，因此 `modules/*` 的 service 与 Controller 都可以安全引用。
 *
 * @example
 * import {
 *   PERMISSION_CHECKER,
 *   assertOwnership,
 *   isSystemActor,
 *   type Actor,
 *   type PermissionChecker,
 * } from '@/shared/auth.js';
 */
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
