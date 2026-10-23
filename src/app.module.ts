import { Module } from '@nestjs/common';

import { ConfigProviderModule } from './config/config.module.js';
import { DatabaseModule } from '@/database/database.module.js';
import { HttpStagesModule } from '@/common/http-stages.module.js';
import { AuthModule } from '@/modules/auth/auth.module.js';
import { RbacModule } from '@/modules/rbac/rbac.module.js';
import { UserModule } from '@/modules/user/user.module.js';

/**
 * 根模块（**应用的组装清单**）。
 *
 * 全局守卫 / 拦截器 / 过滤器全部由 {@link HttpStagesModule} 一处注册
 * （清单见 `common/http-stages.ts`），P1 请求中间件由 `server.ts` 的
 * `registerRequestStages()` 挂载。
 *
 * 于是"加一个系统级横切能力"的动作变成两步：
 * 1. 在 `src/common/<功能>/` 写组件
 * 2. 在 `common/http-stages.ts` 的数组里加一行（顺序即执行顺序）
 */
@Module({
  imports: [
    // 配置统一注入：ENV（底层配置，.env 注入）与 APP_CONFIG（业务配置，app-config.ts）都从这里来
    ConfigProviderModule,
    // 全局阶段注册：守卫 / 拦截器 / 过滤器（唯一注册处）
    HttpStagesModule,
    // 权限码解析（@Global）：AccessGuard 通过 PERMISSION_CHECKER 端口注入
    RbacModule,
    DatabaseModule,
    AuthModule,
    UserModule,
  ],
})
export class AppModule {}
