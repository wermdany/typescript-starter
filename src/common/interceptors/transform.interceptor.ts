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
import {
  DEFAULT_SUCCESS_MESSAGE,
  type ApiSuccess,
} from '../response/api-response.js';

/**
 * 全局响应包装拦截器：把 handler 返回值包装为成功契约 `ApiSuccess<T>`
 * （契约类型与不变量见 api-response.ts）。
 *
 * - `@ApiMessage('...')` 覆盖成功 message（默认 `DEFAULT_SUCCESS_MESSAGE` = 'ok'）
 * - `@SkipTransform()` 跳过包装（健康检查、文件下载等特殊端点 —— 它们的响应体
 *   不该是契约 JSON，前端也不能按 `success` 判别，属**明确的例外**）
 * - `data` 归一：handler 返回 `undefined`/`null` 时补 `null`（无返回体的操作，
 *   如重置密码）。**不要改成 204** —— 判据 `success` 在 body 里，204 无 body
 *
 * 注册顺序要求：应在 RequestLoggingInterceptor 之后注册（日志拦截器保持最外层，
 * 以统计 handler + 转换的完整耗时）。
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccess<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccess<T> | T> {
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
      ]) ?? DEFAULT_SUCCESS_MESSAGE;
    return next.handle().pipe(
      map(
        (data) =>
          ({ success: true, message, data: data ?? null }) as ApiSuccess<T>,
      ),
    );
  }
}
