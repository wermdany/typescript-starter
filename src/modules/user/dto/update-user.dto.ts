import { z } from 'zod';

import { trimmedShape } from '../../../common/validation/trimmed.js';

/**
 * 更新用户资料请求体。
 *
 * 密码不在此接口修改——改密走 PATCH /users/:id/password。
 *
 * 字段均为可选且经首尾空白规范化：传空串 / 纯空白 / null 都等同"未提供该字段"，
 * 因此 `{"nickname": "   "}` 会被下面的 refine 判为"没有提供任何有效字段"而 400。
 */
export const updateUserSchema = z
  .object(
    trimmedShape({
      email: z.email().optional(),
      nickname: z.string().min(1).max(50).optional(),
      role: z.enum(['student', 'admin']).optional(),
      points: z.number().int().nonnegative().optional(),
    }),
  )
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: '至少提供一个更新字段',
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
