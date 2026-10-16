import { z } from 'zod';

/**
 * 通用分页 query 基础 schema。
 *
 * 各业务模块的列表查询 DTO 用 `.extend()` 追加自己的筛选/排序字段：
 *
 * @example
 * export const queryUsersSchema = paginationSchema.extend({
 *   keyword: z.string().optional(),
 * });
 *
 * 说明：HTTP query 参数天然是字符串，数字字段必须用 `z.coerce.number()`。
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;
