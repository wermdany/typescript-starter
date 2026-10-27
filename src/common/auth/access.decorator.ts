import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtension } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';
import { ACCESS_INTENT_KEY, type AccessIntent } from '@/common/auth/access.js';
import { BEARER_SCHEME } from '@/common/openapi/document.js';
import { ApiCommonError } from '@/common/openapi/response.decorator.js';
import type { PermissionCode } from '@/common/auth/permission.contract.js';

export type { AuthenticatedUser } from '@/common/auth/auth.contract.js';

/**
 * 访问意图装饰器族：**四个装饰器、一把 metadata 键、一种判定**。
 *
 * 写入的是 {@link AccessIntent} 判别联合，判定在 `access.ts` 的 `resolveAccess()`，
 * 翻译 Nest 上下文在 `access.guard.ts`。三者分开是为了让"声明 / 判定 / 接入"
 * 各自可读、可测。
 *
 * 标记装饰器的**名字与参数形状**是静态审计的锚点（`scripts/lib/markers.mjs`
 * 按字面名识别），改名或改变参数顺序会让 `pnpm perm:audit` 失明。
 *
 * @example
 * import {
 *   Authenticated,
 *   CurrentUser,
 *   OwnerOrPermission,
 *   Public,
 *   RequirePermission,
 *   type AuthenticatedUser,
 * } from '@/common/auth/access.decorator.js';
 */

/**
 * 标记公开路由：免登录访问（登录、刷新 token、健康检查）。
 *
 * 不加任何标记的路由**默认要求登录**：鉴权是 fail-closed 的，
 * 新路由忘了声明也不会意外裸奔，只会被 401 拦下并在联调时立刻发现。
 *
 * 方法级与类级都可以用；方法级优先。
 *
 * @example
 * @Public()
 * @Post('login')
 */
export const Public = () =>
  SetMetadata(ACCESS_INTENT_KEY, {
    kind: 'public',
  } satisfies AccessIntent);

/**
 * 标记「登录即可」的路由：不需要任何权限码，但必须有身份。
 *
 * 为什么需要显式声明：没有它，`@RequirePermission` 与"忘了写标记"在源码上
 * 长得一模一样，静态审计无法区分二者 —— 这正是权限漏标检测的前提。
 *
 * 与 `@Public()` 的区别：`@Public()` 连登录都不要；`@Authenticated()` 要登录。
 *
 * 文档侧随之带出 401 与 bearer 鉴权 —— 鉴权要求只在**一个地方**声明。
 *
 * @example
 * @Authenticated()
 * @Get('me')
 */
export const Authenticated = () =>
  applyDecorators(
    SetMetadata(ACCESS_INTENT_KEY, {
      kind: 'authenticated',
    } satisfies AccessIntent),
    ApiBearerAuth(BEARER_SCHEME),
    ApiCommonError(401),
  );

/**
 * 声明路由要求的权限码（**任一命中即放行**，AND 需求请拆成多个路由或下沉到 service）。
 *
 * 参数必须是字符串字面量：`pnpm perm:audit` 靠静态读取它们建立"权限点清单"，
 * 传变量/拼接虽然运行时能跑，但会让审计无法确定取值（脚本会给告警）。
 *
 * 不传参数等于"登录即可"，但用 `@Authenticated()` 表达更清楚。
 *
 * @example
 * @RequirePermission('user:create')
 * @Post()
 */
export const RequirePermission = (...codes: PermissionCode[]) =>
  applyDecorators(
    SetMetadata(ACCESS_INTENT_KEY, {
      kind: 'permission',
      codes,
    } satisfies AccessIntent),
    ApiBearerAuth(BEARER_SCHEME),
    ApiExtension('x-permission', [...codes]),
    ApiCommonError(401),
    ApiCommonError(403),
  );

/**
 * 声明「本人 或 持有权限码」的路由（OR 语义）。
 *
 * - 本人：`req.params[ownerParam] === user.id` ⇒ 直接放行，**不查权限表**
 * - 非本人：要求 `codes` 中任一；`codes` 为空表示"只允许本人"
 *
 * 这只是**第一道**防线。绕过 HTTP 守卫的内部调用不会被它拦住 ——
 * service 内必须另用 `assertOwnership()`（第二道防线），两者共用
 * `common/auth/ownership.contract.ts` 的同一组谓词。
 *
 * @example
 * @OwnerOrPermission('id', 'user:update')   // 本人改自己，管理员改别人
 * @OwnerOrPermission('id')                  // 只允许本人
 * @Patch(':id')
 */
export const OwnerOrPermission = (
  ownerParam: string,
  ...codes: PermissionCode[]
) =>
  applyDecorators(
    SetMetadata(ACCESS_INTENT_KEY, {
      kind: 'owner',
      ownerParam,
      codes,
    } satisfies AccessIntent),
    ApiBearerAuth(BEARER_SCHEME),
    // `x-owner-param` 与 `x-permission` 合起来表达 OR 语义：
    // 路径参数命中本人则放行，否则要求权限码
    ApiExtension('x-owner-param', ownerParam),
    ...(codes.length > 0
      ? [ApiExtension('x-permission', [...codes]), ApiCommonError(403)]
      : []),
    ApiCommonError(401),
  );

/**
 * 取当前登录用户（认证中间件注入的 `req.user`）。
 *
 * **不要**用路径参数或请求体推断"是谁"：身份只来自会话。
 * 缺失时抛 401 —— 正常情况下 `AccessGuard` 已经拦过，这里是兜底。
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
