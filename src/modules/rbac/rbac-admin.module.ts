import { Module } from '@nestjs/common';

import { PermissionController } from './permission/permission.controller.js';
import { PermissionCatalogService } from './permission/permission-catalog.service.js';
import { RbacModule } from './rbac.module.js';
import { RoleController } from './role/role.controller.js';
import { RoleService } from './role/role.service.js';

/**
 * RBAC 管理端（**业务 API**，与运行时的 `RbacModule` 分开）。
 *
 * 分开的理由不是"模块大小"：
 * - `RbacModule` 是 `@Global` 的基础设施 provider（守卫与 service 直接注入它），
 *   它的变更影响每一个请求
 * - 这里挂的是管理端路由（`/roles`、`/permissions`），属于业务接口，
 *   将来要按环境关掉管理端时，摘掉 `AppModule` 里的这一行即可，运行时鉴权不受影响
 *
 * 依赖方向：本模块 import `RbacModule` 拿 `PermissionService`（授权变更后清缓存），
 * 反向没有引用 —— 运行时模块不知道管理端存在。
 */
@Module({
  imports: [RbacModule],
  controllers: [RoleController, PermissionController],
  providers: [RoleService, PermissionCatalogService],
})
export class RbacAdminModule {}
