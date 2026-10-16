import { z } from 'zod';

import { trimmedShape } from '../../../common/validation/trimmed.js';

/**
 * 更新用户资料请求体。
 *
 * 密码不在此接口修改——改密走 PATCH /users/:id/password。
 *
 * 字段均为可选，语义是**严格的三态**（AGENTS.md 第 6 节）：
 *
 * - **省略 key** ⇒ 不改动该字段
 * - **`""` / 纯空白** ⇒ 拒绝（`min(1)`）；要清空文本字段请用专门的接口，不要用空串
 * - **`null`** ⇒ 拒绝（类型错误）。RFC 7396 里 `null` 是"删除该字段"的显式指令，
 *   后端不做宽恕——否则"前端忘了传 null 字段"会被误判成"想清空"，静默改数据
 *
 * 因此 `{ "nickname": "" }`、`{ "role": "" }` 都报字段级 400，
 * 而空对象 `{}` 落到下面的 refine，报「至少提供一个更新字段」。
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
