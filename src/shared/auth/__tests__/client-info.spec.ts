import { describe, expect, it } from 'vitest';

import type { Request } from 'express';

import {
  UNKNOWN_CLIENT_NAME,
  describeClient,
  normalizeUserAgent,
  resolveClientIp,
} from '@/shared/auth/client-info.js';

const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('describeClient', () => {
  it('桌面 Chrome → Chrome · macOS / web', () => {
    expect(describeClient(DESKTOP_CHROME)).toEqual({
      clientName: 'Chrome · macOS',
      clientType: 'web',
    });
  });

  it('iPhone Safari → Safari · iOS / mobile', () => {
    expect(describeClient(IPHONE_SAFARI)).toEqual({
      clientName: 'Safari · iOS',
      clientType: 'mobile',
    });
  });

  it('Edge 的 UA 含 Chrome，先识别为 Edge', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
    expect(describeClient(ua).clientName).toBe('Edge · Windows');
  });

  it('Android 的 UA 含 Linux，先识别为 Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    expect(describeClient(ua).clientType).toBe('mobile');
    expect(describeClient(ua).clientName).toContain('Android');
  });

  it('识别不出 → 未知设备，不报错（设备信息丢失不阻断登录）', () => {
    expect(describeClient('curl/8.4.0')).toEqual({
      clientName: UNKNOWN_CLIENT_NAME,
      clientType: 'web',
    });
    expect(describeClient(undefined)).toEqual({
      clientName: UNKNOWN_CLIENT_NAME,
      clientType: 'web',
    });
    expect(describeClient('   ')).toEqual({
      clientName: UNKNOWN_CLIENT_NAME,
      clientType: 'web',
    });
  });

  it('摘要不超过列宽 64（超长 UA 也不会撞 varchar 上限）', () => {
    const long = describeClient(
      'A'.repeat(500) + ' Chrome/126.0 Safari/537.36',
    );
    expect(long.clientName.length).toBeLessThanOrEqual(64);
  });
});

describe('resolveClientIp', () => {
  type IpRequest = Pick<Request, 'headers' | 'socket'> & { ip?: string };
  const req = (xff?: string): IpRequest =>
    ({
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      socket: {
        remoteAddress: '203.0.113.9',
      } as unknown as IpRequest['socket'],
    }) as IpRequest;

  it('默认不信任 x-forwarded-for（客户端可伪造该头）', () => {
    expect(resolveClientIp(req('1.2.3.4'), false)).toBe('203.0.113.9');
  });

  it('trustProxy 开启时取 XFF 第一段', () => {
    expect(resolveClientIp(req('1.2.3.4, 10.0.0.1'), true)).toBe('1.2.3.4');
  });

  it('trustProxy 开启但无 XFF → 回落 socket 地址', () => {
    expect(resolveClientIp(req(), true)).toBe('203.0.113.9');
  });

  it('数组形态的 XFF 取第一个', () => {
    expect(resolveClientIp(req('5.6.7.8, 9.9.9.9'), true)).toBe('5.6.7.8');
  });
});

describe('normalizeUserAgent', () => {
  it('trim 并截断到 512', () => {
    expect(normalizeUserAgent('  abc  ')).toBe('abc');
    expect(normalizeUserAgent('x'.repeat(600))).toHaveLength(512);
    expect(normalizeUserAgent(undefined)).toBe('');
  });
});
