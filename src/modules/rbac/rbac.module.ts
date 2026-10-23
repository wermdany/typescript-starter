import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PERMISSION_CHECKER } from '@/common/auth/permission.contract.js';
import { PermissionGuard, HttpPermissionGuard } from '@/shared/auth/auth.guard.js';
import { PermissionService } from './permission.service.js';

/**
 * RBAC 运行时模块：**权限点鉴权的全局守卫注册**（与 `shared/auth` 的登录态守卫生效分层）。
 *
 * | 能力 | 注册处 |
 * | --- | --- |
 * | 登录态 | `shared/auth/auth.module.ts`（APP_GUARD）—— 只判"有没有身份"，不判角色 |
 * | 业务权限点 | **本模块**（APP_GUARD，读 `@RequirePermission` / `@OwnerOrPermission`） |
 *
 * **本模块是 `@Global`**：`PERMISSION_CHECKER` 需要在 service 里做第二道防线
 * （`UserService.mayActOnOthers()`：跨用户操作的准入问权限码，不问角色）。
 * 业务模块之间不互相 import，靠全局 provider 注入，避免为了拿到权限解析器而反向依赖本模块
 * （与 `DatabaseModule` 同为基础设施层的 `@Global` 模块）。
 *
 * ⚠️ 回滚开关的边界变了：删掉 `app.core.module.ts` 里的本行 import 仍能关掉**全局权限守卫**
 * （路由级鉴权回到"只判登录态"），但直接注入 `PERMISSION_CHECKER` 的 service 会启动失败。
 * 真要整体回滚，连这些 service 的判定一起改回"只判归属"。
 */
@Global()
@Module({
  providers: [
    // 纯逻辑守卫：HttpPermissionGuard 的判定内核，也供测试直接构造
    PermissionGuard,
    // 权限码解析（带 Tier-1 缓存；契约在 common，实现在这里）
    { provide: PERMISSION_CHECKER, useClass: PermissionService },
    // 全局守卫：无身份 401 / 权限不足 403
    { provide: APP_GUARD, useClass: HttpPermissionGuard },
  ],
  exports: [PERMISSION_CHECKER],
})
export class RbacModule {}
