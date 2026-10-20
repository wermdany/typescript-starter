import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { HttpExceptionFilter } from '@/shared/http/http-exception.filter.js';
import { TransformInterceptor } from '@/shared/http/transform.interceptor.js';
import { RequestLoggingInterceptor } from '@/logger/request-logging.interceptor.js';
import { AuthGuard, HttpAuthGuard } from '@/shared/auth/auth.guard.js';

/** 全局拦截器（body 日志 + 成功契约）、守卫（登录 / 管理员）与过滤器（失败契约）的注册 */
@Module({
  providers: [
    // 守卫只依赖纯逻辑的 AuthGuard，不注入任何模块能力
    AuthGuard,
    { provide: APP_GUARD, useClass: HttpAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppConfigModule {}
