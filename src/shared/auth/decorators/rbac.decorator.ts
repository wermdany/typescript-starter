import { SetMetadata } from '@nestjs/common';

import type { PermissionCode } from '@/common/auth/permission.contract.js';

/** `PermissionGuard` 读取该 metadata 判断路由要求的权限码 */
export const PERMISSION_KEY = 'rbac:permissions';

/**
 * `PermissionGuard` 读取该 metadata 做**路由级**归属判定。
 *
 * 形状刻意与装饰器参数一致（`ownerParam` + 可选权限码），守卫不需要二次解析。
 */
export const OWNER_KEY = 'rbac:owner';

/** `@OwnerOrPermission` 写进 metadata 的值 */
export interface OwnerRequirement {
  /** URL 参数名（如 `id`），用于与 `req.params` 比对归属 */
  readonly ownerParam: string;
  /** 非本人时要求的权限码（可为空 ⇒ 纯本人） */
  readonly codes: readonly PermissionCode[];
}

/**
 * 声明路由要求的权限码（**任一命中即放行**，AND 需求请拆成多个路由或下沉到 service）。
 *
 * 参数必须是字符串字面量：`pnpm perm:audit` 靠静态读取它们建立"权限点清单"，
 * 传变量/拼接虽然运行时能跑，但会让审计无法确定取值（脚本会给告警）。
 *
 * @example
 * @RequirePermission('user:create')
 * @Post()
 */
export const RequirePermission = (...codes: PermissionCode[]) =>
  SetMetadata(PERMISSION_KEY, codes);

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
) => SetMetadata(OWNER_KEY, { ownerParam, codes } satisfies OwnerRequirement);
