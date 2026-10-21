import { z } from 'zod';

import { trimmedShape } from '@/shared/validation.js';
import { userRolesSchema } from './create-user.dto.js';

/**
 * 更新用户资料请求体（密码走 `PATCH /users/password`）。
 *
 * 字段权限走白名单（`update-policy.ts`）：本人只能改 `email` / `nickname`，
 * `roles` / `points` 仅管理员可改；schema 本身不感知权限。
 *
 * `roles` 语义是**整体替换**而非增量：传 `['student']` 就把该用户的角色集合
 * 收敛成这一个。增量式（换一个角色但保留其它）会让"到底最后剩哪些"依赖
 * 服务端历史状态，客户端无法预测结果，也测不出来。
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
      roles: userRolesSchema.optional(),
      points: z.number().int().nonnegative().optional(),
    }),
  )
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: '至少提供一个更新字段',
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
