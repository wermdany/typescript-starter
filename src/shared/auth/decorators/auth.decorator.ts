import { SetMetadata } from '@nestjs/common';

/** `AuthGuard` 读取该 metadata 判断路由是否免登录 */
export const PUBLIC_KEY = 'auth:public';

/** `AuthGuard` 读取该 metadata 判断路由是否只允许管理员 */
export const ADMIN_ONLY_KEY = 'auth:adminOnly';

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
 * @example
 * @AdminOnly()
 * @Delete('sessions/:id')
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
