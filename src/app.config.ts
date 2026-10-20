import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { HttpExceptionFilter } from '@/shared/http/http-exception.filter.js';
import { TransformInterceptor } from '@/shared/http/transform.interceptor.js';
import { RequestLoggingInterceptor } from '@/logger/request-logging.interceptor.js';

/** 全局拦截器（body 日志 + 成功契约）与过滤器（失败契约）的注册 */
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppConfigModule {}
