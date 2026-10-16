import { z } from 'zod';

import { paginationSchema } from '../../../common/pagination/pagination.schema.js';
import { trimmedShape } from '../../../common/validation/trimmed.js';

/**
 * 用户分页列表查询参数。
 *
 * 全部条件均为可选（`page`/`pageSize`/`sortBy`/`order` 带默认值）——
 * 不传任何条件时即查第一页、每页 10 条、**按修改时间倒序**（见 AGENTS.md 第 7 节
 * 「默认排序：修改时间降序」：最近改动过的记录排在最前，与创建时间无关）。
 * 传空串 / 纯空白同样视为"未提供"（走默认值或不参与筛选）。
 *
 * - keyword：模糊匹配昵称 / 学号 / 邮箱
 * - role：按角色精确筛选
 * - sortBy/order：排序（默认 `updatedAt` 降序；`createdAt` 仍可选，用于"按入库顺序"场景）
 * - 枚举值大小写敏感（`' ASC '` 会被 trim 成 `'ASC'` 并因非法而 400）
 */
export const queryUsersSchema = paginationSchema.extend(
  trimmedShape({
    keyword: z.string().min(1).max(50).optional(),
    role: z.enum(['student', 'admin']).optional(),
    sortBy: z
      .enum(['nickname', 'studentNo', 'email', 'points', 'createdAt', 'updatedAt'])
      .default('updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }),
);

export type QueryUsersDto = z.infer<typeof queryUsersSchema>;
