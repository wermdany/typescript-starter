import { z } from 'zod';

/**
 * 通用分页 query 基础 schema，列表 DTO 用 `.extend()` 追加筛选/排序字段。
 *
 * HTTP query 天然是字符串，数字字段必须用 `z.coerce.number()`。
 *
 * @example
 * export const queryUsersSchema = paginationSchema.extend(
 *   trimmedShape({ keyword: z.string().min(1).optional() }),
 * );
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;
