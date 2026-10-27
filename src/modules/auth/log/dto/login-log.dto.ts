import { z } from 'zod';

import {
  authLoginLogs,
  type AuthLoginLogs,
} from '@/database/schema/auth-login-logs.schema.js';
import { dateSchema, pageOf, schemaFor } from '@/shared/validation.js';

/**
 * 登录记录的对外字段**白名单**。
 *
 * - `userAgent` 不对外（管理员排查问题时走服务端查询，不走接口）
 * - `studentNo` 快照不对外：查的是自己的记录，学号是冗余信息
 * - `sessionId` 不对外：会话 ID 属于另一份资源的标识，不在这里顺带扩散
 */
export const loginLogPublicColumns = {
  id: authLoginLogs.id,
  success: authLoginLogs.success,
  failureReason: authLoginLogs.failureReason,
  ip: authLoginLogs.ip,
  createdAt: authLoginLogs.createdAt,
} as const;

/** 对外登录记录响应：由白名单键推导，与 SQL 投影同形 */
export type LoginLogResponse = Pick<
  AuthLoginLogs,
  keyof typeof loginLogPublicColumns
>;

/**
 * `LoginLogResponse` 的文档 schema。
 *
 * 字段与描述都写在 zod 上，`z.ZodType<LoginLogResponse>` 做编译期锚定：
 * 白名单加列、可空性或类型写错，`pnpm typecheck` 直接红。
 */
export const loginLogSchema = schemaFor<LoginLogResponse>()(
  z
  .object({
    id: z.number().int().describe('记录 ID（只增不改的流水号）'),
    success: z.boolean().describe('本次尝试是否成功'),
    failureReason: z
      .string()
      .nullable()
      .describe('失败原因：bad_credentials / rate_limited / token_replay；成功时为 null'),
    ip: z.string().describe('尝试登录时的客户端 IP'),
    createdAt: dateSchema.describe('尝试时间'),
  })
  .meta({ id: 'LoginLogResponse', description: '对外登录记录' }),
);

/** 登录记录分页列表的文档 schema */
export const loginLogPageSchema = pageOf(loginLogSchema).meta({
  id: 'LoginLogResponsePage',
});

