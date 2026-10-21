import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';
import { users } from './users.schema.js';

/**
 * RBAC 数据底座：角色 / 权限点 / 角色授权 / 用户角色 四张表。
 *
 * 设计要点：
 * - `roles.code` 是 `varchar` **而不是 pgEnum** —— 运行时增删角色不需要迁移
 *   （代价：失去编译期的角色全集检查，角色码的合法性只能在运行时校验）
 * - 权限取**并集**：`granted(user) = ⋃ permissions(r)`，r 取自 `user_roles`
 * - 软删后 code 可复用 ⇒ 唯一约束一律用**部分唯一索引**（`*_alive_idx`）
 */

/** 角色字典 */
export const roles = pgTable(
  'roles',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /**
     * 角色码：`student` / `teacher` / `admin`。
     *
     * varchar 而非 pgEnum：真正实现"运行时新增角色不需要 migration"。
     */
    code: varchar('code', { length: 32 }).notNull(),
    /** 展示名，如 `超级管理员` / `教师` / `学生` */
    name: varchar('name', { length: 50 }).notNull(),
    description: varchar('description', { length: 200 }),
    /** 展示用优先级（数大者优先）；多角色只有展示需要它，判定一律取并集 */
    level: integer('level').notNull().default(0),
    /** 内置角色：管理端不可删除，避免误删基础角色导致无人可登录 */
    isSystem: boolean('is_system').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    // 软删后 code 可复用 ⇒ 用部分唯一索引而非列级 unique
    uniqueIndex('roles_code_alive_idx')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** 权限点字典：一条 = 一个"可被拒绝的动作" */
export const permissions = pgTable(
  'permissions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** 权限码：`资源:动作`（如 `user:read`），`*` 为通配 */
    code: varchar('code', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 64 }).notNull(),
    description: varchar('description', { length: 200 }),
    /** 管理端分组：`user` / `session` / `login-log` … */
    group: varchar('group', { length: 32 }).notNull().default('general'),
    /** 内置权限点：管理端不可删除 */
    isSystem: boolean('is_system').notNull().default(true),
    ...timestamps(),
  },
  (t) => [index('permissions_group_idx').on(t.group)],
);

/** 角色 ↔ 权限多对多 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('role_permissions_role_permission_idx').on(
      t.roleId,
      t.permissionId,
    ),
    // 反向索引：按权限码反查"哪些角色持有它"
    index('role_permissions_permission_idx').on(t.permissionId),
  ],
);

/** 用户 ↔ 角色多对多：一个用户可有多个角色，权限取并集 */
export const userRoles = pgTable(
  'user_roles',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * 存 `role_id` 而非 `role_code`：将来重命名角色的展示名与 code 都不动数据。
     */
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** 授权来源（seed / migration / admin:{id} / api），留痕用 */
    grantedBy: varchar('granted_by', { length: 64 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('user_roles_user_role_alive_idx')
      .on(t.userId, t.roleId)
      .where(sql`${t.deletedAt} IS NULL`),
    // 反向索引：列出该角色的全部成员
    index('user_roles_role_idx').on(t.roleId),
    // 每次认证请求的唯一热点查询
    index('user_roles_user_alive_idx')
      .on(t.userId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Roles = typeof roles.$inferSelect;
export type NewRoles = typeof roles.$inferInsert;

export type Permissions = typeof permissions.$inferSelect;
export type NewPermissions = typeof permissions.$inferInsert;

export type RolePermissions = typeof rolePermissions.$inferSelect;
export type NewRolePermissions = typeof rolePermissions.$inferInsert;

export type UserRoles = typeof userRoles.$inferSelect;
export type NewUserRoles = typeof userRoles.$inferInsert;
