import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

/**
 * 请求上下文（traceId）—— **最底层的横切能力**。
 *
 * 分层约束（比其它 `common/*` 更严）：本目录**不得 import `@nestjs/common` 的运行时**，
 * 只用 `node:async_hooks` / `node:crypto` 与 express 类型。原因：`logger/file-logger.ts`
 * 要单向引用它（每条日志前置 `[traceId=...]`），而 FileLogger 必须在 DI 容器就绪之前
 * 构造出来（`NestFactory.create({ logger })`）。一旦这里依赖 Nest，启动阶段就会形成
 * "logger 需要 Nest 容器、容器需要 logger" 的死锁。
 */

/** 入站 traceId 透传用的请求头（按优先级排列） */
export const TRACE_ID_HEADER = 'x-trace-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 入站 traceId 的字符白名单：字母/数字/`.`/`_`/`-`，长度 1..128。
 *
 * traceId 会原样写进日志行与响应头，不校验等于开放日志注入
 * （CRLF 伪造日志行、控制字符、超长撑爆文件）。
 */
const TRACE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** 请求级异步上下文 */
interface RequestContext {
  traceId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** 挂在请求对象上的 traceId，便于断点调试时直接查看 */
export type TracedRequest = Request & { traceId?: string };

/** 写入 `req.traceId` 并返回同一个值 */
export function setTraceId(req: Request, traceId: string): string {
  (req as TracedRequest).traceId = traceId;
  return traceId;
}

/** 在指定 traceId 的异步上下文中运行 `fn` */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId }, fn);
}

/** 读取当前异步上下文的 traceId；启动阶段、进程级异常等场景返回 `undefined` */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/**
 * 清洗入站 traceId：合法返回原值，非法返回 `undefined`（由调用方回退为生成 UUID）。
 *
 * 同名请求头重复出现时 express 给的是数组，取第一个。
 */
export function sanitizeInboundTraceId(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return TRACE_ID_RE.test(trimmed) ? trimmed : undefined;
}
