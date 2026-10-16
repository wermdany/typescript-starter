import { describe, expect, it } from 'vitest';

import { envSchema } from './env.js';

/** 只提供必填项，其余走 schema 默认值 */
function parse(extra: Record<string, string> = {}) {
  return envSchema.safeParse({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/learn_nest',
    ...extra,
  });
}

describe('envSchema / LOG_BODY', () => {
  it('未设置时默认 false', () => {
    const result = parse();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(false);
  });

  it("'false' 解析为 false（防 z.coerce.boolean 把 'false' 判成 true 的陷阱）", () => {
    const result = parse({ LOG_BODY: 'false' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(false);
  });

  it('空串按"未设置"处理，回落到默认 false', () => {
    const result = parse({ LOG_BODY: '' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on', 'TRUE'])('真值词表 %s → true', (raw) => {
    const result = parse({ LOG_BODY: raw });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', 'Off'])('假值词表 %s → false', (raw) => {
    const result = parse({ LOG_BODY: raw });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(false);
  });

  it('非法值 fail-fast', () => {
    expect(parse({ LOG_BODY: '2' }).success).toBe(false);
    expect(parse({ LOG_BODY: 'yep' }).success).toBe(false);
  });
});

describe('envSchema / LOG_FILE', () => {
  it('默认 logs/app.log', () => {
    const result = parse();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_FILE).toBe('logs/app.log');
  });

  it('显式置空即关闭文件写入', () => {
    const result = parse({ LOG_FILE: '' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_FILE).toBe('');
  });
});
