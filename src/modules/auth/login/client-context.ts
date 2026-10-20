import type { Request } from 'express';

import { AuthConfigService } from '@/config/auth.config.js';
import {
  describeClient,
  normalizeUserAgent,
  resolveClientIp,
  type ClientInfo,
} from '@/shared/auth/client-info.js';

/** 一次登录/建会话所需的客户端上下文（中间件与应用层之间传递的数据，不带 Request 本身） */
export interface ClientContext extends ClientInfo {
  ip: string;
  userAgent: string;
}

/**
 * 从请求提取客户端上下文。
 *
 * 业务层（service）只接收这个普通对象，不接收 `Request`：把 HTTP 细节挡在用例层之外，
 * 用例测试也就不需要伪造 Express 请求。
 */
export function clientContextOf(
  req: Request,
  config: AuthConfigService,
): ClientContext {
  const userAgent = normalizeUserAgent(req.headers['user-agent']);
  return {
    ...describeClient(userAgent),
    ip: resolveClientIp(req, config.config.trustProxy),
    userAgent,
  };
}

/** 匿名上下文：测试或后台任务建会话时使用（无请求可依） */
export const UNKNOWN_CLIENT_CONTEXT: ClientContext = {
  clientName: '未知设备',
  clientType: 'web',
  ip: '',
  userAgent: '',
};
