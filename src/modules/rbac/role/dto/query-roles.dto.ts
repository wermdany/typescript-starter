import { z } from 'zod';

import { paginationSchema, trimmedShape } from '@/shared/validation.js';

/**
 * 角色列表查询参数。
 *
 * 默认排序按项目约定是 `updatedAt` 降序；`level` 作为可选项保留，
 * 因为管理端偶尔需要"按权限高低看一遍"（判定逻辑不看 `level`，它只影响展示）。
 */
export const queryRolesSchema = paginationSchema.extend(
  trimmedShape({
    keyword: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .describe('按角色码或展示名模糊匹配'),
    sortBy: z
      .enum(['code', 'name', 'level', 'updatedAt'])
      .default('updatedAt')
      .describe('排序字段，默认 updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc').describe('排序方向，默认降序'),
  }),
);

export type QueryRolesDto = z.infer<typeof queryRolesSchema>;
