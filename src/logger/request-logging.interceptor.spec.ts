import {
  ConsoleLogger,
  type CallHandler,
  type ExecutionContext,
  Logger,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';

import { getLogLevels } from './log-levels.js';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

/** 让 ConsoleLogger 的输出落到字符串里，便于断言（error/fatal 走 stderr，其余走 stdout） */
let output: string;

beforeEach(() => {
  output = '';
  const capture = (chunk: unknown): boolean => {
    output += String(chunk);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  Logger.overrideLogger(
    new ConsoleLogger({ logLevels: getLogLevels('verbose') }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeConfig(logBody: boolean): ConfigService<Env, true> {
  return { get: () => logBody } as unknown as ConfigService<Env, true>;
}

function makeContext(req: Partial<Request>, statusCode = 200): ExecutionContext {
  const res = { statusCode } as Response;
  const http = { getRequest: () => req, getResponse: () => res };
  return {
    getType: () => 'http',
    switchToHttp: () => http,
  } as unknown as ExecutionContext;
}

const SECRET = 'secret-value-xyz';

const baseReq: Partial<Request> = {
  method: 'POST',
  originalUrl: '/users',
  body: {},
};

/**
 * access 行已迁到 `accessLogMiddleware`（中间件层），本拦截器只剩 body 行 ——
 * 因此这里只断言 body 相关行为，接入/耗时/状态码均不再由它输出。
 */
describe('RequestLoggingInterceptor / LOG_BODY', () => {
  it('关闭时不输出任何日志（既无 body 行，也无 access 行）', async () => {
    const interceptor = new RequestLoggingInterceptor(makeConfig(false));
    const req = {
      ...baseReq,
      body: { nickname: '探针', password: SECRET },
    } as Request;

    await firstValueFrom(
      interceptor.intercept(makeContext(req, 201), {
        handle: () => of({}),
      } as CallHandler),
    );

    expect(output).not.toContain('body:');
    expect(output).not.toContain('201');
    expect(output).not.toContain('traceId=');
  });

  it('开启且 body 非空时输出一行，敏感字段被打码', async () => {
    const interceptor = new RequestLoggingInterceptor(makeConfig(true));
    const req = {
      ...baseReq,
      body: { nickname: '探针', password: SECRET },
    } as Request;

    await firstValueFrom(
      interceptor.intercept(makeContext(req, 201), {
        handle: () => of({}),
      } as CallHandler),
    );

    expect(output).toContain('POST /users body:');
    expect(output).toContain('nickname');
    expect(output).toContain('***');
    expect(output).not.toContain(SECRET);
  });

  it('开启但 body 为空时不输出 body 行', async () => {
    const interceptor = new RequestLoggingInterceptor(makeConfig(true));
    const req = { ...baseReq, body: {} } as Request;

    await firstValueFrom(
      interceptor.intercept(makeContext(req, 201), {
        handle: () => of({}),
      } as CallHandler),
    );

    expect(output).not.toContain('body:');
  });
});
