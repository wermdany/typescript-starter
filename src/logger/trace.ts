import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

/** 入站 traceId 透传用的请求头（按优先级排列） */
export const TRACE_ID_HEADER = 'x-trace-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 入站 traceId 的字符白名单：仅字母/数字/`.`/`_`/`-`，长度 1..128。
 *
 * 必须校验 —— traceId 会被原样写进日志行与响应头，不做限制等于开放日志注入
 * （CRLF 伪造日志行、控制字符、超长撑爆文件）。非法值一律丢弃，回退为新生成的 UUID。
 */
const TRACE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** 请求级异步上下文；目前只承载 traceId，后续要加 userId 之类在此扩展 */
interface RequestContext {
  traceId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** 挂在请求对象上的 traceId（由 traceContextMiddleware 写入，便于断点调试时直接查看 req.traceId） */
export type TracedRequest = Request & { traceId?: string };

/** 写入 `req.traceId` 并返回同一个值（便于链式书写） */
export function setTraceId(req: Request, traceId: string): string {
  (req as TracedRequest).traceId = traceId;
  return traceId;
}

/** 在指定 traceId 的异步上下文中运行 `fn`；期间同步/异步续体里 `getTraceId()` 都能取到 */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId }, fn);
}

/**
 * 读取当前异步上下文的 traceId；拿不到时返回 `undefined`。
 *
 * 拿不到的场景：启动阶段、进程级异常（uncaughtException / unhandledRejection），
 * 以及 traceContextMiddleware 挂载之前 —— 这些日志不会带 traceId 后缀
 * （注意不再是占位符 `-`，见 AGENTS.md 日志章节）。
 */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/**
 * 清洗入站 traceId：合法返回原值，非法返回 `undefined`（由调用方回退为生成 UUID）。
 *
 * 同名请求头可能重复出现，此时 express 给的是数组，取第一个。
 */
export function sanitizeInboundTraceId(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return TRACE_ID_RE.test(trimmed) ? trimmed : undefined;
}
