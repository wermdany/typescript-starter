import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FAILURE_LOCALS_KEY,
  accessLogMiddleware,
  formatFailureSuffix,
  type AccessLogFailure,
} from '@/logger/access-log.middleware.js';
import { FileLogger } from '@/logger/file-logger.js';
import { getLogLevels } from '@/logger/log-levels.js';
import { runWithTraceId } from '@/logger/trace.js';

/** 全部级别都开启，避免断言被级别过滤干扰 */
const ALL = getLogLevels('verbose');

let dir: string;
let file: string;
let fileLogger: FileLogger;

/**
 * 断言直接读 FileLogger 落盘的内容：它本来就**剥掉了 ANSI**，也带 `[traceId=…]` 前缀，
 * 因此既不必给 ConsoleLogger 的着色写清理正则，又能顺带验证「ALS 自动附加 traceId」这条链路
 * （上下文恢复那个用例只能这么测：ConsoleLogger 根本不看 traceId）。
 */
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'access-log-'));
  file = join(dir, 'app.log');
  fileLogger = new FileLogger({ logLevels: ALL, filePath: file });
  Logger.overrideLogger(fileLogger);
  // FileLogger 同时写控制台，这里静音以免污染测试输出
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  fileLogger.close();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** 文件里已落盘的内容；整个用例都没写过日志时返回空串 */
const logged = (): string =>
  existsSync(file) ? readFileSync(file, 'utf8') : '';

function makeReq(method = 'GET', url = '/x'): Request {
  return { method, originalUrl: url } as unknown as Request;
}

function makeRes(statusCode = 200): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  Object.assign(res, { statusCode, locals: {}, writableFinished: true });
  return res;
}

const noop: NextFunction = () => {};

describe('accessLogMiddleware', () => {
  it('正常收尾：写一行 log，含方法 / URL / 状态 / 耗时', () => {
    const res = makeRes(200);

    accessLogMiddleware(makeReq('GET', '/users?page=1'), res, noop);
    res.emit('finish');

    expect(logged()).toContain('LOG [HTTP] GET /users?page=1 200');
    expect(logged()).toMatch(/\d+ms/);
  });

  it('finish 之后再 close：只写一行（单次守卫）', () => {
    const res = makeRes(200);

    accessLogMiddleware(makeReq(), res, noop);
    res.emit('finish');
    res.emit('close');

    expect(logged().split('GET /x 200').length - 1).toBe(1);
  });

  it('客户端中断（只有 close、writableFinished=false）：warn 级 + 连接已中断标记', () => {
    const res = makeRes(200);
    Object.assign(res, { writableFinished: false });

    accessLogMiddleware(makeReq('GET', '/slow'), res, noop);
    res.emit('close');

    // 中断时 statusCode 是假的 200，必须提到 warn 才不会被正常请求淹没
    expect(logged()).toContain('WARN [HTTP] GET /slow 200');
    expect(logged()).toContain('(连接已中断)');
  });

  it('4xx 拼上失败摘要与出错字段', () => {
    const res = makeRes(400);
    res.locals[FAILURE_LOCALS_KEY] = {
      summary: '参数校验失败',
      fields: ['nickname'],
    } satisfies AccessLogFailure;

    accessLogMiddleware(makeReq('POST', '/users'), res, noop);
    res.emit('finish');

    expect(logged()).toContain('WARN [HTTP] POST /users 400');
    expect(logged()).toContain('失败: 参数校验失败（字段错误：nickname）');
  });

  it('5xx 走 error 级', () => {
    const res = makeRes(500);
    res.locals[FAILURE_LOCALS_KEY] = {
      summary: '未捕获异常：Error: boom',
    } satisfies AccessLogFailure;

    accessLogMiddleware(makeReq('GET', '/users/__boom'), res, noop);
    res.emit('finish');

    expect(logged()).toContain('ERROR [HTTP] GET /users/__boom 500');
    expect(logged()).toContain('失败: 未捕获异常：Error: boom');
  });

  it('出错字段超过 3 个时只列 3 个，并带「等 N 项」', () => {
    const res = makeRes(400);
    res.locals[FAILURE_LOCALS_KEY] = {
      summary: '参数校验失败',
      fields: ['a', 'b', 'c', 'd'],
    } satisfies AccessLogFailure;

    accessLogMiddleware(makeReq(), res, noop);
    res.emit('finish');

    expect(logged()).toContain('（字段错误：a, b, c 等 4 项）');
  });

  it('★ 收尾回调里自动恢复 traceId 上下文（模拟 socket 触发的中断）', () => {
    const res = makeRes(200);
    Object.assign(res, { writableFinished: false });

    // 中间件在 run 内挂载（入口能拿到 traceId），但 close 在 run **之外** 触发 ——
    // 这正是客户端中断时 socket 触发回调的真实时序：不显式恢复上下文，这行就会丢 traceId
    runWithTraceId('t-1', () => accessLogMiddleware(makeReq(), res, noop));
    res.emit('close');

    expect(logged()).toContain('[traceId=t-1] GET /x 200');
    expect(logged()).toContain('(连接已中断)');
  });

  it('无失败摘要时只有状态与耗时（降级不丢行）', () => {
    const res = makeRes(404);

    accessLogMiddleware(makeReq('GET', '/nope'), res, noop);
    res.emit('finish');

    expect(logged()).toContain('GET /nope 404');
    expect(logged()).not.toContain('失败:');
  });
});

describe('formatFailureSuffix', () => {
  it('没有出错字段时只拼失败原因', () => {
    expect(formatFailureSuffix({ summary: '用户不存在' })).toBe(
      ' 失败: 用户不存在',
    );
  });

  it('把库异常的多行 summary 压成单行（否则会劈开 access 行）', () => {
    const suffix = formatFailureSuffix({
      summary: 'Failed query: select count(*)\nparams: ',
    });

    // toSingleLine 先压平空白再 trim，故结尾空格被吃掉
    expect(suffix).toBe(' 失败: Failed query: select count(*) params:');
    expect(suffix).not.toContain('\n');
  });

  it('空字段名回退为 (root)', () => {
    expect(formatFailureSuffix({ summary: '参数校验失败', fields: [''] })).toBe(
      ' 失败: 参数校验失败（字段错误：(root)）',
    );
  });
});
