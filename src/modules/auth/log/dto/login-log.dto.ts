import {
  authLoginLogs,
  type AuthLoginLogs,
} from '@/database/schema/auth-login-logs.schema.js';

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
