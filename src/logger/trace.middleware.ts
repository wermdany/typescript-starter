import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import {
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
  runWithTraceId,
  sanitizeInboundTraceId,
  setTraceId,
} from './trace.js';

/**
 * 请求上下文中间件：解析/生成 traceId → 挂到 `req` → 建立异步上下文 → 回写响应头。
 *
 * **注册位置有讲究**：必须在 `main.ts` 里用 `app.use()`、且在 `app.listen()` 之前，
 * 而不是走 `NestModule.configure()`。Nest 的 `NestApplication.init()` 会先注册内置
 * body parser（`registerParserMiddleware()`）再注册用户中间件（`registerRouter()`），
 * 而 `app.use()` 是立即挂到 express 上的 —— 只有早注册才能让本中间件排在 body parser
 * 之前，从而「malformed JSON 的 400」「未命中路由的 404」这类请求也拿得到 traceId。
 *
 * 入站 traceId 优先于生成：调用方或网关可带 `x-trace-id` / `x-request-id` 进来，
 * 于是能"先知道 traceId，再去业务代码里设条件断点"。
 */
export function traceContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound =
    sanitizeInboundTraceId(req.headers[TRACE_ID_HEADER]) ??
    sanitizeInboundTraceId(req.headers[REQUEST_ID_HEADER]);
  const traceId = inbound ?? randomUUID();

  setTraceId(req, traceId);
  res.setHeader(TRACE_ID_HEADER, traceId);
  runWithTraceId(traceId, () => next());
}
