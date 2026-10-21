import { Module } from '@nestjs/common';

import { AuthGuardModule } from '@/shared/auth/auth.module.js';
import { HttpContractModule } from '@/shared/http/http.module.js';
import { LoggerModule } from '@/logger/logger.module.js';

/**
 * 应用核心装配（**找"全局有哪些守卫/拦截器/过滤器/中间件"来这里对账**）。
 *
 * 之前叫 `AppConfigModule` 且所有全局组件硬编码在 providers 数组里——
 * 能力与注册分离，加一个全局组件要改两处。现在每个功能域自带 Module
 * 自注册（APP_* 写在组件自己目录里），本模块退化为**一张目录清单**：
 *
 * | 能力 | 注册处 |
 * | --- | --- |
 * | 登录态/管理员守卫 | `shared/auth/auth.module.ts`（APP_GUARD） |
 * | 成功/失败响应契约 | `shared/http/http.module.ts`（APP_FILTER + APP_INTERCEPTOR） |
 * | body 日志拦截器 | `logger/logger.module.ts`（APP_INTERCEPTOR） |
 * | 请求中间件（trace/access/cookie/认证） | `server.ts` 的 `createApp()`（顺序敏感，见其注释） |
 */
@Module({
  imports: [AuthGuardModule, HttpContractModule, LoggerModule],
})
export class AppCoreModule {}
