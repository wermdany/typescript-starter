import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthGuard, HttpAuthGuard } from './auth.guard.js';

/**
 * 认证子模块：**登录态 + 管理员判定**的全局守卫注册。
 *
 * - `AuthGuard`：纯逻辑（不碰 HTTP 上下文），可独立单测
 * - `HttpAuthGuard`：翻译 `ExecutionContext` + 读 `@Public()` / `@AdminOnly()` 元数据
 *
 * 身份由 `modules/auth/session` 的认证中间件查会话后写入 `req.user`；
 * 守卫不查库。业务权限点（RBAC）将来接在更上层的守卫里。
 */
@Module({
  providers: [
    // 纯逻辑守卫：HttpAuthGuard 的判定内核，也供测试直接构造
    AuthGuard,
    // 全局守卫：未登录 → 401；@AdminOnly 路由非管理员 → 403
    { provide: APP_GUARD, useClass: HttpAuthGuard },
  ],
})
export class AuthGuardModule {}
