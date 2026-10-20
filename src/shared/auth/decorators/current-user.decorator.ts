import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';

/**
 * 取当前登录用户（认证中间件注入的 `req.user`）。
 *
 * **不要**用路径参数或请求体推断"是谁"：身份只来自会话。
 * 缺失时抛 401 —— 正常情况下 `AuthGuard` 已经拦过，这里是兜底。
 *
 * @example
 * me(@CurrentUser() user: AuthenticatedUser)
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    }
    return request.user;
  },
);
