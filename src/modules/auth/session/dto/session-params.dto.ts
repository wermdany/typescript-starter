import { z } from 'zod';

import { idParamSchema } from '@/modules/user/dto/params.dto.js';

/**
 * 会话 / 用户相关的路径参数。
 *
 * 复用用户模块的 `idParamSchema`（`:id` 的规则全项目一份：正整数、拒绝空值与十六进制），
 * 会话 ID 与之同形，因此只做语义化别名，不另起一套正则。
 */
export const sessionIdParamSchema = idParamSchema;
export const userIdParamSchema = idParamSchema;

export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;

/** 管理员踢单台设备：`/users/:id/sessions/:sessionId` */
export const userSessionParamsSchema = z.object({
  id: userIdParamSchema,
  sessionId: sessionIdParamSchema,
});

export type UserSessionParams = z.infer<typeof userSessionParamsSchema>;
