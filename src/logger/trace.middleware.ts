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
 * 必须在 `main.ts` 里 `app.use()`，且早于 `listen()`：Nest 在 `init()` 里先注册
 * body parser 再注册路由，而 `app.use()` 是即时挂载，只有早注册才能排在 body parser
 * 之前，让 malformed JSON 的 400、未命中路由的 404 也拿得到 traceId。
 *
 * 入站 traceId 优先：`x-trace-id` → `x-request-id` → 都没有才生成 UUID。
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
