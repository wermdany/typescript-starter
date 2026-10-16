import { Logger } from '@nestjs/common';

import { formatError } from './error-format.js';

/**
 * 进程级异常兜底。
 *
 * 这两类异常**不会**经过 HTTP 管线：没有它们时 Node 只把堆栈打到原生 stderr，
 * 既不落盘也进不了日志文件，进程还可能"什么都没记"就退出。
 *
 * 记录后主动 `process.exit(1)`：与 Node 默认行为一致（未处理的 Promise 拒绝本来就会崩进程），
 * 区别只是"崩之前先把 fatal 写进日志"。FileLogger 走同步 fd 写，不需要等 flush 落盘。
 *
 * 必须在 logger 接管之后调用（main.ts 里 `NestFactory.create` 之后），
 * 否则 `new Logger()` 会落到默认 console logger 而拿不到 FileLogger。
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
