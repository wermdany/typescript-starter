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

/**
 * `169.254.0.0/16` —— 链路本地地址（APIPA）。
 *
 * 插了网线但没拿到 DHCP 时系统会自分配一个，路由不出去、对外毫无意义，必须跳过，
 * 否则日志里会出现一个「看着像局域网地址但谁都连不上」的条目。
 */
const LINK_LOCAL_PREFIX = '169.254.';

/**
 * 网卡排序权重：物理网卡（`en*`）优先，其余虚拟网卡靠后。
 *
 * **为什么不按网卡名字典序**：macOS 上 VPN 的 `utun*` 字典序往往排在 `en*` 之前，
 * 不排序就会把 VPN 内网地址顶到列表最前，让人误以为那是「局域网地址」。
 * 注意这里**只排序不过滤** —— VPN / bridge 地址在排查时仍有价值，保留但靠后。
 */
function interfaceRank(name: string): number {
  return name.startsWith('en') ? 0 : 1;
}

/** 可用的对外地址：非 internal 的 IPv4（Node 18+ 的 `family` 是字符串，不是数字 6/4） */
function isUsableIpv4(info: NetworkInterfaceInfo): boolean {
  return (
    info.family === 'IPv4' &&
    !info.internal &&
    !info.address.startsWith(LINK_LOCAL_PREFIX)
  );
}

/**
 * 枚举本机可访问地址：**回环恒在第一位**，随后是各非 internal IPv4 网卡（去重、`en*` 优先）。
 *
 * **为什么不用 `app.getUrl()`**：它把 IPv6 通配 `'::'` 映射成 `'[::1]'`
 * （见 `@nestjs/core` 的 `nest-application.js` `formatAddress`），而本项目
 * `listen(env.PORT)` 没传 host，macOS 上实际绑的正是 `'::'` —— 于是 `getUrl()`
 * 只会给出 IPv6 回环，拿不到任何局域网地址。这就是本工具存在的理由。
 *
 * @param port 监听端口
 * @param options.protocol URL 协议前缀（默认 `http`；将来上 TLS 由 `getUrl()` 的协议段透传）
 * @param options.interfaces 可注入（默认真实调用 `os.networkInterfaces()`），便于单测喂构造数据
 */
export function listAccessibleUrls(
  port: number,
  options: { protocol?: string; interfaces?: NetworkInterfaces } = {},
): AccessibleUrl[] {
  const protocol = options.protocol ?? 'http';
  const interfaces = options.interfaces ?? networkInterfaces();

  // 回环恒定第一位：它是不受网线 / VPN / 是否插网影响的唯一可靠地址
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
      result.push({ url: `${protocol}://${info.address}:${port}`, label: name });
    }
  }

  return result;
}

/**
 * 描述「实际监听地址」，把通配符讲成人话。
 *
 * 关键是把 `0.0.0.0` / `[::]` 与真正的可访问 URL 区分开：它们代表「所有网卡」，
 * **不是**一个能直接点的地址，所以这里**不加协议前缀**，并在后面注明「所有网卡」。
 *
 * @param address `app.getHttpServer().address()` 的返回（未监听时为 `null`，unix socket 时为字符串）
 */
export function describeBoundAddress(
  address: AddressInfo | string | null,
): string {
  if (address === null) return '尚未监听';
  if (typeof address === 'string') return address; // unix socket 路径，原样输出
  const { address: host, port } = address;
  if (host === '::') return `[::]:${port}（所有网卡 · IPv6 通配）`;
  if (host === '0.0.0.0') return `0.0.0.0:${port}（所有网卡）`;
  return `${host}:${port}`;
}
