import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';

/**
 * 全局 HTTP 请求日志：每条请求输出 方法/路径/状态码/耗时 + traceId
 * 成功请求 log 级别，失败请求 warn 级别；traceId 同时回写到 x-trace-id 响应头
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const traceId = randomUUID();
    const start = performance.now();
    res.setHeader('x-trace-id', traceId);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Math.round(performance.now() - start);
          this.logger.log(
            `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms [traceId=${traceId}]`,
          );
        },
        error: (err: unknown) => {
          const ms = Math.round(performance.now() - start);
          const status = (err as { status?: number })?.status ?? 500;
          this.logger.warn(
            `${req.method} ${req.originalUrl} ${status} ${ms}ms [traceId=${traceId}] (failed)`,
          );
        },
      }),
    );
  }
}
