import { describe, expect, it } from 'vitest';

import {
  DUMMY_PASSWORD_HASH,
  generateToken,
  hashToken,
} from '@/shared/auth/token.js';

describe('generateToken', () => {
  it('格式为 43 字符 base64url（256 bit 随机数）', () => {
    const token = generateToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('随机：连续生成不重复', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken));
    expect(tokens.size).toBe(200);
  });
});

describe('hashToken', () => {
  it('sha256 十六进制：64 字符且小写', () => {
    const hash = hashToken('any-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同一 token 摘要稳定（入库与查询一致的前提）', () => {
    expect(hashToken('same')).toBe(hashToken('same'));
  });

  it('不同 token 摘要不同，且摘要不包含原文', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
    expect(hashToken('a-secret-token')).not.toContain('secret');
  });
});

describe('DUMMY_PASSWORD_HASH', () => {
  it('是合法的 scrypt 存储格式（6 段），任何密码都校验失败', async () => {
    const parts = DUMMY_PASSWORD_HASH.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');

    const { verifyPassword } = await import('@/shared/common.js');
    expect(await verifyPassword('12345678', DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword('password', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
