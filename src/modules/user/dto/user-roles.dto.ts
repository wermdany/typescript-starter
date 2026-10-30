import { z } from 'zod';

import {
  roles,
  userRoles,
  type Roles,
} from '@/database/schema/rbac.schema.js';
import { dateSchema, schemaFor } from '@/shared/validation.js';
import { userRolesSchema } from './create-user.dto.js';

/**
 * 用户角色绑定的对外字段**白名单**。
 *
 * 跨两张表：`roles` 提供角色本身的展示信息，`user_roles` 提供授权留痕。
 * 两者在 service 里由一次 `innerJoin` 取回，因此这里可以写成同一个对象。
 *
 * 不含 `user_roles.deletedAt`：所有读路径都带 `isNull(deletedAt)`，
 * 未删绑定的它恒为 `null`，对外说"已解除"没有信息量。
 */
export const userRolePublicColumns = {
  id: roles.id,
  code: roles.code,
  name: roles.name,
  description: roles.description,
  level: roles.level,
  isSystem: roles.isSystem,
  grantedBy: userRoles.grantedBy,
  grantedAt: userRoles.createdAt,
} as const;

/** 角色详情 + 授权留痕（两次查询结果的合体形态） */
export type UserRoleScalars = Pick<
  Roles,
  'id' | 'code' | 'name' | 'description' | 'level' | 'isSystem'
> & {
  grantedBy: string | null;
  grantedAt: Date;
};

/**
 * 用户身上的**一个**角色绑定。
 *
 * 与 `UserResponse.roles`（只有角色码）的分工：那份是"鉴权用的口径"，
 * 这份是"管理端渲染用的口径" —— 要显示角色名、等级、以及谁在什么时候授予的。
 * 只有码的话，前端得再拉一次全量角色表做映射，既多一次请求，也丢掉了留痕。
 */
export type UserRoleResponse = UserRoleScalars;

/** `UserRoleResponse` 的文档 schema（`schemaFor` 做双向类型锚定） */
export const userRoleResponseSchema = schemaFor<UserRoleResponse>()(
  z
    .object({
      id: z.number().int().describe('角色 ID'),
      code: z
        .string()
        .describe('角色码（权限判定与前端常量都用它；创建后不可修改）'),
      name: z.string().describe('角色展示名'),
      description: z.string().nullable().describe('角色说明；未填写为 null'),
      level: z
        .number()
        .int()
        .describe('展示优先级，数值大者在前（判定权限时不看它）'),
      isSystem: z.boolean().describe('内置角色：种子迁移写入，管理端不可删除'),
      grantedBy: z
        .string()
        .nullable()
        .describe('授权来源留痕：触发的权限码，或 seed / migration'),
      grantedAt: dateSchema.describe('该角色的授予时间'),
    })
    .meta({ id: 'UserRoleResponse', description: '用户身上的一个角色绑定' }),
);

/** 用户角色绑定列表的文档 schema */
export const userRoleListSchema = z
  .array(userRoleResponseSchema)
  .meta({ id: 'UserRoleResponseList', description: '用户的角色绑定列表' });

/**
 * 整体替换用户角色的请求体。
 *
 * 复用 `create-user.dto` 的 `userRolesSchema`：同一份请求字段（角色码集合）
 * 在两个入口必须长得一样 —— `min(1)` 拒绝零角色用户、重复元素直接报错，
 * 这两条规则只写一次，不在两处各维护一份。
 *
 * 标识用**角色码**而不是 `roleId`：`PATCH /users/:id` 的 `roles` 字段、
 * 创建用户、以及筛选条件用的都是码。同一个资源在两条入口上换成两种标识，
 * 客户端就要维护两张映射表，且"码改了 id 没变"这类不一致迟早出现。
 */
export const replaceUserRolesSchema = z.object({
  roles: userRolesSchema.describe(
    '角色码集合（整体替换语义；至少一个，不允许重复）',
  ),
});

export type ReplaceUserRolesDto = z.infer<typeof replaceUserRolesSchema>;
