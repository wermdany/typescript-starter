import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import type { Request } from 'express';

import type { Env } from '../config/env.js';
import { formatLogBody, hasMeaningfulBody } from './sanitize.js';

/**
 * 请求体日志（仅 `LOG_BODY=true`）：请求入口输出一行 `METHOD url body: {...}`。
 *
 * **为什么 access 行不在这里：** 拦截器位于 handler 管线内，守卫 / 中间件阶段抛出的异常
 * （未命中路由的 404、body 解析失败的 400）根本到不了它，那类请求会漏掉 access 行。
 * access 行已迁到 `accessLogMiddleware` —— 中间件层覆盖「连接进入到落地」的全生命周期，
 * 与 morgan / pino-http 同位置。
 *
 * **为什么 body 行必须留在这里：** body 只有在 body parser 跑完之后才存在，而
 * `traceContextMiddleware` / `accessLogMiddleware` 都排在 body parser **之前**（见 main.ts），
 * 中间件层读不到 `req.body`。拦截器是能安全读到 body 的位置，且它先于校验执行 ——
 * 即使请求最终 400，body 行依然会记下来，这是「复现一次写操作」的关键。
 *
 * 局限：只有命中路由的请求才有 body 行（未命中路由 / 解析失败无 body 可读）。
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly config: ConfigService<Env, true>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();

    if (
      this.config.get('LOG_BODY', { infer: true }) &&
      hasMeaningfulBody(req.body)
    ) {
      this.logger.log(
        `${req.method} ${req.originalUrl} body: ${formatLogBody(req.body)}`,
      );
    }

    return next.handle();
  }
}
