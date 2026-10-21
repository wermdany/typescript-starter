import { describe, expect, it } from 'vitest';

import { envSchema } from '@/config/env.js';

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

  it.each(['true', 'TRUE', 'True'])('严格布尔 %s → true', (raw) => {
    const result = parse({ LOG_BODY: raw });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(true);
  });

  it.each(['false', 'FALSE', 'False'])('严格布尔 %s → false', (raw) => {
    const result = parse({ LOG_BODY: raw });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.LOG_BODY).toBe(false);
  });

  it.each(['1', 'yes', 'on', '0', 'no', 'off', '2', 'yep'])(
    '宽松词值 %s 一律 fail-fast（不再接受非 true/false 的写法）',
    (raw) => {
      expect(parse({ LOG_BODY: raw }).success).toBe(false);
    },
  );
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

describe('envSchema / 连接池与认证变量', () => {
  it('DB_POOL_MAX 在 schema 里，默认 10，非法值 fail-fast', () => {
    const result = parse();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.DB_POOL_MAX).toBe(10);
    expect(parse({ DB_POOL_MAX: '0' }).success).toBe(false);
    expect(parse({ DB_POOL_MAX: '1.5' }).success).toBe(false);
  });

  it('schema 只含底层配置键，业务配置（AUTH_* 等）不再从这里注入', () => {
    const result = parse();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(
        [
          'DATABASE_URL',
          'DB_POOL_MAX',
          'LOG_BODY',
          'LOG_FILE',
          'LOG_LEVEL',
          'NODE_ENV',
          'PORT',
        ].sort(),
      );
    }
  });
});
