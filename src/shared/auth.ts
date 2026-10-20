/**
 * 认证基础件的统一出口：守卫、装饰器、token 与客户端信息工具、401/403/429 文案。
 *
 * 这一层只管"身份"：是否登录、是否管理员；业务权限点（RBAC）后续迭代再接。
 * 依赖 Nest 与 express，但**不依赖任何业务模块、数据库与配置** ——
 * 因此 `app.config.ts`（注册全局守卫）与后续模块都可以安全引用。
 *
 * @example
 * import { Public, CurrentUser, type AuthenticatedUser } from '@/shared/auth.js';
 */
export {
  ADMIN_ONLY_KEY,
  AdminOnly,
  PUBLIC_KEY,
  Public,
} from '@/shared/auth/decorators/auth.decorator.js';
export { CurrentUser } from '@/shared/auth/decorators/current-user.decorator.js';
export {
  AuthGuard,
  HttpAuthGuard,
  type AuthRequirement,
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
  TOO_MANY_ATTEMPTS_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
  type UserRole,
} from '@/common/auth/auth.contract.js';
