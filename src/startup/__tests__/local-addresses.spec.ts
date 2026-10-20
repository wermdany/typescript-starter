import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  describeBoundAddress,
  listAccessibleUrls,
  type NetworkInterfaces,
} from '@/startup/local-addresses.js';

/** 造一条网卡记录（`cidr` 可以是 null，别写成字符串） */
function iface(
  address: string,
  family: 'IPv4' | 'IPv6',
  internal = false,
): NetworkInterfaceInfo[] {
  const base = {
    address,
    netmask: '',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: null,
  };
  return family === 'IPv4'
    ? [{ ...base, family }]
    : [{ ...base, family, scopeid: 0 }];
}

const PORT = 8000;

describe('listAccessibleUrls', () => {
  it('回环恒在第一位，且不受网卡情况影响', () => {
    const interfaces: NetworkInterfaces = {
      utun0: iface('10.8.0.2', 'IPv4'),
      en0: iface('192.168.1.5', 'IPv4'),
    };

    const urls = listAccessibleUrls(PORT, { interfaces });

    expect(urls[0]).toEqual({
      url: 'http://127.0.0.1:8000',
      label: '本机回环',
    });
  });

  it('只取非 internal 的 IPv4（internal 的 lo0 被排除）', () => {
    const urls = listAccessibleUrls(PORT, {
      interfaces: { lo0: iface('127.0.0.1', 'IPv4', true) },
    });

    expect(urls).toHaveLength(1);
    expect(urls[0].url).toBe('http://127.0.0.1:8000');
  });

  it('跳过 169.254.x.x 链路本地地址（APIPA 路由不出去）', () => {
    const urls = listAccessibleUrls(PORT, {
      interfaces: { en0: iface('169.254.10.2', 'IPv4') },
    });

    expect(urls).toHaveLength(1);
    expect(urls.some((item) => item.url.includes('169.254'))).toBe(false);
  });

  it('同址网卡（物理网卡与虚拟网桥）只列一次', () => {
    const urls = listAccessibleUrls(PORT, {
      interfaces: {
        en0: iface('192.168.1.5', 'IPv4'),
        bridge0: iface('192.168.1.5', 'IPv4'),
      },
    });

    const matched = urls.filter(
      (item) => item.url === 'http://192.168.1.5:8000',
    );
    expect(matched).toHaveLength(1);
  });

  it('忽略全部 IPv6 条目（含回环 ::1 与 fe80:: 链路本地）', () => {
    const urls = listAccessibleUrls(PORT, {
      interfaces: {
        lo0: iface('::1', 'IPv6', true),
        en0: iface('fe80::1', 'IPv6'),
        en1: iface('2001:db8::1', 'IPv6'),
      },
    });

    expect(urls).toHaveLength(1);
    expect(urls.every((item) => !item.url.includes('://['))).toBe(true);
  });

  it('en* 物理网卡排在 utun* 等虚拟网卡之前', () => {
    // 故意把 utun0 放在 en0 前面：macOS 上字典序就是这样，不排序就会误导使用者
    const urls = listAccessibleUrls(PORT, {
      interfaces: {
        utun0: iface('10.8.0.2', 'IPv4'),
        en0: iface('192.168.1.5', 'IPv4'),
      },
    });

    expect(urls.map((item) => item.label)).toEqual([
      '本机回环',
      'en0',
      'utun0',
    ]);
    expect(urls[1].url).toBe('http://192.168.1.5:8000');
    expect(urls[2].url).toBe('http://10.8.0.2:8000');
  });

  it('没有任何网卡时只剩回环（主程序据此打降级说明）', () => {
    expect(listAccessibleUrls(PORT, { interfaces: {} })).toHaveLength(1);
  });

  it('协议前缀可注入（为将来上 TLS 留口）', () => {
    const urls = listAccessibleUrls(443, { protocol: 'https', interfaces: {} });

    expect(urls[0].url).toBe('https://127.0.0.1:443');
  });
});

describe('describeBoundAddress', () => {
  it('未监听返回「尚未监听」', () => {
    expect(describeBoundAddress(null)).toBe('尚未监听');
  });

  it('IPv6 通配 :: 说明为「所有网卡」且不带协议前缀', () => {
    const text = describeBoundAddress({
      address: '::',
      family: 'IPv6',
      port: PORT,
    });

    expect(text).toBe('[::]:8000（所有网卡 · IPv6 通配）');
  });

  it('IPv4 通配 0.0.0.0 说明为「所有网卡」', () => {
    const text = describeBoundAddress({
      address: '0.0.0.0',
      family: 'IPv4',
      port: PORT,
    });

    expect(text).toBe('0.0.0.0:8000（所有网卡）');
  });

  it('具体 IP 原样输出', () => {
    const text = describeBoundAddress({
      address: '192.168.1.5',
      family: 'IPv4',
      port: PORT,
    });

    expect(text).toBe('192.168.1.5:8000');
  });

  it('unix socket 路径原样输出', () => {
    expect(describeBoundAddress('/tmp/nest.sock')).toBe('/tmp/nest.sock');
  });
});
