import { describe, expect, it } from 'vitest';

import { formatError, toSingleLine } from './error-format.js';

/** 模拟 drizzle 的 DrizzleQueryError：message 只有 SQL 与空 params，真实原因在 cause */
function makeDrizzleLikeError(cause: unknown): Error {
  const error = new Error(
    'Failed query: select count(*) from "users" where "users"."deleted_at" is null\nparams: ',
  );
  error.name = 'DrizzleQueryError';
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

/** 模拟 pg 的 DatabaseError（除 message 外还带机器可读字段） */
function makePgError(overrides: Record<string, unknown> = {}): Error {
  const error = new Error('Connection terminated unexpectedly');
  error.name = 'Error';
  Object.assign(error, { code: '57P01', severity: 'FATAL', routine: 'pqReadData' }, overrides);
  return error;
}

describe('formatError / cause 链展开', () => {
  it('展开 cause：drizzle 包装错误也要露出真实原因（本次 500 排查的关键）', () => {
    const text = formatError(makeDrizzleLikeError(makePgError()));

    expect(text).toContain('Failed query: select count(*)');
    expect(text).toContain('caused by: Error: Connection terminated unexpectedly');
    expect(text).toContain('code=57P01');
  });

  it('摘出 pg 的 detail/hint/constraint 字段，比 message 更好检索', () => {
    const text = formatError(
      makeDrizzleLikeError(
        makePgError({
          message: 'duplicate key value violates unique constraint "users_email_alive_idx"',
          code: '23505',
          constraint: 'users_email_alive_idx',
          detail: 'Key (email)=(a@b.c) already exists.',
        }),
      ),
    );

    expect(text).toContain('code=23505');
    expect(text).toContain('constraint=users_email_alive_idx');
    expect(text).toContain('detail=Key (email)=(a@b.c) already exists.');
  });

  it('includeStack 只作用于首层，cause 链保持单行摘要', () => {
    const text = formatError(makeDrizzleLikeError(makePgError()), { includeStack: true });

    expect(text).toContain('DrizzleQueryError');
    expect(text.split('\n').some((line) => line.startsWith('    at '))).toBe(true);
    // cause 那一行不带堆栈
    const causeLine = text.split('\n').find((line) => line.startsWith('caused by:'));
    expect(causeLine).toContain('Connection terminated unexpectedly');
  });

  it('多行 message 压成单行（访问日志「一行一事件」）', () => {
    const text = toSingleLine(
      formatError(makeDrizzleLikeError(makePgError())),
    );

    expect(text).not.toMatch(/[\r\n]/);
    expect(text).toContain('params: caused by:');
  });

  it('循环引用不无限递归', () => {
    const a = new Error('a');
    const b = new Error('b');
    (a as Error & { cause?: unknown }).cause = b;
    (b as Error & { cause?: unknown }).cause = a;

    const text = formatError(a);
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(text.length).toBeLessThan(500);
  });

  it('cause 链超过 5 层时截断并标注', () => {
    let current = new Error('第 6 层');
    for (let i = 5; i >= 1; i -= 1) {
      const outer = new Error(`第 ${i} 层`);
      (outer as Error & { cause?: unknown }).cause = current;
      current = outer;
    }

    const text = formatError(current);
    expect(text).toContain('已截断');
    expect(text).not.toContain('第 6 层');
  });

  it('非 Error 抛出物用 inspect，不会变成 [object Object]', () => {
    expect(formatError({ code: 1, msg: 'oops' })).toBe("{ code: 1, msg: 'oops' }");
    expect(formatError('纯字符串')).toBe("'纯字符串'");
    expect(formatError(undefined)).toBe('undefined');
  });

  it('首层 Error 无堆栈时保持 message 简写（业务异常的既有格式）', () => {
    expect(formatError(new Error('参数校验失败'))).toBe('参数校验失败');
  });

  it('message 为空的 Error 退化到 name，不产出空行', () => {
    const error = new Error('');
    error.name = 'SilentError';
    expect(formatError(error)).toBe('SilentError');
    expect(formatError(new Error('', { cause: new Error('') }))).toContain('(no message)');
  });
});
