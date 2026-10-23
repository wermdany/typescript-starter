import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import {
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
  runWithTraceId,
  sanitizeInboundTraceId,
  setTraceId,
} from '@/common/context/trace.js';

/**
 * 请求上下文中间件：解析/生成 traceId → 挂到 `req` → 建立异步上下文 → 回写响应头。
 *
 * **P1 中间件，不进 `HttpStagesModule` 的 providers**（由 `http-stages.ts` 的
 * `registerRequestStages()` 用 `app.use()` 即时挂载）：Nest 的 `configure()`
 * 在 `init()` 里执行，晚于 Express 内置 body parser 与路由注册。一旦走 provider，
 * malformed JSON 的 400 与未匹配路由的 404 就会**丢掉 traceId**
 * （实测记录见 `docs/conventions/07-pitfalls.md`，回归断言见
 * `src/__tests__/bootstrap.spec.ts` 的两条用例）。
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
