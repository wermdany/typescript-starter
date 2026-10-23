import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import {
  ACCESS_INTENT_KEY,
  resolveAccess,
  type AccessIntent,
} from '@/common/auth/access.js';
import {
  PERMISSION_CHECKER,
  type PermissionChecker,
} from '@/common/auth/permission.contract.js';

/**
 * 全局守卫（**唯一放行闸门**）：登录态 + 权限码 + 归属三层合一。
 *
 * 只读一把 key、只调一次 {@link resolveAccess}，因此"这条路由到底放不放行"
 * 看一个文件就能回答。
 *
 * 分工：
 * - 身份由 `modules/auth/session` 的认证中间件查会话后写入 `req.user`，守卫**不查库**
 * - 权限码解析通过 `PERMISSION_CHECKER` 端口注入，且**懒求值**（本人分支不触发）
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSION_CHECKER)
    private readonly checker: PermissionChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 方法级覆盖类级：四个装饰器共用 ACCESS_INTENT_KEY，因此这里只读一次
    const intent = this.reflector.getAllAndOverride<AccessIntent>(
      ACCESS_INTENT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();
    await resolveAccess(intent, {
      user: request.user,
      params: (request.params ?? {}) as Record<string, string | undefined>,
      // 懒 thunk：真正需要权限码时才打库（本人分支不查权限表）
      resolveCodes: (user) => this.checker.resolveCodes(user),
    });
    return true;
  }
}
