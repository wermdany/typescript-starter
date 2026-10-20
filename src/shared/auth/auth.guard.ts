import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import {
  FORBIDDEN_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  isAdmin,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';
import {
  ADMIN_ONLY_KEY,
  PUBLIC_KEY,
} from '@/shared/auth/decorators/auth.decorator.js';

/** 路由需要满足的访问条件（由装饰器得出，守卫本身不读 metadata） */
export interface AuthRequirement {
  /** 公开路由：免登录 */
  isPublic: boolean;
  /** 仅管理员 */
  adminOnly: boolean;
}

/**
 * 认证守卫（纯逻辑，**不碰 HTTP 上下文**）。
 *
 * 只做两件事：没有身份 → 401；仅管理员的路由但角色不是 admin → 403。
 * 身份由 `modules/auth` 的中间件查会话后写入 `req.user`，守卫不查库，
 * 这样守卫可以在不需要 DatabaseService 的测试里直接构造。
 *
 * 业务权限点（RBAC）接在更上层的守卫里，不与"是否登录"混在一起。
 */
export class AuthGuard {
  canActivate(
    user: AuthenticatedUser | undefined,
    requirement: AuthRequirement,
  ): boolean {
    if (requirement.isPublic) return true;
    if (!user) throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    if (requirement.adminOnly && !isAdmin(user)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    return true;
  }
}

/**
 * 全局守卫：把 Nest 的 `ExecutionContext` 翻译成 {@link AuthGuard} 的纯逻辑入参。
 *
 * 注册在 `app.config.ts` 的 `APP_GUARD`；`@Public()` / `@AdminOnly()` 元数据在这里读取，
 * 方法级覆盖类级。
 */
@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly guard: AuthGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ?? false;
    const adminOnly =
      this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, targets) ??
      false;

    if (isPublic)
      return this.guard.canActivate(undefined, { isPublic, adminOnly });

    const request = context.switchToHttp().getRequest<Request>();
    return this.guard.canActivate(request.user, { isPublic, adminOnly });
  }
}
