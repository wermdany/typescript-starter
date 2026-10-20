import {
  authSessions,
  type AuthSessions,
} from '@/database/schema/auth-sessions.schema.js';

/**
 * 会话的对外字段**白名单**（「我的设备」与管理员查看设备共用）。
 *
 * - **两个 token 哈希都不在其中**：它们只用于服务端比对，泄露即等于泄露登录态
 * - `userAgent` 不对外：可伪造、体积大、对用户判断"是不是我的设备"帮助有限，
 *   只留在库里做审计
 * - `expiresAt` 取会话硬上限（`refreshExpiresAt`）—— 对外只说"这个会话最晚活到什么时候"
 * - `revokedAt` / `revokedReason` 对外：用户可以分辨自己退出、被管理员踢出、
 *   还是因改密/重放被强制下线
 */
export const sessionPublicColumns = {
  id: authSessions.id,
  clientName: authSessions.clientName,
  clientType: authSessions.clientType,
  ip: authSessions.ip,
  lastUsedAt: authSessions.lastUsedAt,
  expiresAt: authSessions.refreshExpiresAt,
  revokedAt: authSessions.revokedAt,
  revokedReason: authSessions.revokedReason,
  createdAt: authSessions.createdAt,
} as const;

/** 白名单里改名的字段：对外名 → 物理列类型（目前只有 `refresh_expires_at` → `expiresAt`） */
export interface SessionRenamedFields {
  expiresAt: AuthSessions['refreshExpiresAt'];
}

/** SQL 投影的返回形状：白名单列 + 改名字段 */
export type SessionRow = Pick<
  AuthSessions,
  | 'id'
  | 'clientName'
  | 'clientType'
  | 'ip'
  | 'lastUsedAt'
  | 'revokedAt'
  | 'revokedReason'
  | 'createdAt'
> &
  SessionRenamedFields;

/**
 * 对外会话响应（与 SQL 投影同形）。
 *
 * 这里显式列出字段而不是 `Pick<AuthSessions, keyof typeof sessionPublicColumns>`：
 * 白名单里有改名（`expiresAt ← refreshExpiresAt`），键推导会要求表里存在同名字段。
 * 字段集合仍由 `session.projection.spec.ts` 冻结，加列必须同步改测试。
 */
export type SessionResponse = SessionRow;
