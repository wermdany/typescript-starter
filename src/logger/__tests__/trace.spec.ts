import { describe, expect, it } from 'vitest';

import {
  getTraceId,
  runWithTraceId,
  sanitizeInboundTraceId,
} from '@/logger/trace.js';

describe('sanitizeInboundTraceId', () => {
  it('接受白名单字符集（字母/数字/._-）', () => {
    expect(sanitizeInboundTraceId('abc-123_X.Y')).toBe('abc-123_X.Y');
  });

  it('去除首尾空白后仍合法则接受', () => {
    expect(sanitizeInboundTraceId('  abc123  ')).toBe('abc123');
  });

  it('拒绝空值 / 空格 / 控制字符 / CRLF / 中文 / 超长', () => {
    expect(sanitizeInboundTraceId('')).toBeUndefined();
    expect(sanitizeInboundTraceId('   ')).toBeUndefined();
    expect(sanitizeInboundTraceId('has space')).toBeUndefined();
    expect(sanitizeInboundTraceId('bad\r\ninject')).toBeUndefined();
    expect(sanitizeInboundTraceId('中文')).toBeUndefined();
    expect(sanitizeInboundTraceId('a'.repeat(129))).toBeUndefined();
  });

  it('长度恰好 128 视为合法', () => {
    const edge = 'a'.repeat(128);
    expect(sanitizeInboundTraceId(edge)).toBe(edge);
  });

  it('非字符串与数组（同名头重复）的处理', () => {
    expect(sanitizeInboundTraceId(undefined)).toBeUndefined();
    expect(sanitizeInboundTraceId(123)).toBeUndefined();
    expect(sanitizeInboundTraceId(['first', 'second'])).toBe('first');
    expect(sanitizeInboundTraceId([])).toBeUndefined();
    expect(sanitizeInboundTraceId(['bad value'])).toBeUndefined();
  });
});

describe('traceId 异步上下文', () => {
  it('未进入上下文时取不到', () => {
    expect(getTraceId()).toBeUndefined();
  });

  it('runWithTraceId 内可取到，返回值原样透传，出作用域即失效', () => {
    const result = runWithTraceId('t-1', () => getTraceId());

    expect(result).toBe('t-1');
    expect(getTraceId()).toBeUndefined();
  });

  it('await 之后仍可取到（异步续体保留上下文）', async () => {
    const seen = await runWithTraceId('t-2', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getTraceId();
    });

    expect(seen).toBe('t-2');
  });

  it('嵌套时内层覆盖外层，退出内层后恢复', () => {
    runWithTraceId('outer', () => {
      expect(getTraceId()).toBe('outer');

      runWithTraceId('inner', () => {
        expect(getTraceId()).toBe('inner');
      });

      expect(getTraceId()).toBe('outer');
    });
  });
});
