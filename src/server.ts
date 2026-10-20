import { type INestApplication, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module.js';
import { accessLogMiddleware } from '@/logger/access-log.middleware.js';
import { registerProcessErrorHandlers } from '@/logger/process-error.js';
import { traceContextMiddleware } from '@/logger/trace.middleware.js';
import { SessionAuthHandler } from '@/modules/auth/session/session-auth.middleware.js';

/**
 * 创建并初始化应用（不监听端口，便于测试直接调用）。
 *
 * logger 由调用方注入 `NestFactory.create`：create 阶段的日志也要经由它输出。
 */
export async function createApp(
  logger?: LoggerService,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger });

  // 顺序不可换，且都必须早于 listen()：trace 先建请求上下文并排在 body parser 之前，
  // access 紧随其后（入口捕获 traceId），认证最后（解析 token → req.user）
  app.use(traceContextMiddleware);
  app.use(accessLogMiddleware);
  // 认证中间件要读 RT Cookie；在守卫/控制器之前挂载即可
  app.use(cookieParser());
  const sessionAuth = app.get(SessionAuthHandler);
  app.use(sessionAuth.use.bind(sessionAuth));

  // 进程级兜底要在 logger 接管之后注册，否则落到默认 logger
  registerProcessErrorHandlers();
  app.enableShutdownHooks();

  return app;
}
