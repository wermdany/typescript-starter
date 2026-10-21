import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import {
  PERMISSION_DENIED_MESSAGE,
  type PermissionChecker,
  type PermissionCode,
  type PermissionSubject,
} from '@/common/auth/permission.contract.js';
import { DatabaseService } from '@/database/database.service.js';
import {
  permissions,
  rolePermissions,
  roles,
} from '@/database/schema/rbac.schema.js';

/** 空角色集合（冻结，避免调用方就地改写） */
const NO_CODES: ReadonlySet<PermissionCode> = Object.freeze(
  new Set<PermissionCode>(),
);

/** 单个角色的缓存项 */
interface RoleGrant {
  readonly codes: ReadonlySet<PermissionCode>;
  readonly expiresAt: number;
}

/**
 * 权限解析实现：**角色 → 权限码**（Tier-1 缓存）。
 *
 * 缓存粒度是**角色**而不是用户：角色数量是常量级（种子只有 3 个），
 * 而用户数是十万级 —— 按用户缓存会换来"改角色要等 TTL 生效"的语义倒退，
 * 收益却只是省一次走索引的 JOIN。用户的角色集合本身不缓存（随会话查询），
 * 因此增删角色对下一次请求立即生效，只有"改某个角色的权限"才受 TTL 约束。
 *
 * 失败策略（**绝不 fail-open**）：
 * - 有旧缓存 → 记 warn 沿用旧值（权限表短时不可读不该让全站 500）
 * - 无缓存 → 抛 403，宁可拒绝也不放行
 */
@Injectable()
export class PermissionService implements PermissionChecker {
  private readonly logger = new Logger(PermissionService.name);
  private readonly cache = new Map<string, RoleGrant>();
  private readonly ttlMs: number;
  /** 单次飞行：TTL 到点时的并发请求共用一次查询，避免把连接池打满 */
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly database: DatabaseService,
    @Inject(ENV) env: Env,
  ) {
    this.ttlMs = env.RBAC_CACHE_TTL_SECONDS * 1000;
  }

  async resolveCodes(
    user: PermissionSubject,
  ): Promise<ReadonlySet<PermissionCode>> {
    const userRoles = user.roles;
    // 没有角色 ⇒ 没有权限（fail-closed），也不该为此打一次库
    if (userRoles.length === 0) return NO_CODES;

    const now = Date.now();
    const expired = userRoles.filter((role) => {
      const grant = this.cache.get(role);
      return !grant || grant.expiresAt <= now;
    });

    if (expired.length > 0) {
      try {
        await this.reload();
      } catch (err) {
        // 有缓存就沿用；没有任何缓存可用的角色则必须拒绝
        const uncached = expired.filter((role) => !this.cache.has(role));
        if (uncached.length > 0) {
          this.logger.warn(
            `权限表加载失败且无可用缓存（${uncached.join(',')}），按 fail-closed 返回 403：${String(err)}`,
          );
          throw new ForbiddenException(PERMISSION_DENIED_MESSAGE);
        }
        this.logger.warn(`权限表加载失败，沿用过期缓存：${String(err)}`);
      }
    }

    const granted = new Set<PermissionCode>();
    for (const role of userRoles) {
      for (const code of this.cache.get(role)?.codes ?? []) {
        granted.add(code);
      }
    }
    return granted;
  }

  /** 让下一次请求重新加载（管理端改完 role_permissions 后可主动调用） */
  invalidate(): void {
    this.cache.clear();
  }

  private async reload(): Promise<void> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<void> {
    // 先取全部角色（含没有任何权限码的角色），否则"空权限角色"永远命中不了缓存、
    // 每个请求都会重载一次
    const roleRows = await this.database.db
      .select({ code: roles.code })
      .from(roles)
      .where(isNull(roles.deletedAt));

    const grouped = new Map<string, Set<PermissionCode>>();
    for (const row of roleRows) grouped.set(row.code, new Set());

    const grantRows = await this.database.db
      .select({ role: roles.code, code: permissions.code })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          isNull(rolePermissions.deletedAt),
          isNull(roles.deletedAt),
          isNull(permissions.deletedAt),
        ),
      );

    for (const row of grantRows) {
      grouped.get(row.role)?.add(row.code);
    }

    const expiresAt = Date.now() + this.ttlMs;
    for (const [code, codes] of grouped) {
      this.cache.set(code, { codes, expiresAt });
    }
  }
}
