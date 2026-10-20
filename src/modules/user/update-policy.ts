import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import { isAdmin } from '@/shared/auth.js';

/**
 * 用户资料的**字段级修改权限白名单**。
 *
 * 为什么用白名单而不是 if/else 逐字段判断：
 * - 判定逻辑是**数据**（角色 → 可改字段集），新增角色 / 新增受控字段时只改一张表，
 *   不碰 service 流程；漏判的风险从"改对 if 条件"降为"表里加一个键"
 * - 判定结果可单测、可导出给前端（告诉前端"当前用户能编辑哪些字段"）
 * - service 里的业务流程（校验 → 更新 → 吊销会话）与权限规则解耦
 *
 * 规则语义：
 * - `self`：本人对本人 —— 只能改基础资料（email / nickname），改不了角色与积分
 * - `admin`：管理员 —— 可改任意用户的任意字段（含 role / points 这类受控字段）
 *
 * ⚠️ 白名单是**可改字段集**，不是"排除名单"：新字段默认不可改，必须显式加入，
 * 避免"加列即泄露"（与投影白名单同一取向）。
 */
const UPDATE_POLICY = {
  self: new Set(['email', 'nickname']),
  admin: new Set(['email', 'nickname', 'role', 'points']),
} as const satisfies Record<'self' | 'admin', ReadonlySet<string>>;

/** 角色在策略表中的键（admin 角色即 admin 键；其它角色一律按 self 处理） */
function policyKeyFor(actor: AuthenticatedUser): keyof typeof UPDATE_POLICY {
  return isAdmin(actor) ? 'admin' : 'self';
}

/** actor 对 id 对应用户可修改的字段集合（白名单） */
export function updatableFieldsFor(
  actor: AuthenticatedUser,
  id: number,
): ReadonlySet<string> {
  // 非本人（且非管理员，由下方 filter 兜住）不允许任何字段更新
  const isSelf = actor.id === id;
  const fields = UPDATE_POLICY[policyKeyFor(actor)];
  return isSelf || policyKeyFor(actor) === 'admin' ? fields : new Set();
}

/**
 * 从 DTO 里筛出 actor 有权修改的字段，并报告是否有越权字段。
 *
 * @returns `allowed` —— 过滤后的部分 DTO（可直接进 `update().set()`）；
 *          `denied` —— 越权字段列表（排序稳定，错误信息可断言）
 * @throws 全部字段都越权时由调用方决定 403 文案（这里保持纯函数）
 *
 * @example
 * // 学生改自己：{ nickname: 'x', role: 'admin' } → allowed = { nickname }, denied = ['role']
 * const { allowed, denied } = filterUpdatable(actor, targetId, dto);
 * if (denied.length > 0) throw new ForbiddenException(...);
 */
export function filterUpdatable<T extends Record<string, unknown>>(
  actor: AuthenticatedUser,
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
