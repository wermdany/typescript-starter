import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { toSingleLine } from './error-format.js';
import { getTraceId, runWithTraceId } from './trace.js';

/** `res.locals` 上承载失败摘要的键；HttpExceptionFilter 写，本中间件读 */
export const FAILURE_LOCALS_KEY = 'accessLogFailure';

/**
 * 失败摘要：由 `HttpExceptionFilter` 写入 `res.locals`，供 access 行拼接。
 *
 * 只承载**结构化**数据 —— 原因文本 + 出错字段路径。「失败: 」「（字段错误：a, b）」
 * 这类**文案拼装**属于日志层，不放进过滤器，避免业务代码里混进日志措辞。
 */
export interface AccessLogFailure {
  /** 简短原因：4xx 用响应里的 message；5xx 若是未预期异常则为「未捕获异常：…」 */
  summary: string;
  /** 出错字段路径（过滤器给**完整**列表）；裁剪是「为刷屏让步」的呈现决策，属日志层 */
  fields?: string[];
}

// 模块级即可：Logger 的 `get localInstance()` 在**每次调用时**才解析 staticInstanceRef
// （logger.service.js），因此模块加载期创建也能被后续注入的 FileLogger 接管
const logger = new Logger('HTTP');

/** 失败摘要 → access 行后缀（纯函数，便于单测） */
export function formatFailureSuffix(failure: AccessLogFailure): string {
  // summary 必须压平：库异常 / body parser 的 message 可能自带换行，
  // 不压平会把一条 access 日志劈成两行，破坏「一行一事件」
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
 * 访问日志中间件：每个请求**恒定**在响应收尾时写一行 `METHOD url status Nms`。
 *
 * **为什么在中间件而不是拦截器（对齐 morgan / pino-http 的位置）：** 拦截器在路由管线内，
 * 未命中路由的 404、body 解析失败的 400 根本到不了它，那类请求会漏掉 access 行；
 * 挂在中间件层才能覆盖「连接进入到落地」的完整生命周期，耗时也更真实
 * （从中间件入口算到响应结束，含 body 解析 / 守卫 / 校验 / 序列化）。
 *
 * **为什么收尾回调里要再包一层 runWithTraceId：** `traceContextMiddleware` 的
 * `runWithTraceId(traceId, () => next())` 只包住同步链路。实测：正常 / 错误响应下
 * finish、close 仍在该异步上下文内；但**客户端提前断开**时 close 由 socket 触发，
 * 上下文已丢失（`getTraceId()` 为 undefined）。若不在入口捕获并显式恢复，
 * 被中断请求的 access 行会缺 traceId，与「同一次请求多行 traceId 对得上号」的约定相悖。
 * 恢复对正常路径无副作用：`storage.run()` 返回后会自动还原外层 store。
 *
 * 注册位置：必须排在 `traceContextMiddleware` **之后**（入口要 `getTraceId()`），
 * 且两者都要在 `app.listen()` 之前（见 main.ts）。
 */
export function accessLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = performance.now();
  const traceId = getTraceId(); // 入口捕获：close 回调（客户端中断）已不在上下文里
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

    // 中断行的 statusCode 是假的 200（响应从未写入），若按状态码归入 log 级，
    // 它会混在正常请求里被淹没 —— 一律提到 warn
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

  // finish 是正常收尾；close 在客户端中断时替代 finish（正常时排在 finish 之后）。
  // 单次守卫保证「恒定一行」—— 两个事件都触发也只写一次。
  res.on('finish', () => {
    if (done) return;
    done = true;
    write(false);
  });
  res.on('close', () => {
    if (done) return;
    done = true;
    // writableFinished 为 false 说明响应没写完就断了（实测中断时它必为 false）
    write(!res.writableFinished);
  });

  next();
}
