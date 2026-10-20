import { Module } from '@nestjs/common';

import { LogModule } from '@/modules/auth/log/log.module.js';

import { SessionModule } from '@/modules/auth/session/session.module.js';
import { TokenModule } from '@/modules/auth/token/token.module.js';
import { AccountService } from './account.service.js';
import { LoginService } from './login.service.js';
import { LogoutService } from './logout.service.js';
import { MeService } from './me.service.js';
import { RefreshService } from './refresh.service.js';

/**
 * 登录子域：登录 / 续期 / 登出 / 当前身份用例 + 登录审计限流。
 *
 * 用例依赖会话仓储（建会话、吊销）与令牌签发；登录审计的**写入**经由
 * `LogModule` 的 `LoginLogService`（跨子域 import 其 module 导出）。
 */
@Module({
  imports: [TokenModule, SessionModule, LogModule],
  providers: [
    AccountService,
    LoginService,
    RefreshService,
    LogoutService,
    MeService,
  ],
  exports: [
    AccountService,
    LoginService,
    RefreshService,
    LogoutService,
    MeService,
  ],
})
export class LoginModule {}
