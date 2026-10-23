import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  RESPONSE_MESSAGE_KEY,
  SKIP_TRANSFORM_KEY,
} from '@/common/api-response/response.decorator.js';
import {
  DEFAULT_SUCCESS_MESSAGE,
  type ApiSuccess,
} from '@/common/api-response/api-response.js';

/**
 * 全局响应包装拦截器：把 handler 返回值包装为成功契约 `ApiSuccess<T>`。
 *
 * **最内层拦截器**：它决定 `data` 长什么样（契约的产物），但不决定"是否值得回放"
 * （那是幂等层的判断），也不决定日志（那是 `accessLogMiddleware` 的判断）。
 * 分层结果：`@HttpCode()`、重放、日志都不需要关心包装格式。
 *
 * - `@ApiMessage()` 覆盖成功 message，默认 `DEFAULT_SUCCESS_MESSAGE`（'ok'）
 * - `@SkipTransform()` 跳过包装
 * - `undefined` / `null` 归一为 `data: null`（无返回体的操作，如修改密码）；
 *   不改成 204 —— 判别字段 `success` 在 body 里
 * - 不在此统计耗时或写日志：耗时由 `accessLogMiddleware` 负责
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccess<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccess<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_SUCCESS_MESSAGE;
    return next
      .handle()
      .pipe(
        map(
          (data) =>
            ({ success: true, message, data: data ?? null }) as ApiSuccess<T>,
        ),
      );
  }
}
