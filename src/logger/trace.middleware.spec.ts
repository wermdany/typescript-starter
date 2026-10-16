import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { getTraceId } from './trace.js';
import { traceContextMiddleware } from './trace.middleware.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeReqRes(headers: Record<string, unknown> = {}) {
  const setHeader = vi.fn();
  const req = { headers } as unknown as Request;
  const res = { setHeader } as unknown as Response;
  return { req, res, setHeader };
}

/** 运行中间件并在 next() 内部抓取当前上下文的 traceId */
function run(headers: Record<string, unknown> = {}) {
  const { req, res, setHeader } = makeReqRes(headers);
  let seenInNext: string | undefined;
  let called = 0;
  const next = (() => {
    called += 1;
    seenInNext = getTraceId();
  }) as unknown as NextFunction;

  traceContextMiddleware(req, res, next);

  return { req, res, setHeader, seenInNext, called };
}

describe('traceContextMiddleware', () => {
  it('无入站 header 时生成 UUID，写入 req、响应头与上下文', () => {
    const { req, setHeader, seenInNext, called } = run();

    expect(called).toBe(1);
    expect(seenInNext).toMatch(UUID_RE);
    expect(setHeader).toHaveBeenCalledWith('x-trace-id', seenInNext);
    expect((req as unknown as { traceId?: string }).traceId).toBe(seenInNext);
  });

  it('合法入站 x-trace-id 被透传', () => {
    const { setHeader, seenInNext } = run({ 'x-trace-id': 'abc-123' });

    expect(seenInNext).toBe('abc-123');
    expect(setHeader).toHaveBeenCalledWith('x-trace-id', 'abc-123');
  });

  it('没有 x-trace-id 时回退到 x-request-id', () => {
    const { seenInNext } = run({ 'x-request-id': 'req-9' });

    expect(seenInNext).toBe('req-9');
  });

  it('两者都存在时以 x-trace-id 优先', () => {
    const { seenInNext } = run({ 'x-trace-id': 'primary', 'x-request-id': 'secondary' });

    expect(seenInNext).toBe('primary');
  });

  it('非法入站 traceId 被忽略并重新生成', () => {
    const { setHeader, seenInNext } = run({ 'x-trace-id': 'bad value\r\ninject' });

    expect(seenInNext).toMatch(UUID_RE);
    expect(seenInNext).not.toContain('bad value');
    expect(setHeader).toHaveBeenCalledWith('x-trace-id', seenInNext);
  });
});
