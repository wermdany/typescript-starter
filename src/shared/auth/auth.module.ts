import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthGuard, HttpAuthGuard } from './auth.guard.js';

/**
 * 认证子模块：**登录态**的全局守卫注册。
 *
 * - `AuthGuard`：纯逻辑（不碰 HTTP 上下文），可独立单测 —— 只判"有没有身份"
 * - `HttpAuthGuard`：翻译 `ExecutionContext` + 读 `@Public()` 元数据
 *
 * 身份由 `modules/auth/session` 的认证中间件查会话后写入 `req.user`；
 * 守卫不查库。管理员与权限点由 `rbac.module.ts` 的 `HttpPermissionGuard` 管
 * （`@AdminOnly` 已随 RBAC 全部替换而移除）。
 */
@Module({
  providers: [
    // 纯逻辑守卫：HttpAuthGuard 的判定内核，也供测试直接构造
    AuthGuard,
    // 全局守卫：未登录 → 401（角色与权限点不在这一层判）
    { provide: APP_GUARD, useClass: HttpAuthGuard },
  ],
})
export class AuthGuardModule {}
