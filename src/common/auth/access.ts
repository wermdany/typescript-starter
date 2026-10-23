import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import {
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';
import {
  PERMISSION_DENIED_MESSAGE,
  WILDCARD_PERMISSION,
  type PermissionCode,
} from '@/common/auth/permission.contract.js';

/**
 * 访问意图的**纯判定逻辑**：一份 metadata 表达四种意图，一次判定回答"放不放行"。
 *
 * 与 `access.decorator.ts`（写入 metadata）和 `access.guard.ts`（翻译 Nest 上下文）
 * 分开：本文件不碰 HTTP 上下文、不碰 metadata 读取，因此四种意图的分支可以逐条单测。
 */

/**
 * 访问意图的 metadata 键。
 *
 * **只有一个键**：四个装饰器写同一把 key，`Reflector.getAllAndOverride` 才能表达
 * "方法级覆盖类级"。多把 key 时"类上 `@Public()` + 方法上 `@RequirePermission()`"
 * 会同时命中两个键，判定顺序取决于读键顺序，不可推理。
 */
export const ACCESS_INTENT_KEY = 'platform:access';

/**
 * 路由声明的访问意图（判别联合）。
 *
 * 四种意图互斥，恰好对应四个装饰器；漏标时由 {@link resolveAccess} 回落到
 * `authenticated`（fail-closed）。
 */
export type AccessIntent =
  /** 免登录、免权限（登录 / 刷新 / 健康检查） */
  | { readonly kind: 'public' }
  /** 登录即可，不需要任何权限码 */
  | { readonly kind: 'authenticated' }
  /** 持有任一权限码即放行 */
  | { readonly kind: 'permission'; readonly codes: readonly PermissionCode[] }
  /** 本人放行；非本人要求任一权限码（`codes` 为空 ⇒ 只允许本人） */
  | {
      readonly kind: 'owner';
      readonly ownerParam: string;
      readonly codes: readonly PermissionCode[];
    };

/** 判定所需的请求侧输入（守卫负责填充，判定本身不读 HTTP 上下文） */
export interface AccessSubject {
  /** 认证中间件注入的身份；匿名请求为 `undefined` */
  readonly user: AuthenticatedUser | undefined;
  /** `req.params`（归属判定要拿 URL 里的资源 id） */
  readonly params: Record<string, string | undefined>;
  /**
   * 权限码解析（实现类负责缓存；失败必须 fail-closed）。
   *
   * **必须是懒 thunk**：本人分支不查权限表，若在构造 subject 时先求值，
   * "本人改自己"也会打一次库（且权限表不可读时本人反而被 403）。
   */
  readonly resolveCodes: (
    user: AuthenticatedUser,
  ) => Promise<ReadonlySet<PermissionCode>>;
}

/**
 * 判定路由是否放行，放行返回 `true`，拒绝直接抛 401 / 403。
 *
 * 判定顺序（四类意图互斥，逐分支穷举）：
 *
 * 1. `intent` 缺失 → 按 `authenticated`（新路由忘了声明也不会裸奔，只会 401）
 * 2. `public` → 放行，**不读 user、不查库**
 * 3. 无身份 → 401「请先登录」
 * 4. `owner`：URL 资源 id 是本人 → 放行（**不查权限表**）；
 *    `codes` 为空表示"只允许本人" → 403；否则走权限码
 * 5. `permission`：`codes` 为空 → 放行；否则走权限码
 * 6. `authenticated` → 放行
 *
 * 注意：归属判定只看 URL 参数。资源归属写在请求体 / 内部调用里的场景**不在此处**，
 * 由 service 内的 `assertOwnership()` 兜第二道。
 *
 * @throws UnauthorizedException 未登录（401）
 * @throws ForbiddenException 权限不足 / 非本人（403）
 *
 * @example
 * await resolveAccess(intent, { user, params, resolveCodes });
 */
export async function resolveAccess(
  intent: AccessIntent | undefined,
  subject: AccessSubject,
): Promise<true> {
  // 1. 漏标 = fail-closed：按"登录即可"处理，而不是放行
  const effective: AccessIntent = intent ?? { kind: 'authenticated' };

  // 2. 公开路由：连 user 都不读
  if (effective.kind === 'public') return true;

  // 3. 其余意图都要求身份
  const user = subject.user;
  if (!user) throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);

  // 4. 归属优先：本人在 URL 参数里成立就不打权限表
  if (effective.kind === 'owner') {
    const ownerId = Number(subject.params[effective.ownerParam]);
    // 本人：不查权限表，直接放行（本人改自己不该要求 user:update）
    if (Number.isInteger(ownerId) && ownerId === user.id) return true;
    if (effective.codes.length === 0) {
      throw new ForbiddenException(PERMISSION_DENIED_MESSAGE);
    }
    return assertCodes(user, effective.codes, subject.resolveCodes);
  }

  // 5. 权限码：空集合退化为"登录即可"
  if (effective.kind === 'permission') {
    if (effective.codes.length === 0) return true;
    return assertCodes(user, effective.codes, subject.resolveCodes);
  }

  // 6. 显式「登录即可」
  return true;
}

/**
 * 权限码判定：通配 `*` 或任一命中即放行，否则 403。
 *
 * `resolveCodes` 在这里才被调用 —— 这是"本人分支不查库"的唯一保证点。
 */
async function assertCodes(
  user: AuthenticatedUser,
  required: readonly PermissionCode[],
  resolveCodes: AccessSubject['resolveCodes'],
): Promise<true> {
  const granted = await resolveCodes(user);
  // 通配 `*` 即超级管理员：新增权限码无需回头授权
  if (granted.has(WILDCARD_PERMISSION)) return true;
  if (required.some((code) => granted.has(code))) return true;
  throw new ForbiddenException(PERMISSION_DENIED_MESSAGE);
}
