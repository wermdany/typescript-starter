import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { type FieldError } from '@/common/api-response/api-response.js';
import { toHttpException } from '@/common/api-response/error-mapping.js';
import {
  FAILURE_LOCALS_KEY,
  type AccessLogFailure,
} from '@/common/logging/failure.js';
import { formatError } from '@/common/logging/error-format.js';

/**
 * 全局异常过滤器：把所有异常转换为失败契约
 * `{ success: false, message, data: null, errors? }`，是失败响应的**唯一出口**。
 *
 * 异常先过 `error-mapping.ts` 的映射链（`HttpException` 直通 → PG 23505 → 409），
 * 映射不到才落 500 —— 这样 service 不必为"库错误 → 业务失败"写 catch。
 *
 * - 参数校验失败（400）：`message` 取异常体里的文案，`errors` 为字段级详情
 * - 业务失败（404/409/401 等）：`message` 为异常的自描述短原因，无 `errors`
 * - 未知异常（500）：对外固定「服务器内部错误」，堆栈只进服务端日志
 *
 * `@Catch()` 全量捕获，Nest 内置的 body 解析失败（400）等也走同一契约。
 *
 * 日志分工：**只记 5xx**（带堆栈/cause 链）；4xx 是调用方问题，由 access 行留痕。
 * 两类都把结构化失败摘要写进 `res.locals`，文案由 `accessLogMiddleware` 拼装。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request | undefined>();

    // 映射链是唯一的"异常合法化"入口：命中即为业务失败
    const mapped = toHttpException(exception);
    const httpException =
      mapped ?? (exception instanceof HttpException ? exception : null);

    let status: number;
    let message: string;
    let errors: FieldError[] | undefined;

    if (httpException) {
      status = httpException.getStatus();
      const body = httpException.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const { message: rawMessage, errors: rawErrors } = body as {
          message?: unknown;
          errors?: unknown;
        };
        // 兼容 Nest 内置异常的 message 数组形态（如 ValidationPipe 风格）
        message = Array.isArray(rawMessage)
          ? rawMessage.map(String).join('；')
          : rawMessage !== undefined
            ? String(rawMessage)
            : httpException.message;
        if (Array.isArray(rawErrors)) {
          errors = rawErrors as FieldError[];
        }
      } else {
        message = httpException.message;
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '服务器内部错误';
    }

    if (status >= 400) {
      response.locals[FAILURE_LOCALS_KEY] = this.buildFailure(
        status,
        message,
        errors,
        exception,
        httpException,
      );
    }
    if (status >= 500) {
      this.logServerError(status, message, exception, httpException, request);
    }

    const payload: {
      success: false;
      message: string;
      data: null;
      errors?: FieldError[];
    } = {
      success: false,
      message,
      data: null,
    };
    if (errors) {
      payload.errors = errors;
    }
    response.status(status).json(payload);
  }

  /**
   * 5xx 日志：附堆栈，是定位真 bug 的出口。
   *
   * 整条日志拼成单个字符串再交给 Logger —— ConsoleLogger 会把第二个字符串参数当作
   * context，分成两个参数传会让异常内容错位。
   */
  private logServerError(
    status: number,
    message: string,
    exception: unknown,
    httpException: HttpException | null,
    request: Request | undefined,
  ): void {
    const where = `${request?.method ?? '-'} ${request?.originalUrl ?? '-'}`;
    // 未预期异常日志里要看到真实原因与堆栈，但对外仍只回「服务器内部错误」
    const detail =
      httpException !== null
        ? message
        : `未捕获异常：${formatError(exception, { includeStack: true })}`;
    const stack =
      httpException !== null && httpException.stack
        ? `\n${httpException.stack}`
        : '';
    this.logger.error(`${where} ${status} ${detail}${stack}`);
  }

  /**
   * 结构化失败摘要（交给 access 中间件）。只给「原因 + 完整出错字段列表」，
   * 裁剪与文案拼装属日志层的呈现决策。5xx 不带堆栈 —— 堆栈归 `logServerError`。
   */
  private buildFailure(
    status: number,
    message: string,
    errors: FieldError[] | undefined,
    exception: unknown,
    httpException: HttpException | null,
  ): AccessLogFailure {
    if (status >= 500) {
      return {
        summary:
          httpException !== null
            ? message
            : `未捕获异常：${formatError(exception)}`,
      };
    }
    return {
      summary: message,
      ...(errors?.length ? { fields: errors.map((item) => item.path) } : {}),
    };
  }
}
