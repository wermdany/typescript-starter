import { Global, Module } from '@nestjs/common';

import { LogModule } from './log/log.module.js';
import { LoginModule } from './login/login.module.js';
import { SessionModule } from './session/session.module.js';
import { TokenModule } from './token/token.module.js';

/**
 * 认证能力的**跨模块出口**（@Global）。
 *
 * 存在的意义：其它业务模块（用户模块改密/删人后吊销会话、`server.ts` 挂认证中间件）
 * 只需要"会话服务 / 认证中间件"这类基础能力，不该 import 整个 `AuthModule`
 * （那会连带登录用例与 Controller）。
 *
 * 整体转发 SessionModule：它自己 export 的 `SessionService` / `SessionAuthHandler`
 * 经由这里对全局可见；本模块不复制任何 provider 声明，避免两处清单漂移。
 * （TokenModule / LoginModule 只服务认证内部链路，不对外。）
 */
@Global()
@Module({
  imports: [TokenModule, LoginModule, SessionModule, LogModule],
  exports: [SessionModule, LogModule],
})
export class AuthProvidersModule {}
