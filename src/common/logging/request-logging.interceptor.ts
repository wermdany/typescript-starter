import {
  CallHandler,
  Inject,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import { Observable } from 'rxjs';
import type { Request } from 'express';

import { formatLogBody, hasMeaningfulBody } from '@/common/logging/sanitize.js';

/**
 * 请求体日志（仅 `LOG_BODY=true`）：输出一行 `METHOD url body: {...}`，默认 `log` 级别。
 *
 * body 只有 body parser 跑完之后才存在，而两个中间件都排在 body parser 之前，
 * 拦截器是能安全读到 body 的位置；它先于校验执行，即使请求最终 400 也会留下 body 行。
 *
 * **最外层拦截器**（`HTTP_STAGE_PROVIDERS` 数组第 2 项）：body 行必须在所有短路之前
 * 落盘 —— 否则幂等重放、`@SkipTransform()` 之类的短路会让"重放请求没有 body 行"，
 * 恰恰是排查重放问题最需要的那行。
 *
 * 访问行不在这里 —— 由 `accessLogMiddleware` 统一负责。
 * 局限：只有命中路由的请求才有 body 行。
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(@Inject(ENV) private readonly env: Env) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();

    if (this.env.LOG_BODY && hasMeaningfulBody(req.body)) {
      this.logger.log(
        `${req.method} ${req.originalUrl} body: ${formatLogBody(req.body)}`,
      );
    }

    return next.handle();
  }
}
