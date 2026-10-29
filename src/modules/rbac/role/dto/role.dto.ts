import { z } from 'zod';

import { roles, type Roles } from '@/database/schema/rbac.schema.js';
import { dateSchema, pageOf, schemaFor } from '@/shared/validation.js';

/**
 * 角色的对外字段**白名单**（响应契约的唯一出处）。
 *
 * 白名单里不含 `deletedAt`：所有读路径都带 `isNull(deletedAt)`，
 * 未删角色返回的它恒为 `null`，对外说"已删除"没有信息量。
 */
export const rolePublicColumns = {
  id: roles.id,
  code: roles.code,
  name: roles.name,
  description: roles.description,
  level: roles.level,
  isSystem: roles.isSystem,
  createdAt: roles.createdAt,
  updatedAt: roles.updatedAt,
} as const;

/** 公开列投影的结果形态 */
export type RoleScalars = Pick<Roles, keyof typeof rolePublicColumns>;

/**
 * 对外角色响应 = 角色列 + 两个派生字段。
 *
 * 两个派生字段都进不了 `RETURNING`（来自关联表 / 聚合），由 service 批量补齐：
 * - `permissionCodes`：该角色已授予的权限码。**不是**通配 `*` 的展开结果 ——
 *   前端要展示"这个角色配了哪些权限点"，展开成几十个码反而看不出配置意图
 * - `userCount`：持有该角色的未删除用户数。列表上直接给出，管理端才能在删除
 *   被拒之前就解释清楚"为什么删不掉"
 */
export interface RoleResponse extends RoleScalars {
  permissionCodes: string[];
  userCount: number;
}

/**
 * 把"角色列 + 派生字段"合成为响应对象。
 *
 * 这里可以用 `...scalars` 展开（`file.dto.ts` 里刻意逐字段挑是为了挡住内部列泄漏）：
 * `RoleScalars` 恰好等于白名单键集合，没有"内部列混进来"的可能。
 */
export function toRoleResponse(
  scalars: RoleScalars,
  permissionCodes: string[],
  userCount: number,
): RoleResponse {
  return { ...scalars, permissionCodes, userCount };
}

/**
 * `RoleResponse` 的文档 schema。
 *
 * 字段与类型手写在这里，`schemaFor<RoleResponse>()` 做**双向**锚定：
 * 白名单加一列而这里没跟上、或类型/可空性写错，`pnpm typecheck` 直接红。
 * 描述就地写在字段上（`.describe()`），不另设说明表。
 */
export const roleResponseSchema = schemaFor<RoleResponse>()(
  z
    .object({
      id: z.number().int().describe('角色 ID'),
      code: z.string().describe('角色码（创建后不可修改；权限判定与前端常量都用它）'),
      name: z.string().describe('角色展示名'),
      description: z.string().nullable().describe('角色说明；未填写为 null'),
      level: z.number().int().describe('展示优先级，数值大者在前（判定时不看它）'),
      isSystem: z.boolean().describe('内置角色：种子迁移写入，管理端不可删除'),
      createdAt: dateSchema.describe('创建时间'),
      updatedAt: dateSchema.describe('最后修改时间'),
      permissionCodes: z
        .array(z.string())
        .describe('已授予的权限码；不含通配 * 的展开结果'),
      userCount: z.number().int().describe('持有该角色的用户数（未删除的绑定）'),
    })
    .meta({ id: 'RoleResponse', description: '角色及其授权' }),
);

/** 角色分页列表的文档 schema */
export const rolePageSchema = pageOf(roleResponseSchema).meta({
  id: 'RoleResponsePage',
});
