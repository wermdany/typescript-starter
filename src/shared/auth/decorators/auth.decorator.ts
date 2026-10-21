import { SetMetadata } from '@nestjs/common';

/** `AuthGuard` 读取该 metadata 判断路由是否免登录 */
export const PUBLIC_KEY = 'auth:public';

/** `AuthGuard` 读取该 metadata 判断路由是否只允许管理员 */
export const ADMIN_ONLY_KEY = 'auth:adminOnly';

/** `PermissionGuard` 读取该 metadata：显式声明"登录即可，不需要任何权限码" */
export const AUTHENTICATED_KEY = 'auth:authenticated';

/**
 * 标记公开路由：免登录访问（登录、刷新 token、健康检查）。
 *
 * 不加任何标记的路由**默认要求登录**：鉴权是 fail-closed 的，
 * 新路由忘了声明也不会意外裸奔，只会被 401 拦下并在联调时立刻发现。
 *
 * 方法级与方法上都可以用；方法级优先。
 *
 * @example
 * @Public()
 * @Post('login')
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * 标记仅管理员可访问的路由（未登录同样 401，已登录但非管理员 403）。
 *
 * @deprecated 已被权限点取代：新代码用 `@RequirePermission('资源:动作')`。
 * 本装饰器在迁移期为"已追踪"状态（`pnpm perm:audit` 会提示升级）。
 *
 * @example
 * @AdminOnly()
 * @Delete('sessions/:id')
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

/**
 * 标记「登录即可」的路由：不需要任何权限码，但必须有身份。
 *
 * 为什么需要显式声明：没有它，`@RequirePermission` 与"忘了写标记"在源码上
 * 长得一模一样，静态审计无法区分二者 —— 这正是权限漏标检测的前提。
 *
 * 与 `@Public()` 的区别：`@Public()` 连登录都不要；`@Authenticated()` 要登录。
 * 与 `@RequirePermission()` 同时出现时以权限码为准（本标记只是"无额外要求"的声明）。
 *
 * @example
 * @Authenticated()
 * @Get('me')
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
