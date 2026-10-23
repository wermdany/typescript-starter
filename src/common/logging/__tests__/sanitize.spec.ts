import { describe, expect, it } from 'vitest';

import {
  formatLogBody,
  hasMeaningfulBody,
  sanitizeBody,
} from '@/common/logging/sanitize.js';

describe('hasMeaningfulBody', () => {
  it('空值 / 空容器视为没有内容', () => {
    expect(hasMeaningfulBody(undefined)).toBe(false);
    expect(hasMeaningfulBody(null)).toBe(false);
    expect(hasMeaningfulBody('')).toBe(false);
    expect(hasMeaningfulBody('   ')).toBe(false);
    expect(hasMeaningfulBody({})).toBe(false);
    expect(hasMeaningfulBody([])).toBe(false);
  });

  it('有内容为真（含 0 / false 这类"假值"）', () => {
    expect(hasMeaningfulBody({ a: 1 })).toBe(true);
    expect(hasMeaningfulBody([1])).toBe(true);
    expect(hasMeaningfulBody('x')).toBe(true);
    expect(hasMeaningfulBody(0)).toBe(true);
    expect(hasMeaningfulBody(false)).toBe(true);
  });
});

describe('sanitizeBody', () => {
  it('敏感字段整值替换为 ***', () => {
    const out = sanitizeBody({
      studentNo: '2026001',
      password: 'super-secret',
      accessToken: 'tok',
      authorization: 'Bearer x',
      nested: { api_key: 'k', cookie: 'c' },
    }) as Record<string, unknown>;

    expect(out.studentNo).toBe('2026001');
    expect(out.password).toBe('***');
    expect(out.accessToken).toBe('***');
    expect(out.authorization).toBe('***');

    const nested = out.nested as Record<string, unknown>;
    expect(nested.api_key).toBe('***');
    expect(nested.cookie).toBe('***');
  });

  it('数组内对象的敏感字段同样被脱敏', () => {
    const out = sanitizeBody({ items: [{ password: 'p', name: 'n' }] }) as {
      items: Array<Record<string, unknown>>;
    };

    expect(out.items[0]).toEqual({ password: '***', name: 'n' });
  });

  it('超长字符串被截断并标记长度', () => {
    const out = sanitizeBody({ note: 'x'.repeat(500) }) as Record<
      string,
      unknown
    >;

    expect(String(out.note)).toContain('…(+300)');
  });

  it('超过数组 / 键 / 深度上限时给出标记', () => {
    const arr = sanitizeBody(Array.from({ length: 60 }, () => 1)) as unknown[];
    expect(arr).toHaveLength(51);
    expect(arr[50]).toBe('…(+10)');

    const wide = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`k${i}`, i]),
    );
    const narrowed = sanitizeBody(wide) as Record<string, unknown>;
    expect(Object.keys(narrowed)).toHaveLength(101);
    expect(narrowed['…']).toBe('(+20 keys)');

    let deep: unknown = { end: true };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    expect(JSON.stringify(sanitizeBody(deep))).toContain('[MaxDepth]');
  });

  it('不修改入参', () => {
    const input = { password: 'p' };
    sanitizeBody(input);

    expect(input.password).toBe('p');
  });
});

describe('formatLogBody', () => {
  it('输出单行文本（换行被转义）且已脱敏', () => {
    const text = formatLogBody({ a: 'line1\nline2', password: 'p' });

    expect(text).not.toContain('\n');
    expect(text).toContain('***');
  });

  it('整行超过总长上限时截断', () => {
    const huge = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`key${i}`, 'z'.repeat(200)]),
    );

    expect(formatLogBody(huge).endsWith('…(truncated)')).toBe(true);
  });
});
