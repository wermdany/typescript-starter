import { isAdmin } from '@/common/auth/auth.contract.js';
import {
  ownsResource,
  isSystemActor,
  type Actor,
} from '@/common/auth/ownership.contract.js';

/**
 * 用户资料的**字段级修改权限白名单**。
 *
 * 为什么用白名单而不是 if/else 逐字段判断：
 * - 判定逻辑是**数据**（策略 → 可改字段集），新增角色 / 新增受控字段时只改一张表，
 *   不碰 service 流程；漏判的风险从"改对 if 条件"降为"表里加一个键"
 * - 判定结果可单测、可导出给前端（告诉前端"当前用户能编辑哪些字段"）
 * - service 里的业务流程（校验 → 更新 → 吊销会话）与权限规则解耦
 *
 * 规则语义（三分支，互斥且穷尽）：
 * - `system`：可信内部调用 —— 视同管理员，但 `via` 会进日志，可追溯
 * - `admin`：管理员 —— 可改任意用户的任意字段（含 roles / points 这类受控字段）
 * - `self`：本人对本人 —— 只能改基础资料（email / nickname），改不了角色与积分
 * - `none`：既不是本人也不是管理员 —— 空白名单，任何字段都越权
 *
 * `none` 单独成支而不是复用 `self` 的空集判断：`self` 有字段而 `none` 没有，
 * 两者分开后"这个账号能改什么"在数据里一眼可读，也不依赖 service 里额外的
 * `actor.id !== id` 前置判断（漏写那个判断就等于把 self 权限发给了所有人）。
 *
 * ⚠️ 白名单是**可改字段集**，不是"排除名单"：新字段默认不可改，必须显式加入，
 * 避免"加列即泄露"（与投影白名单同一取向）。
 */
const UPDATE_POLICY = {
  none: new Set<string>(),
  self: new Set(['email', 'nickname']),
  admin: new Set(['email', 'nickname', 'roles', 'points']),
  system: new Set(['email', 'nickname', 'roles', 'points']),
} as const satisfies Record<PolicyKey, ReadonlySet<string>>;

/** 策略键（穷尽联合：加一支而漏配白名单会在 `satisfies` 处编译报错） */
export type PolicyKey = 'system' | 'admin' | 'self' | 'none';

/**
 * 选出该操作者对目标用户的策略键。
 *
 * 归属判定复用契约里的 `ownsResource()`（唯一入口），不手写 `actor.id === id`：
 * 系统身份的绕过语义只定义在一处，两处各写一份必然漂移。
 */
export function policyKeyFor(actor: Actor, targetId: number): PolicyKey {
  // 系统身份靠 kind 短路，它的 roles 恒为空，先判它再判角色
  if (isSystemActor(actor)) return 'system';
  // admin 是权限最大的真实用户身份，可操作任意用户
  if (isAdmin(actor)) return 'admin';
  return ownsResource(actor, targetId) ? 'self' : 'none';
}

/** actor 对 id 对应用户可修改的字段集合（白名单） */
export function updatableFieldsFor(
  actor: Actor,
  id: number,
): ReadonlySet<string> {
  return UPDATE_POLICY[policyKeyFor(actor, id)];
}

/**
 * 从 DTO 里筛出 actor 有权修改的字段，并报告是否有越权字段。
 *
 * @returns `allowed` —— 过滤后的部分 DTO（可直接进 `update().set()`）；
 *          `denied` —— 越权字段列表（排序稳定，错误信息可断言）
 * @throws 全部字段都越权时由调用方决定 403 文案（这里保持纯函数）
 *
 * @example
 * // 学生改自己：{ nickname: 'x', roles: ['admin'] } → allowed = { nickname }, denied = ['roles']
 * const { allowed, denied } = filterUpdatable(actor, targetId, dto);
 * if (denied.length > 0) throw new ForbiddenException(...);
 */
export function filterUpdatable<T extends Record<string, unknown>>(
  actor: Actor,
  id: number,
  dto: T,
): { allowed: Partial<T>; denied: string[] } {
  const allowed = updatableFieldsFor(actor, id);
  const permitted: Partial<T> = {};
  const denied: string[] = [];

  for (const [key, value] of Object.entries(dto)) {
    if (value === undefined) continue; // 省略 key = 不改动，不参与判定
    if (allowed.has(key)) {
      (permitted as Record<string, unknown>)[key] = value;
    } else {
      denied.push(key);
    }
  }
  // denied 稳定排序，便于测试断言与错误信息可读
  denied.sort();
  return { allowed: permitted, denied };
}
