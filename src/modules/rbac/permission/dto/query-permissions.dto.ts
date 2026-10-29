import { z } from 'zod';

import { paginationSchema, trimmedShape } from '@/shared/validation.js';

/**
 * 权限点列表查询参数。
 *
 * `group` 单独给一个等值筛选：管理端渲染授权矩阵时按资源分组展示，
 * 一次取一组比前端自己切更省一次全量传输。
 */
export const queryPermissionsSchema = paginationSchema.extend(
  trimmedShape({
    group: z
      .string()
      .min(1)
      .max(32)
      .optional()
      .describe('按分组筛选（如 user / session / login-log）'),
    keyword: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('按权限码或名称模糊匹配'),
    sortBy: z
      .enum(['code', 'group', 'updatedAt'])
      .default('updatedAt')
      .describe('排序字段，默认 updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc').describe('排序方向，默认降序'),
  }),
);

export type QueryPermissionsDto = z.infer<typeof queryPermissionsSchema>;
