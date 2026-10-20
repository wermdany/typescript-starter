import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { AddressInfo } from 'node:net';

/** `os.networkInterfaces()` 的返回类型；抽成别名是为了让单测能注入构造数据 */
export type NetworkInterfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface AccessibleUrl {
  /** 完整可访问 URL，如 `http://192.168.1.5:8000` */
  url: string;
  /** 展示标签：回环为「本机回环」，其余为网卡名（如 `en0`） */
  label: string;
}

/** `169.254.0.0/16` 链路本地地址（APIPA）：没拿到 DHCP 时系统自分配，路由不出去 */
const LINK_LOCAL_PREFIX = '169.254.';

/**
 * 网卡排序权重：物理网卡（`en*`）优先，其余虚拟网卡靠后。
 *
 * macOS 上 VPN 的 `utun*` 字典序排在 `en*` 之前，不排序会把 VPN 内网地址顶到最前，
 * 让人误以为那是局域网地址。只排序、不过滤。
 */
function interfaceRank(name: string): number {
  return name.startsWith('en') ? 0 : 1;
}

/** 可用的对外地址：非 internal 的 IPv4（Node 18+ 的 `family` 是字符串） */
function isUsableIpv4(info: NetworkInterfaceInfo): boolean {
  return (
    info.family === 'IPv4' &&
    !info.internal &&
    !info.address.startsWith(LINK_LOCAL_PREFIX)
  );
}

/**
 * 枚举本机可访问地址：回环恒在第一位，随后是各非 internal IPv4 网卡（去重、`en*` 优先）。
 *
 * 不用 `app.getUrl()` 取地址：它把 IPv6 通配 `'::'` 映射成 `'[::1]'`，而本项目
 * `listen(port)` 在 macOS 上绑的正是 `'::'`，于是只会得到 IPv6 回环，拿不到局域网地址。
 *
 * @param port 监听端口
 * @param options.protocol URL 协议前缀（默认 `http`）
 * @param options.interfaces 可注入，便于单测喂构造数据
 */
export function listAccessibleUrls(
  port: number,
  options: { protocol?: string; interfaces?: NetworkInterfaces } = {},
): AccessibleUrl[] {
  const protocol = options.protocol ?? 'http';
  const interfaces = options.interfaces ?? networkInterfaces();

  const result: AccessibleUrl[] = [
    { url: `${protocol}://127.0.0.1:${port}`, label: '本机回环' },
  ];
  const seen = new Set<string>(['127.0.0.1']);

  const entries: [string, NetworkInterfaceInfo[]][] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (infos) entries.push([name, infos]);
  }
  entries.sort(([a], [b]) => interfaceRank(a) - interfaceRank(b));

  for (const [name, infos] of entries) {
    for (const info of infos) {
      if (!isUsableIpv4(info)) continue;
      // 多网卡同址（虚拟网桥与物理网卡共享地址等）只列一次
      if (seen.has(info.address)) continue;
      seen.add(info.address);
      result.push({
        url: `${protocol}://${info.address}:${port}`,
        label: name,
      });
    }
  }

  return result;
}

/**
 * 描述实际监听地址。
 *
 * `0.0.0.0` / `[::]` 代表「所有网卡」而非能点的 URL，因此不加协议前缀并注明。
 *
 * @param address `app.getHttpServer().address()` 的返回（未监听为 `null`，
 *                unix socket 为字符串）
 */
export function describeBoundAddress(
  address: AddressInfo | string | null,
): string {
  if (address === null) return '尚未监听';
  if (typeof address === 'string') return address;
  const { address: host, port } = address;
  if (host === '::') return `[::]:${port}（所有网卡 · IPv6 通配）`;
  if (host === '0.0.0.0') return `0.0.0.0:${port}（所有网卡）`;
  return `${host}:${port}`;
}
