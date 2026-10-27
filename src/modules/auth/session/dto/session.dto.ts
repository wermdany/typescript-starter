import { z } from 'zod';

import {
  authSessions,
  type AuthSessions,
} from '@/database/schema/auth-sessions.schema.js';
import { dateSchema, pageOf, schemaFor } from '@/shared/validation.js';

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
 * 字段集合仍由本子域的契约测试冻结，加列必须同步改测试。
 */
export type SessionResponse = SessionRow;

/**
 * 会话 + 是否当前请求所用（列表里给前端标出「本机」）。
 *
 * `current` 来自请求上下文而不是数据库列，所以这里用交叉类型补一个字段；
 * 其余字段与 `SessionResponse` 同源（列白名单），不另抄一遍。
 */
export type SessionWithCurrent = SessionResponse & { current: boolean };

/**
 * 会话 + 是否当前请求所用（文档 schema）。
 *
 * 字段与描述都写在 zod 上，`z.ZodType<SessionWithCurrent>` 做编译期锚定：
 * 白名单加列、可空性或类型写错，`pnpm typecheck` 直接红。
 *
 * 不单独导出裸会话的 schema：没有任何路由返回不带 `current` 的会话，
 * 而没人引用的 schema 不会进 `components`，留着只会变成"以为文档里有、其实没有"的假象。
 */
export const sessionWithCurrentSchema = schemaFor<SessionWithCurrent>()(
  z
  .object({
    id: z.number().int().describe('会话 ID（踢单台设备时用它）'),
    clientName: z
      .string()
      .describe('设备展示名，如「Chrome · macOS」；识别不出时为「未知设备」'),
    clientType: z.string().describe('设备形态：web / mobile / desktop'),
    ip: z.string().describe('登录时的客户端 IP'),
    lastUsedAt: dateSchema
      .nullable()
      .describe('最近一次使用时间；从未使用过为 null'),
    expiresAt: dateSchema.describe(
      '会话硬上限（refreshToken 的最晚有效期）；续期不会延长它',
    ),
    revokedAt: dateSchema.nullable().describe('被吊销的时间；仍有效时为 null'),
    revokedReason: z
      .string()
      .nullable()
      .describe(
        '吊销原因：logout / user_revoke_all / admin_revoke / password_changed / account_deleted / token_replay',
      ),
    createdAt: dateSchema.describe('会话创建时间（即登录时间）'),
    current: z
      .boolean()
      .describe('是否是本次请求所用的会话（前端据此标出「本机」）'),
  })
  .meta({ id: 'SessionWithCurrent', description: '会话 + 是否本机' }),
);


/** 会话分页列表的文档 schema */
export const sessionPageSchema = pageOf(sessionWithCurrentSchema).meta({
  id: 'SessionWithCurrentPage',
});

