import { z } from 'zod';

import { paginationSchema } from '@/shared/validation.js';

/**
 * 会话 / 登录记录的列表 query。
 *
 * 这两类数据都是"最新在前"的流水，不提供自定义排序：可排的字段只有时间，
 * 加 `sortBy` 只会让前端多一个用不上的参数。
 */
export const querySessionsSchema = paginationSchema;

export type QuerySessionsDto = z.infer<typeof querySessionsSchema>;
