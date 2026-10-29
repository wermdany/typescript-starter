import { z } from 'zod';

import { trimmedShape } from '@/shared/validation.js';

/**
 * 更新角色的请求体。
 *
 * **`code` 不在可改字段里**：角色码是权限判定的输入（装饰器、前端常量、日志检索都用它），
 * 改码等于让"谁有什么权限"在无感知的情况下换了一套名字；要换码就新建角色再迁移绑定。
 *
 * `description` 允许显式传 `null` 表示清空 —— 这是 RFC 7396 的语义，
 * 与"省略该键 = 不修改"是两件事，因此用 `.nullable()` 而不是把 `''` 当清空。
 */
export const updateRoleSchema = z
  .object(
    trimmedShape({
      name: z.string().min(1).max(50).optional().describe('角色展示名，1~50 字'),
      description: z
        .string()
        .min(1)
        .max(200)
        .nullable()
        .optional()
        .describe('角色说明；传 null 表示清空，省略表示不修改'),
      level: z
        .number()
        .int()
        .min(0)
        .max(1000)
        .optional()
        .describe('展示优先级，数值大者在前'),
    }),
  )
  .refine(
    (dto) =>
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.level !== undefined,
    { message: '至少提供一个可修改字段（name / description / level）' },
  );

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
