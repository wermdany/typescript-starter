import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import {
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';
import {
  PERMISSION_DENIED_MESSAGE,
  PERMISSION_CHECKER,
  WILDCARD_PERMISSION,
  type PermissionChecker,
  type PermissionCode,
} from '@/common/auth/permission.contract.js';
import {
  AUTHENTICATED_KEY,
  PUBLIC_KEY,
} from '@/shared/auth/decorators/auth.decorator.js';
import {
  OWNER_KEY,
  PERMISSION_KEY,
  type OwnerRequirement,
} from '@/shared/auth/decorators/rbac.decorator.js';

/** 路由需要满足的访问条件（由装饰器得出，守卫本身不读 metadata） */
export interface AuthRequirement {
  /** 公开路由：免登录 */
  isPublic: boolean;
}

/**
 * 认证守卫（纯逻辑，**不碰 HTTP 上下文**）。
 *
 * 只做一件事：没有身份 → 401。管理员判定不在这里 —— 角色与权限点统一由
 * 更上层的 `PermissionGuard` 管（`@AdminOnly` 已随 RBAC 全部替换而移除）。
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
    return true;
  }
}

/**
 * 全局守卫：把 Nest 的 `ExecutionContext` 翻译成 {@link AuthGuard} 的纯逻辑入参。
 *
 * 注册在 `shared/auth/auth.module.ts` 的 `APP_GUARD`；`@Public()` 元数据在这里读取，
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

    if (isPublic) return this.guard.canActivate(undefined, { isPublic });

    const request = context.switchToHttp().getRequest<Request>();
    return this.guard.canActivate(request.user, { isPublic });
  }
}

/** 路由的鉴权要求（由装饰器元数据翻译而来，守卫内核不读 metadata） */
export interface PermissionRequirement {
  /** 公开路由：免登录、免权限 */
  isPublic: boolean;
  /** `@RequirePermission(...)` 声明的权限码（任一命中即放行） */
  codes: readonly PermissionCode[];
  /** `@OwnerOrPermission(...)` 声明的归属要求（与 `codes` 并存时**归属优先**） */
  owner?: OwnerRequirement;
}

/** 判定所需的请求侧输入 */
export interface PermissionContext {
  user: AuthenticatedUser | undefined;
  /** `req.params`（归属判定要拿 URL 里的资源 id） */
  params: Record<string, string | undefined>;
  /** 权限码解析（实现类负责缓存；失败必须 fail-closed） */
  resolve: (user: AuthenticatedUser) => Promise<ReadonlySet<PermissionCode>>;
}

/**
 * 权限守卫（**纯逻辑，不碰 HTTP 上下文 / 不查库**）。
 *
 * 判定顺序：
 * 1. `@Public()` → 放行
 * 2. 无身份 → 401（自带判定，因此与 `HttpAuthGuard` 的注册顺序无关）
 * 3. `@OwnerOrPermission`：URL 里的资源 id 是本人 → 放行（**不打权限表**）；
 *    非本人则要求权限码，`codes` 为空表示"只允许本人" → 403
 * 4. `@RequirePermission`：持有任一码或通配 `*` → 放行，否则 403
 * 5. 没有任何权限要求（只写了 `@Authenticated()`）→ 放行
 *
 * 注意：归属判定只看 URL 参数。资源归属写在请求体/内部调用里的场景**不在此处**，
 * 由 service 内的 `assertOwnership()` 兜第二道。
 */
export class PermissionGuard {
  async canActivate(
    requirement: PermissionRequirement,
    context: PermissionContext,
  ): Promise<boolean> {
    if (requirement.isPublic) return true;
    if (!context.user) throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);

    if (requirement.owner) {
      const ownerId = Number(context.params[requirement.owner.ownerParam]);
      // 本人：不查权限表，直接放行（本人改自己不该要求 user:update）
      if (Number.isInteger(ownerId) && ownerId === context.user.id) return true;
      if (requirement.owner.codes.length === 0) {
        throw new ForbiddenException(PERMISSION_DENIED_MESSAGE);
      }
      return this.assertCodes(context, requirement.owner.codes);
    }

    if (requirement.codes.length === 0) return true;
    return this.assertCodes(context, requirement.codes);
  }

  private async assertCodes(
    context: PermissionContext,
    required: readonly PermissionCode[],
  ): Promise<boolean> {
    const user = context.user;
    if (!user) throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);

    const granted = await context.resolve(user);
    // 通配 `*` 即超级管理员：新增权限码无需回头授权
    if (granted.has(WILDCARD_PERMISSION)) return true;
    if (required.some((code) => granted.has(code))) return true;
    throw new ForbiddenException(PERMISSION_DENIED_MESSAGE);
  }
}

/**
 * 全局权限守卫：把 Nest 的 `ExecutionContext` 翻译成 {@link PermissionGuard} 的入参。
 *
 * 注册在 `modules/rbac/rbac.module.ts` 的 `APP_GUARD`。与 `HttpAuthGuard` 分工：
 * 那个管"有没有登录"，这个管"有没有某个权限点 / 是不是资源本人"。
 * 本守卫在无身份时也返回 401，所以两者谁先执行都不影响结果。
 */
@Injectable()
export class HttpPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly guard: PermissionGuard,
    @Inject(PERMISSION_CHECKER)
    private readonly checker: PermissionChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ?? false;
    const codes =
      this.reflector.getAllAndOverride<readonly PermissionCode[]>(
        PERMISSION_KEY,
        targets,
      ) ?? [];
    const owner = this.reflector.getAllAndOverride<OwnerRequirement>(
      OWNER_KEY,
      targets,
    );
    // 显式「登录即可」与"没有任何权限要求"在运行时等价；
    // 但 AUTHENTICATED_KEY 的存在让静态审计能区分"声明过"与"忘了写"
    this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets);

    const request = context.switchToHttp().getRequest<Request>();
    return this.guard.canActivate(
      { isPublic, codes, owner },
      {
        user: request.user,
        params: (request.params ?? {}) as Record<string, string | undefined>,
        resolve: (user) => this.checker.resolveCodes(user),
      },
    );
  }
}
