import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { toSingleLine } from '@/common/logging/error-format.js';
import {
  FAILURE_LOCALS_KEY,
  type AccessLogFailure,
} from '@/common/logging/failure.js';
import { getTraceId, runWithTraceId } from '@/common/context/trace.js';

export { FAILURE_LOCALS_KEY, type AccessLogFailure };

// 模块级即可：Logger 在每次调用时才解析当前注册的 logger 实例，能被 FileLogger 接管
const logger = new Logger('HTTP');

/** 失败摘要 → access 行后缀（纯函数，便于单测） */
export function formatFailureSuffix(failure: AccessLogFailure): string {
  // summary 必须压平：库异常的 message 可能自带换行，不压平会把一行日志劈成两行
  const summary = toSingleLine(failure.summary);
  if (!failure.fields?.length) return ` 失败: ${summary}`;

  const shown = failure.fields
    .slice(0, 3)
    .map((path) => path || '(root)')
    .join(', ');
  const more =
    failure.fields.length > 3 ? ` 等 ${failure.fields.length} 项` : '';
  return ` 失败: ${summary}（字段错误：${shown}${more}）`;
}

/**
 * 访问日志中间件：每个请求**恰好一行** `METHOD url status Nms`，在响应收尾时写出。
 *
 * - 挂在中间件层而非拦截器：未命中路由的 404、body 解析失败的 400 到不了拦截器，
 *   只有中间件能覆盖完整生命周期，耗时也更真实（含 body 解析 / 守卫 / 校验 / 序列化）
 * - `finish` + `close` 双监听 + 单次守卫保证不重复；`close` 时 `writableFinished`
 *   为 false 判为客户端中断，追加 `(连接已中断)` 并提到 warn 级
 * - 级别：≥500 error / ≥400 warn / 其余 log
 * - 入口捕获 traceId，写日志时用 `runWithTraceId` 恢复上下文：客户端中断时
 *   `close` 由 socket 触发，异步上下文可能已丢失
 *
 * **P1 中间件**：必须注册在 `traceContextMiddleware` 之后，且两者都早于 `listen()`
 * （由 `http-stages.ts` 的 `registerRequestStages()` 负责，顺序写死在函数体里）。
 * 不进 `HttpStagesModule` 的 providers 的原因见 `http-stages.ts` 头注释。
 */
export function accessLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = performance.now();
  const traceId = getTraceId();
  let done = false;

  const write = (aborted: boolean): void => {
    const ms = Math.round(performance.now() - start);
    const status = res.statusCode;
    const failure: AccessLogFailure | undefined =
      res.locals[FAILURE_LOCALS_KEY];
    const suffix = aborted
      ? ' (连接已中断)'
      : failure
        ? formatFailureSuffix(failure)
        : '';
    const line = `${req.method} ${req.originalUrl} ${status} ${ms}ms${suffix}`;

    // 中断行的 statusCode 是假的 200（响应从未写入），按状态码归档会被正常请求淹没
    const level = aborted
      ? 'warn'
      : status >= 500
        ? 'error'
        : status >= 400
          ? 'warn'
          : 'log';
    const emit = (): void => void logger[level](line);
    if (traceId) runWithTraceId(traceId, emit);
    else emit();
  };

  res.on('finish', () => {
    if (done) return;
    done = true;
    write(false);
  });
  res.on('close', () => {
    if (done) return;
    done = true;
    write(!res.writableFinished);
  });

  next();
}
