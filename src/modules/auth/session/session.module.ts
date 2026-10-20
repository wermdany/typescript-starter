import { Module } from '@nestjs/common';

import { TokenModule } from '@/modules/auth/token/token.module.js';
import { SessionController } from './session.controller.js';
import { SessionAuthHandler } from './session-auth.middleware.js';
import { SessionService } from './session.service.js';
import { SessionManagerService } from './session-manager.service.js';

/**
 * 会话子域：`auth_sessions` 单表仓储 + 会话用例/接口 + 认证中间件装配。
 * **找 session 的接口（/auth/sessions*、/users/:id/sessions*）在本子域的
 * `session.controller.ts`**。
 *
 * 只依赖 TokenModule（仓储做 token 摘要）。SessionManagerService 还需要账号查询与登录审计，
 * 但那是登录子域的导出——由聚合层（AuthDependenciesModule）把 LoginModule 与本模块
 * 组装到一起，这里不 import，避免 session ↔ login 循环引用（ESM 下会 TDZ 崩溃）。
 */
@Module({
  imports: [TokenModule],
  controllers: [SessionController],
  providers: [SessionService, SessionManagerService, SessionAuthHandler],
  exports: [SessionService, SessionManagerService, SessionAuthHandler],
})
export class SessionModule {}
