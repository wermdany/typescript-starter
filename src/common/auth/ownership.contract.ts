import type { AuthenticatedUser } from './auth.contract.js';

/**
 * 归属（Ownership）的**纯契约**：`Actor` 联合类型与一组纯谓词。
 *
 * 不依赖 Nest 与数据库 —— 守卫（`shared`）与 service（`modules`）共用同一组谓词，
 * 保证「路由层第一道防线」与「service 内第二道防线」的归属语义不会漂移。
 *
 * 约定（R4）：`SystemActor` 绕过 Ownership 与 RBAC，因此只能出现在
 * `scripts/` / `drizzle/` / 定时任务里，HTTP 请求上下文内禁止构造。
 */

/** 系统身份的 id：不属于任何真实用户，仅用于留痕 */
export const SYSTEM_ACTOR_ID = 0;

/**
 * 可信内部调用身份（迁移 / 种子 / 定时任务）。
 *
 * `roles` 恒为空：它靠 `kind` 短路，不靠角色授权，避免 `isAdmin(systemActor)` 为真。
 */
export interface SystemActor {
  readonly kind: 'system';
  readonly id: number;
  readonly roles: readonly string[];
  /** 来源用途，如 `drizzle:0005` / `script:sync-permissions` */
  readonly via: string;
}

/** 操作者：真实登录用户 或 可信内部调用 */
export type Actor = AuthenticatedUser | SystemActor;

/** 系统身份的共享空角色集合（冻结，防止被就地改写） */
const SYSTEM_ACTOR_ROLES: readonly string[] = Object.freeze([]);

/**
 * 构造系统身份。
 *
 * @param via 来源用途（必填且非空）—— 出现在日志与审计里，用于回答"谁绕过了鉴权"
 * @throws TypeError `via` 为空白串时抛错，把 R4「必须写明来源」变成机械约束
 *
 * @example
 * const actor = systemActor('drizzle:0005');
 */
export function systemActor(via: string): SystemActor {
  if (via.trim() === '') {
    throw new TypeError('systemActor(via)：来源用途不能为空，请写明调用来源');
  }
  return {
    kind: 'system',
    id: SYSTEM_ACTOR_ID,
    roles: SYSTEM_ACTOR_ROLES,
    via,
  };
}

/** 是否为系统身份（判别靠 `kind`，`AuthenticatedUser` 没有该字段） */
export function isSystemActor(actor: Actor): actor is SystemActor {
  return 'kind' in actor && actor.kind === 'system';
}

/**
 * 资源是否归属该操作者（**归属判定的唯一入口**）。
 *
 * 系统身份恒为 `true`（R4），因此调用方必须确保它不来自 HTTP 上下文。
 */
export function ownsResource(actor: Actor, ownerId: number): boolean {
  return isSystemActor(actor) || actor.id === ownerId;
}

/** 取操作者 id（系统身份为 `SYSTEM_ACTOR_ID`）；`actor` 为系统身份时不要拿它当真实用户用 */
export function actorIdOf(actor: Actor): number {
  return actor.id;
}
