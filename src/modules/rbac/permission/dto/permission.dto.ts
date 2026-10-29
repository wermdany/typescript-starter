import { z } from 'zod';

import { permissions, type Permissions } from '@/database/schema/rbac.schema.js';
import { dateSchema, pageOf, schemaFor } from '@/shared/validation.js';

/**
 * 权限点的对外字段**白名单**（响应契约的唯一出处）。
 *
 * 不含 `deletedAt`：读路径一律 `isNull`，未删行恒为 null，对外没有信息量。
 *
 * 这里没有派生字段 —— 权限点是纯字典行，管理端渲染授权矩阵只需要
 * "有哪些码、属于哪个分组、叫什么"。
 */
export const permissionPublicColumns = {
  id: permissions.id,
  code: permissions.code,
  name: permissions.name,
  description: permissions.description,
  group: permissions.group,
  isSystem: permissions.isSystem,
  createdAt: permissions.createdAt,
  updatedAt: permissions.updatedAt,
} as const;

/** 公开列投影的结果形态（= 对外响应；没有派生字段） */
export type PermissionResponse = Pick<
  Permissions,
  keyof typeof permissionPublicColumns
>;

/**
 * `PermissionResponse` 的文档 schema。
 *
 * 字段手写、`schemaFor<>()` 双向锚定：白名单加列而这里没跟上会直接编译报错。
 */
export const permissionResponseSchema = schemaFor<PermissionResponse>()(
  z
    .object({
      id: z.number().int().describe('权限点 ID'),
      code: z.string().describe('权限码，形如 user:read；* 为通配（仅超级管理员）'),
      name: z.string().describe('权限点名称'),
      description: z.string().nullable().describe('权限点说明；未填写为 null'),
      group: z.string().describe('管理端分组，通常等于资源段（user / session …）'),
      isSystem: z.boolean().describe('内置权限点：由迁移与 perm:sync 维护'),
      createdAt: dateSchema.describe('创建时间'),
      updatedAt: dateSchema.describe('最后修改时间'),
    })
    .meta({ id: 'PermissionResponse', description: '权限点字典行' }),
);

/** 权限点分页列表的文档 schema */
export const permissionPageSchema = pageOf(permissionResponseSchema).meta({
  id: 'PermissionResponsePage',
});
