import { ForbiddenException } from '@nestjs/common';

import { ownsResource, type Actor } from '@/common/auth/ownership.contract.js';

/** 归属校验失败（403）的默认文案 */
export const OWNERSHIP_DENIED_MESSAGE = '只能操作自己的资源';

/**
 * Ownership 的**第二道防线**：在 service 内断言"这条资源属于你"。
 *
 * 为什么路由上已经有 `@OwnerOrPermission()` 还要在 service 里再断一次：
 * - 装饰器只能看到**路径参数**（`id`）。一旦 service 方法被其它入口复用
 *   （内部调用、批量任务、别的 controller），路由上的声明就完全不生效，
 *   而这类复用恰恰是最容易漏的地方
 * - service 内还有派生 id：先查订单、再按订单上的 `user_id` 删明细，
 *   路径里的 `:orderId` 归属成立不代表明细的归属也成立
 *
 * 系统身份（`systemActor()`）恒通过 —— 它是**显式**的绕过，`via` 会进日志；
 * 这与"漏传 actor"完全不同：后者由类型系统拦住（首参必填 `Actor`）。
 *
 * @param actor 操作者（真实用户或显式系统身份）
 * @param ownerId 资源所有者的用户 id
 * @param message 自定义 403 文案（默认「只能操作自己的资源」）
 * @throws ForbiddenException 非本人且非系统身份
 *
 * @example
 * assertOwnership(actor, post.authorId);
 */
export function assertOwnership(
  actor: Actor,
  ownerId: number,
  message: string = OWNERSHIP_DENIED_MESSAGE,
): void {
  if (ownsResource(actor, ownerId)) {
    return;
  }
  throw new ForbiddenException(message);
}
