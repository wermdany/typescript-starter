import { z } from 'zod';

import { paginationSchema, trimmedShape } from '@/shared/validation.js';
import { userRoleSchema } from './create-user.dto.js';

/**
 * 用户分页列表查询参数。
 *
 * - keyword：模糊匹配昵称 / 学号 / 邮箱
 * - role：筛"持有该角色"的用户（多角色语义 = 命中任一绑定即可，OR 而非 AND；
 *   需要交集筛选时再加 `roles` 数组参数，不要在这个单值参数上叠加含义）
 * - 排序默认 `updatedAt` 降序（最近改动的排在最前）
 *
 * query 的空值是传输层假象，由 `ZodValidationPipe` 在校验前归一化为「未提供」；
 * schema 本身保持严格。
 */
export const queryUsersSchema = paginationSchema.extend(
  trimmedShape({
    keyword: z.string().min(1).max(50).optional(),
    role: userRoleSchema.optional(),
    sortBy: z
      .enum([
        'nickname',
        'studentNo',
        'email',
        'points',
        'createdAt',
        'updatedAt',
      ])
      .default('updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }),
);

export type QueryUsersDto = z.infer<typeof queryUsersSchema>;
