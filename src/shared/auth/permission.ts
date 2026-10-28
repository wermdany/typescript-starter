import {
  WILDCARD_PERMISSION,
  type PermissionChecker,
  type PermissionCode,
} from '@/common/auth/permission.contract.js';
import {
  isSystemActor,
  type Actor,
} from '@/common/auth/ownership.contract.js';

/**
 * 「能不能动**别人**的资源」的**唯一判定**：只看权限码，不看角色。
 *
 * ## 为什么不是角色
 *
 * 把"能删别人的用户/文件"绑死在 admin 上，将来要加一个"只能删文件、不能删用户"的角色，
 * 就得改业务代码。角色只是权限码的载体 —— 授权关系在数据库里改，代码不动。
 *
 * ## 为什么抽成函数
 *
 * 同一个判定会在多个 service 里出现（用户、文件，将来还有别的资源）。各抄一份
 * 看起来只是 5 行，但它决定的是**准入门槛**：两份实现一旦漂移（一边忘了认 `*`、
 * 一边忘了放行系统身份），差出来的就是权限漏洞，而且不会有任何报错。
 *
 * ## 语义
 *
 * - 系统身份（`systemActor()`）恒为 `true`：它是**显式**的绕过，`via` 会进日志
 * - 通配码 `*` 与具体权限码同等处理，与路由守卫的判定保持一致
 *
 * 注意它只回答"能否操作他人的资源"。**本人**那条路不需要它 ——
 * 调用方的写法固定为：
 *
 * ```ts
 * if (!(await holdsPermission(checker, actor, 'file:delete'))) {
 *   assertOwnership(actor, row.ownerId, '只能删除自己的文件');
 * }
 * ```
 *
 * 于是"本人"与"持码者"是 OR 关系，其余一律 403。
 *
 * @param checker 权限解析器（`PERMISSION_CHECKER`，模块内注入）
 * @param actor 操作者
 * @param code 需要的权限码（如 `file:read`）
 */
export async function holdsPermission(
  checker: PermissionChecker,
  actor: Actor,
  code: PermissionCode,
): Promise<boolean> {
  if (isSystemActor(actor)) {
    return true;
  }
  const granted = await checker.resolveCodes(actor);
  return granted.has(WILDCARD_PERMISSION) || granted.has(code);
}
