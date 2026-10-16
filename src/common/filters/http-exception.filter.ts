import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import type { FieldError } from '../response/api-response.js';

/**
 * 全局异常过滤器：把所有异常统一转换为响应契约的失败格式
 * `{ code: <httpStatus>, message: <简短失败原因>, data: null }`。
 *
 * - 参数校验失败（400，含 ZodValidationPipe 抛出的）：message 固定「参数校验失败」，
 *   `errors` 数组透传字段级详情（`{ path, message }`）
 * - 业务失败（404/409 等）：message 为异常的自描述短原因，无 `errors` 字段
 * - 未知异常：固定 `{ code: 500, message: '服务器内部错误', data: null }`，堆栈仅写服务端日志
 *
 * `@Catch()` 无参全量捕获，因此 Nest 内置的 body 解析失败（400）等也走同一契约。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

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
      // 内部细节（堆栈、SQL 等）只进服务端日志，不泄漏给客户端
      this.logger.error(
        '未捕获异常',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: { code: number; message: string; data: null; errors?: FieldError[] } = {
      code: status,
      message,
      data: null,
    };
    if (errors) {
      payload.errors = errors;
    }
    response.status(status).json(payload);
  }
}
