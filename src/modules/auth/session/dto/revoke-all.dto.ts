import { z } from 'zod';

import { trimmedShape } from '@/shared/validation.js';

/**
 * 退出全部设备的可选参数。
 *
 * - `keepCurrent` 默认 `false`：默认连当前设备一起踢（"退出所有设备"的直觉语义）
 * - 传 `true` 表示保留本机，只踢其它设备
 *
 * 放在请求体里而不是 query：这是一个有副作用的指令，语义应显式表达。
 */
export const revokeAllSchema = z.object(
  trimmedShape({
    keepCurrent: z
      .boolean()
      .default(false)
      .describe('true = 保留本机，只踢其它设备；默认 false（连当前设备一起踢）'),
  }),
);

export type RevokeAllDto = z.infer<typeof revokeAllSchema>;

/**
 * 退出全部设备的结果（**唯一出处**，`revoke-all` 的响应）。
 *
 * 计算值，不是表行：schema 是唯一出处，类型由 `z.infer` 推。
 */
export const revokeAllResultSchema = z
  .object({
    revoked: z.number().int().describe('实际被吊销的会话数'),
    currentRevoked: z
      .boolean()
      .describe('本次请求自身的会话是否也被吊销（决定前端是否清本地登录态）'),
  })
  .meta({ id: 'RevokeAllResult' });

export type RevokeAllResult = z.infer<typeof revokeAllResultSchema>;

/** 管理员批量踢出时的响应（`DELETE /users/sessions/:id`） */
export const revokedCountSchema = z
  .object({ revoked: z.number().int().describe('实际被吊销的会话数') })
  .meta({ id: 'RevokedCount' });


