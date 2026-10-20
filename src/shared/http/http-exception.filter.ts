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
import {
  FAILURE_LOCALS_KEY,
  type AccessLogFailure,
} from '@/logger/failure-summary.js';
import { formatError } from '@/logger/error-format.js';

/**
 * 全局异常过滤器：把所有异常转换为失败契约
 * `{ success: false, message, data: null, errors? }`，是失败响应的唯一出口。
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

    let status: number;
    let message: string;
    let errors: FieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
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
            : exception.message;
        if (Array.isArray(rawErrors)) {
          errors = rawErrors as FieldError[];
        }
      } else {
        message = exception.message;
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
      );
    }
    if (status >= 500) {
      this.logServerError(status, message, exception, request);
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
    request: Request | undefined,
  ): void {
    const where = `${request?.method ?? '-'} ${request?.originalUrl ?? '-'}`;
    // 未预期异常日志里要看到真实原因与堆栈，但对外仍只回「服务器内部错误」
    const detail =
      exception instanceof HttpException
        ? message
        : `未捕获异常：${formatError(exception, { includeStack: true })}`;
    const stack =
      exception instanceof HttpException && exception.stack
        ? `\n${exception.stack}`
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
  ): AccessLogFailure {
    if (status >= 500) {
      return {
        summary:
          exception instanceof HttpException
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
