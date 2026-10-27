import { z } from 'zod';

import type { PageResponse } from './paginate.js';

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
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('页码，从 1 开始'),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe('每页条数，上限 100'),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/**
 * 分页响应的 zod schema（用于接口文档）。
 *
 * 返回类型写成 `z.ZodType<PageResponse<T>>` 是刻意的：泛型钉在 `paginate()` 的
 * 返回类型上，分页字段哪天改了，这里编译期就红，不需要人眼对账。
 *
 * @example
 * export const userPageSchema = pageOf(userResponseSchema).meta({ id: 'UserResponsePage' });
 */
export function pageOf<T>(item: z.ZodType<T>): z.ZodType<PageResponse<T>> {
  return z.object({
    items: z.array(item).describe('当前页的数据'),
    total: z.number().describe('满足条件的总条数（不受分页影响）'),
    page: z.number().describe('当前页码，从 1 开始'),
    pageSize: z.number().describe('每页条数'),
    totalPages: z.number().describe('总页数'),
  });
}
