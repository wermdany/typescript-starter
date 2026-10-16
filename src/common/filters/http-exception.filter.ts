import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  FAILURE_LOCALS_KEY,
  type AccessLogFailure,
} from '../../logger/access-log.middleware.js';
import { formatError } from '../../logger/error-format.js';
import type { FieldError } from '../response/api-response.js';

/**
 * 全局异常过滤器：把所有异常统一转换为响应契约的失败格式
 * `{ success: false, message: <短原因>, data: null }`（契约见 api-response.ts）。
 *
 * **不变量：`success` 必须与 HTTP 状态码一致**（4xx/5xx 一律 `false`），
 * 绝不允许出现 2xx + `success: false`。
 *
 * - 参数校验失败（400，含 ZodValidationPipe 抛出的）：message 取异常体里的文案
 *   （默认 `DEFAULT_VALIDATION_MESSAGE` =「参数校验失败」，可按参数覆盖），
 *   `errors` 数组透传字段级详情（`{ path, message }`）
 * - 业务失败（404/409 等）：message 为异常的自描述短原因，无 `errors` 字段
 * - 未知异常：固定 `{ success: false, message: '服务器内部错误', data: null }`，
 *   堆栈仅写服务端日志
 *
 * `@Catch()` 无参全量捕获，因此 Nest 内置的 body 解析失败（400，`adapter.mapException`
 * 会把 body-parser 的 SyntaxError 映射成 BadRequestException）等也走同一契约。
 *
 * **日志侧只负责 5xx**（带堆栈）—— 那是「定位真 bug」的唯一出口。
 * 4xx 不再在这里记日志：它是调用方问题，access 行已留痕，重复记只会淹没真 bug。
 * 但**两类都要**把失败的**结构化**摘要写进 `res.locals`，供 `accessLogMiddleware`
 * 在 access 行里拼出原因与出错字段；文案拼装在日志层，这里只给事实。
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

    // 结构化摘要交给 access 中间件 —— 4xx 也要写：access 行需要「参数校验失败（字段错误：nickname）」
    if (status >= 400) {
      response.locals[FAILURE_LOCALS_KEY] = this.buildFailure(
        status,
        message,
        errors,
        exception,
      );
    }
    // 只记 5xx：4xx 是调用方问题，access 行（warn）已留痕，重复记会淹没真 bug
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
   * 5xx 才落日志：附堆栈，是「定位真 bug」的唯一出口。
   *
   * 整条日志**拼成单个字符串**再交给 Logger —— ConsoleLogger 会把第二个字符串参数
   * 解析成 context，分成两个参数传会让异常内容错位（历史 bug）。
   */
  private logServerError(
    status: number,
    message: string,
    exception: unknown,
    request: Request | undefined,
  ): void {
    const where = `${request?.method ?? '-'} ${request?.originalUrl ?? '-'}`;
    // 非 HttpException（未预期异常）：日志里必须看到真实原因与堆栈，
    // 但对外仍只回「服务器内部错误」，内部细节不泄漏给客户端
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
   * 结构化失败摘要（本身不进日志，交给 access 中间件）。
   *
   * 只给「原因 + 出错字段路径」这份事实：「最多列 3 个字段、超出加等 N 项」这类
   * 裁剪与拼接属日志层的呈现决策，因此 `fields` 这里给**完整**列表。
   * 5xx 不带堆栈 —— 堆栈归 `logServerError` 那一行。
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
