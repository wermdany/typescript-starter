import { type INestApplication, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { registerRequestStages } from '@/common/http-stages.js';
import { setupOpenApi } from '@/common/openapi/setup.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import { registerProcessErrorHandlers } from '@/logger/process-error.js';
import { SessionAuthenticator } from '@/modules/auth/session/session-auth.middleware.js';

/**
 * 创建并初始化应用（不监听端口，便于测试直接调用）。
 *
 * **全局守卫 / 拦截器 / 过滤器**在 `common/http-stages.ts`（`HttpStagesModule`）；
 * **请求中间件**只能在这里经 `registerRequestStages()` 即时挂载 —— 它们必须排在
 * Express 内置 body parser 之前，否则 malformed JSON 的 400 与未匹配路由的 404
 * 会丢 traceId（见 `http-stages.ts` 头注释）。
 *
 * **接口文档**在中间件之后挂载：文档请求同样要走 trace / access 日志；
 * 是否真的挂载由 `SWAGGER_ENABLED` 与 `NODE_ENV` 决定（见 `common/openapi/setup.ts`），
 * 测试环境默认关闭，因此 `bootstrap.spec.ts` 的路由数量断言不受影响。
 *
 * logger 由调用方注入 `NestFactory.create`：create 阶段的日志也要经由它输出。
 */
export async function createApp(
  logger?: LoggerService,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger });

  // 认证中间件从容器取出后交进去：`common/` 因此不必依赖 `modules/auth`
  const authenticator = app.get(SessionAuthenticator);
  registerRequestStages(app, {
    authenticate: (req, res, next) => void authenticator.use(req, res, next),
  });

  setupOpenApi(app, app.get<Env>(ENV));

  // 进程级兜底要在 logger 接管之后注册，否则落到默认 logger
  registerProcessErrorHandlers();
  app.enableShutdownHooks();

  return app;
}
