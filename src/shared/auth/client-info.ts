import type { Request } from 'express';

/**
 * 从请求中提取**只用于审计与展示**的客户端信息。
 *
 * 这两项都不参与鉴权判定：UA 可被任意伪造，IP 可被代理改写。它们的作用是让用户
 * 在「我的登录设备」里认出会话、让审计日志能被追溯。
 */

/** 设备形态，用于前端按端分组展示 */
export type ClientType = 'web' | 'mobile' | 'desktop';

/** 设备摘要 */
export interface ClientInfo {
  /** 展示名，如 `Chrome · macOS`；识别不出时为「未知设备」 */
  clientName: string;
  clientType: ClientType;
}

/** 识别不出设备时的展示名（落库也要可读，不用空串） */
export const UNKNOWN_CLIENT_NAME = '未知设备';

/** 摘要长度上限，与 `auth_sessions.client_name` 列一致 */
const CLIENT_NAME_MAX_LENGTH = 64;

/** User-Agent 落库前的截断上限：UA 可以很长，且对审计而言前缀已足够辨识 */
export const USER_AGENT_MAX_LENGTH = 512;

/** 浏览器识别表，顺序即优先级（Edge 的 UA 同时含 Chrome，必须先判） */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/CriOS\//, 'Chrome'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

/** 操作系统识别表，顺序即优先级（Android 的 UA 含 Linux，必须先判） */
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows NT/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** 明确表示"移动端"的特征；同时用于识别 App 内置 WebView */
const MOBILE_PATTERN = /Mobile|Android|iPhone|iPad|iPod/;

/** 桌面客户端特征（Electron / Tauri 等原生壳） */
const DESKTOP_PATTERN = /Electron\/|Tauri\/|PostmanRuntime/;

/**
 * 从 User-Agent 解析设备摘要。纯函数，识别不出时回落到「未知设备」而不是报错 ——
 * 设备信息丢失不该阻断登录。
 *
 * @example
 * describeClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) … Mobile/15E148 Safari/604.1')
 * // → { clientName: 'Safari · iOS', clientType: 'mobile' }
 */
export function describeClient(userAgent: string | undefined): ClientInfo {
  const ua = userAgent?.trim() ?? '';
  if (!ua) {
    return { clientName: UNKNOWN_CLIENT_NAME, clientType: 'web' };
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  const clientType: ClientType = DESKTOP_PATTERN.test(ua)
    ? 'desktop'
    : MOBILE_PATTERN.test(ua)
      ? 'mobile'
      : 'web';

  const clientName = [browser, system]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
    .slice(0, CLIENT_NAME_MAX_LENGTH);

  return { clientName: clientName || UNKNOWN_CLIENT_NAME, clientType };
}

/** 读取 `x-forwarded-for` 的第一段（最近的客户端），仅用于可信任代理的场景 */
function firstForwardedIp(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.split(',')[0]?.trim() ?? '';
}

/**
 * 解析客户端 IP。
 *
 * 只有 `trustProxy` 为真时才读 `x-forwarded-for`：该请求头由客户端随手可填，
 * 无条件信任等于让人伪造审计记录。未配置代理时以 socket 对端地址为准。
 */
export function resolveClientIp(
  req: Pick<Request, 'headers' | 'socket'> & { ip?: string },
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = firstForwardedIp(req.headers['x-forwarded-for']);
    if (forwarded) return forwarded;
  }
  // `req.ip` 依赖 Express 的 'trust proxy' 设置；这里直取 socket 地址，行为可预期
  return req.socket?.remoteAddress ?? req.ip ?? '';
}

/** User-Agent 落库前的规整与截断 */
export function normalizeUserAgent(userAgent: string | undefined): string {
  return (userAgent ?? '').trim().slice(0, USER_AGENT_MAX_LENGTH);
}
