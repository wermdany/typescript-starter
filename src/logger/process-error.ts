import { Logger } from '@nestjs/common';

import { formatError } from './error-format.js';

/**
 * 进程级异常兜底。
 *
 * 这两类异常不经过 HTTP 管线，没有兜底时 Node 只把堆栈打到原生 stderr，
 * 既不落盘也进不了日志文件。
 *
 * 记录后主动 `process.exit(1)`，与 Node 默认行为一致，区别只是先写进日志。
 * 必须在 logger 接管之后调用（`NestFactory.create` 之后），否则落到默认 logger。
 */
export function registerProcessErrorHandlers(): void {
  const logger = new Logger('Process');

  process.on('uncaughtException', (err) => {
    logger.fatal(
      `未捕获异常（uncaughtException）：${formatError(err, { includeStack: true })}`,
    );
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal(
      `未处理的 Promise 拒绝（unhandledRejection）：${formatError(reason, { includeStack: true })}`,
    );
    process.exit(1);
  });
}
