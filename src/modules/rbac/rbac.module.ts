import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PERMISSION_CHECKER } from '@/common/auth/permission.contract.js';
import { PermissionGuard, HttpPermissionGuard } from '@/shared/auth/auth.guard.js';
import { PermissionService } from './permission.service.js';

/**
 * RBAC 运行时模块：**权限点鉴权的全局守卫注册**（与 `shared/auth` 的登录态守卫生效分层）。
 *
 * | 能力 | 注册处 |
 * | --- | --- |
 * | 登录态 / 管理员 | `shared/auth/auth.module.ts`（APP_GUARD） |
 * | 业务权限点 | **本模块**（APP_GUARD，读 `@RequirePermission` / `@OwnerOrPermission`） |
 *
 * 回滚开关：把本模块从 `app.core.module.ts` 的 `imports` 里删掉一行，
 * 鉴权行为即回到"只判登录态"的上一版，不需要动任何业务代码。
 */
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
