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

describe('envSchema / 连接池与认证变量', () => {
  it('DB_POOL_MAX 在 schema 里，默认 10，非法值 fail-fast', () => {
    const result = parse();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.DB_POOL_MAX).toBe(10);
    expect(parse({ DB_POOL_MAX: '0' }).success).toBe(false);
    expect(parse({ DB_POOL_MAX: '1.5' }).success).toBe(false);
  });

  it('认证变量未设置时给出可用默认值（access 2h / refresh 7d / 滑动续期）', () => {
    const result = parse();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        AUTH_ACCESS_TTL_MINUTES: 120,
        AUTH_REFRESH_TTL_DAYS: 7,
        AUTH_REFRESH_SLIDING: true,
        AUTH_REFRESH_WINDOW_MINUTES: 5,
        AUTH_MAX_SESSIONS_PER_USER: 20,
        AUTH_LOGIN_MAX_ATTEMPTS: 10,
        AUTH_LOGIN_WINDOW_MINUTES: 15,
        AUTH_TRUST_PROXY: false,
      });
    }
  });

  it('有效期必须为正整数', () => {
    expect(parse({ AUTH_ACCESS_TTL_MINUTES: '0' }).success).toBe(false);
    expect(parse({ AUTH_REFRESH_TTL_DAYS: '-7' }).success).toBe(false);
  });

  it('认证布尔变量同样走布尔词表（不接受随意字符串）', () => {
    const result = parse({
      AUTH_REFRESH_SLIDING: 'off',
      AUTH_TRUST_PROXY: 'on',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_REFRESH_SLIDING).toBe(false);
      expect(result.data.AUTH_TRUST_PROXY).toBe(true);
    }
    expect(parse({ AUTH_TRUST_PROXY: 'maybe' }).success).toBe(false);
  });
});
