import { z } from 'zod';

import { roleCodeSchema, trimmedShape } from '@/shared/validation.js';

/**
 * 创建角色的请求体。
 *
 * **没有 `isSystem`**：内置标记只由种子迁移写入。允许管理端自建"内置角色"
 * 等于允许造一个删不掉的角色，这类不可逆状态不该由一次 HTTP 请求产生。
 *
 * `code` 只校验格式（`roleCodeSchema`）；是否重名由数据库的部分唯一索引裁决，
 * 冲突经全局映射链转 409「角色码已存在」。
 */
export const createRoleSchema = z.object(
  trimmedShape({
    code: roleCodeSchema,
    name: z.string().min(1).max(50).describe('角色展示名，1~50 字，如「审计员」'),
    description: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('角色说明，1~200 字；省略则不写'),
    level: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .default(0)
      .describe('展示优先级，数值大者在前；默认 0'),
  }),
);

export type CreateRoleDto = z.infer<typeof createRoleSchema>;
