import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

/**
 * 日志子模块：**body 日志拦截器**的全局注册。
 *
 * `trace` / `access` 两个中间件**不在这里注册**——它们必须用 `app.use()` 即时挂载
 * （早于 Express 内置 body parser，malformed JSON 400 才有 traceId），由
 * `server.ts` 的 `createApp()` 负责且顺序敏感。本模块只管能走 Nest provider
 * 机制的组件。
 */
@Module({
  providers: [
    // LOG_BODY 开启时把请求体写进日志（脱敏 + 截断）；独立成行，不并入 access 行
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class LoggerModule {}
