import { z } from 'zod';

import { trimmedShape } from '@/shared/validation.js';

/**
 * 更新用户资料请求体（密码走 `PATCH /users/password/:id`）。
 *
 * 字段均为可选，语义严格：
 *
 * - **省略 key** ⇒ 不改动该字段
 * - **`""` / 纯空白** ⇒ 字段级 400（`min(1)`）
 * - **`null`** ⇒ 类型错误；RFC 7396 里 `null` 是"删除该字段"的显式指令，后端不代为解释
 *
 * 空对象 `{}` 报「至少提供一个更新字段」。
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
