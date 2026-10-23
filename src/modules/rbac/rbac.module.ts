import { Global, Module } from '@nestjs/common';

import { PERMISSION_CHECKER } from '@/common/auth/permission.contract.js';
import { PermissionService } from './permission.service.js';

/**
 * RBAC 运行时模块：**权限码解析器的唯一提供处**。
 *
 * 守卫不在这里注册了 —— 登录态 / 权限码 / 归属三层判定已合并为
 * `common/auth/access.guard.ts` 的 `AccessGuard`，由 `common/http-stages.ts`
 * 统一注册。本模块退回"基础设施 provider"的单一职责：
 *
 * | 能力 | 提供处 |
 * | --- | --- |
 * | 放行闸门（三层合一） | `common/http-stages.ts` → `AccessGuard`（全局守卫） |
 * | 角色 → 权限码解析 | **本模块**（`PERMISSION_CHECKER` 端口） |
 *
 * **本模块是 `@Global`**：`PERMISSION_CHECKER` 需要在 service 里做第二道防线
 * （`UserService.mayActOnOthers()`：跨用户操作的准入问权限码，不问角色）。
 * 业务模块之间不互相 import，靠全局 provider 注入，避免为了拿到权限解析器而反向依赖本模块
 * （与 `DatabaseModule` 同为基础设施层的 `@Global` 模块）。
 *
 * ⚠️ 回滚边界：守卫与登录态已合并为 `AccessGuard`，**无法只关权限码那一层** ——
 * 要关掉全局鉴权得改 `common/http-stages.ts` 的注册表。直接注入
 * `PERMISSION_CHECKER` 的 service 会在本模块被移除时启动失败。
 */
@Global()
@Module({
  providers: [
    // 权限码解析（带 Tier-1 缓存；契约在 common，实现在这里）
    { provide: PERMISSION_CHECKER, useClass: PermissionService },
  ],
  exports: [PERMISSION_CHECKER],
})
export class RbacModule {}
