import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ConsoleLogger,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAILURE_LOCALS_KEY } from '../../logger/access-log.middleware.js';
import { getLogLevels } from '../../logger/log-levels.js';

import { HttpExceptionFilter } from './http-exception.filter.js';

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

interface FakeRes {
  locals: Record<string, unknown>;
  statusCode: number;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    locals: {},
    statusCode: 200,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function makeHost(
  res: FakeRes,
  req: Partial<Request> = { method: 'POST', originalUrl: '/users' },
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res as unknown as Response,
      getRequest: () => req as Request,
    }),
  } as unknown as ArgumentsHost;
}

const failureOf = (res: FakeRes): { summary: string; fields?: string[] } =>
  res.locals[FAILURE_LOCALS_KEY] as { summary: string; fields?: string[] };

describe('HttpExceptionFilter 的日志分工', () => {
  it('400 校验失败：只写结构化摘要，不写任何日志', () => {
    const res = makeRes();
    const filter = new HttpExceptionFilter();

    filter.catch(
      new BadRequestException({
        message: '参数校验失败',
        errors: [{ path: 'nickname', message: '必填' }],
      }),
      makeHost(res),
    );

    expect(failureOf(res)).toEqual({
      summary: '参数校验失败',
      fields: ['nickname'],
    });
    // 4xx 是调用方问题：access 行（warn）已留痕，这里重复记只会淹没真 bug
    expect(output).not.toContain('参数校验失败');
    expect(res.json).toHaveBeenCalledWith({
      code: 400,
      message: '参数校验失败',
      data: null,
      errors: [{ path: 'nickname', message: '必填' }],
    });
  });

  it('404 业务失败：写摘要但不带字段，也不写日志', () => {
    const res = makeRes();
    const filter = new HttpExceptionFilter();

    filter.catch(new NotFoundException('用户不存在'), makeHost(res));

    expect(failureOf(res)).toEqual({ summary: '用户不存在' });
    expect(output).toBe('');
  });

  it('409 冲突：同样只写摘要', () => {
    const res = makeRes();
    const filter = new HttpExceptionFilter();

    filter.catch(new ConflictException('学号已存在'), makeHost(res));

    expect(failureOf(res).summary).toBe('学号已存在');
    expect(output).toBe('');
  });

  it('500 未预期异常：摘要带真实原因，且堆栈单独写一行 error', () => {
    const res = makeRes();
    const filter = new HttpExceptionFilter();
    const dbError = Object.assign(new Error('Connection terminated'), {
      code: '57P01',
    });
    const wrapped = Object.assign(new Error('Failed query: select 1'), {
      cause: dbError,
    });

    filter.catch(wrapped, makeHost(res, { method: 'GET', originalUrl: '/x' }));

    const failure = failureOf(res);
    expect(failure.summary).toContain('未捕获异常：');
    expect(failure.summary).toContain('code=57P01');
    // 摘要是给 access 行用的，不带堆栈；堆栈归日志行
    expect(failure.summary).not.toContain('at ');
    // 5xx 的日志行必须带堆栈，这是定位真 bug 的唯一出口
    expect(output).toContain('ERROR');
    expect(output).toContain('Failed query: select 1');
    expect(output).toContain('caused by');
    expect(output).toContain('at ');
    // 对外仍不泄漏内部细节
    expect(res.json).toHaveBeenCalledWith({
      code: 500,
      message: '服务器内部错误',
      data: null,
    });
  });

  it('500 HttpException：摘要取 message，仍写 error 日志', () => {
    const res = makeRes();
    const filter = new HttpExceptionFilter();

    filter.catch(
      new InternalServerErrorException('内部故障'),
      makeHost(res, { method: 'GET', originalUrl: '/x' }),
    );

    expect(failureOf(res).summary).toBe('内部故障');
    expect(output).toContain('内部故障');
    expect(res.json).toHaveBeenCalledWith({
      code: 500,
      message: '内部故障',
      data: null,
    });
  });

  it('出错的字段列表不在这里裁剪（完整交给日志层）', () => {
    const res = makeRes();
    const filter = new HttpExceptionFilter();

    filter.catch(
      new BadRequestException({
        message: '参数校验失败',
        errors: [
          { path: 'a', message: 'x' },
          { path: 'b', message: 'x' },
          { path: 'c', message: 'x' },
          { path: 'd', message: 'x' },
        ],
      }),
      makeHost(res),
    );

    expect(failureOf(res).fields).toHaveLength(4);
  });
});
