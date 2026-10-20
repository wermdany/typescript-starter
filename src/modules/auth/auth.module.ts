import { Module } from '@nestjs/common';

import { AuthProvidersModule } from './auth.providers.module.js';
import { AuthController } from './auth.controller.js';
import { LoginModule } from './login/login.module.js';
import { LogModule } from './log/log.module.js';
import { SessionModule } from './session/session.module.js';

/**
 * 登录授权模块（聚合入口）。
 *
 * 按**变更原因**拆成四个子域，各自封装成 Module：
 * - `token/` —— 令牌签发与时效（纯计算）
 * - `session/` —— 会话仓储/用例/接口 与 认证中间件（找 session 相关代码来这里）
 * - `login/` —— 登录 / 续期 / 登出 / 当前身份（找登录相关代码来这里）
 * - `log/` —— 登录审计流水（找 login-logs 相关代码来这里）
 *
 * Controller 按子域拆分：`auth.controller`（登录）、`session/session.controller`（会话）、
 * `log/login-log.controller`（审计）—— 找接口先找子域目录下的 controller。
 */
@Module({
  imports: [AuthProvidersModule, LoginModule, SessionModule, LogModule],
  controllers: [AuthController],
})
export class AuthModule {}
