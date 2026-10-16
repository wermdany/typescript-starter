import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { RESPONSE_MESSAGE_KEY } from '../decorators/api-message.decorator.js';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator.js';
import type { ApiResponse } from '../response/api-response.js';

/**
 * 全局响应包装拦截器：把 handler 返回值包装为 ApiResponse（契约类型见 api-response.ts）。
 *
 * - `@ApiMessage('...')` 可覆盖成功 message（默认 'ok'）
 * - `@SkipTransform()` 跳过包装（健康检查、文件下载等特殊端点）
 *
 * 注册顺序要求：应在 RequestLoggingInterceptor 之后注册（日志拦截器保持最外层，
 * 以统计 handler + 转换的完整耗时）。
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return next.handle();
    }
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'ok';
    return next.handle().pipe(
      map(
        (data) =>
          ({ code: 0, message, data: data ?? null }) as ApiResponse<T>,
      ),
    );
  }
}
