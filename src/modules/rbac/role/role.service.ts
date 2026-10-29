import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';

import { ADMIN_ROLE } from '@/common/auth/auth.contract.js';
import { DatabaseService, type Db } from '@/database/database.service.js';
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@/database/schema/rbac.schema.js';
import { actorIdOf, type Actor } from '@/shared/auth.js';
import { paginate, type PageResponse } from '@/shared/common.js';
import { PermissionService } from '../permission.service.js';
import type { CreateRoleDto } from './dto/create-role.dto.js';
import type { GrantRolePermissionsDto } from './dto/grant-role-permissions.dto.js';
import type { QueryRolesDto } from './dto/query-roles.dto.js';
import {
  rolePublicColumns,
  toRoleResponse,
  type RoleResponse,
  type RoleScalars,
} from './dto/role.dto.js';
import type { UpdateRoleDto } from './dto/update-role.dto.js';

/**
 * 角色管理（管理端）：角色字典的增删改查 + 角色授权的整体替换。
 *
 * ## 准入只有一层：权限码
 *
 * 角色不是"某个用户的资源"，没有归属分支 —— 能做这件事的人才进得来
 * （路由上的 `@RequirePermission('role:*')`）。写方法仍然收 `actor`：不是为了再判一次权，
 * 而是让"谁改了什么"进日志 —— 授权变更是最容易出事、又最难事后还原的操作。
 *
 * ## 缓存
 *
 * 授权一变就调 `PermissionService.invalidate()`。只靠 TTL 的话，管理端刚收回
 * `user:delete`，被收回的人最多还能用 60 秒（`RBAC_CACHE_TTL_SECONDS`），
 * 而这 60 秒恰好是"刚发现授错权限、正在紧急收回"的那一刻。
 *
 * ## 与 `user_roles` 的边界
 *
 * 本服务只写 `role_permissions`（角色 → 权限）。把角色分配给用户是
 * `UserService.replaceRoles` 的事 —— 那条链路要连带处理"用户至少一个角色"，
 * 放在这里会让两个子域互相依赖。
 */
@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly permissionCache: PermissionService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** 角色分页列表（软删除不可见），权限码与持有人数为派生字段，各一次批量查询补齐 */
  findAll(query: QueryRolesDto): Promise<PageResponse<RoleResponse>> {
    const conditions: SQL[] = [isNull(roles.deletedAt)];
    if (query.keyword) {
      const pattern = `%${escapeLike(query.keyword)}%`;
      conditions.push(
        or(ilike(roles.code, pattern), ilike(roles.name, pattern)) as SQL,
      );
    }
    const where = and(...conditions);

    // 映射表必须覆盖 DTO 的 sortBy 枚举全集（缺项时 TS 在索引处报错）
    const sortColumn = {
      code: roles.code,
      name: roles.name,
      level: roles.level,
      updatedAt: roles.updatedAt,
    }[query.sortBy];
    const orderBy = query.order === 'desc' ? desc(sortColumn) : asc(sortColumn);

    return paginate(
      (limit, offset) => ({
        rows: this.db
          .select(rolePublicColumns)
          .from(roles)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset)
          // 派生字段按整页批量补齐，避免每行两次查询（N+1）
          .then(async (pageRows) => {
            const ids = pageRows.map((row) => row.id);
            const [codes, counts] = await Promise.all([
              this.permissionCodesOf(ids),
              this.userCountsOf(ids),
            ]);
            return pageRows.map((row) =>
              toRoleResponse(
                row,
                codes.get(row.id) ?? [],
                counts.get(row.id) ?? 0,
              ),
            );
          }),
        total: this.db
          .select({ value: count() })
          .from(roles)
          .where(where)
          .then((rows) => rows[0]?.value ?? 0),
      }),
      query.page,
      query.pageSize,
    );
  }

  /** 角色详情（软删除不可见） */
  async findOne(id: number): Promise<RoleResponse> {
    const role = await this.loadRole(id);
    const [codes, counts] = await Promise.all([
      this.permissionCodesOf([id]),
      this.userCountsOf([id]),
    ]);
    return toRoleResponse(role, codes.get(id) ?? [], counts.get(id) ?? 0);
  }

  /**
   * 新建角色（默认不带任何权限）。
   *
   * 角色码重复由 `roles_code_alive_idx` 裁决 —— 不做"先查再插"：
   * 查与插之间并发建同名角色时，先查后插会同时通过，只有唯一索引拦得住。
   * 冲突经全局映射链转 409「角色码已存在」，service 里不写 `23505` 判断。
   */
  async create(actor: Actor, dto: CreateRoleDto): Promise<RoleResponse> {
    const [created] = await this.db
      .insert(roles)
      .values({
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        level: dto.level,
        // 管理端建的一律非内置：内置角色删不掉，不该由一次 HTTP 请求产生
        isSystem: false,
      })
      .returning(rolePublicColumns);
    this.logger.log(
      `角色创建：actor#${actorIdOf(actor)} 新建角色 ${created.code}(#${created.id})`,
    );
    return toRoleResponse(created, [], 0);
  }

  /** 更新展示信息（角色码与内置标记都不可改） */
  async update(
    actor: Actor,
    id: number,
    dto: UpdateRoleDto,
  ): Promise<RoleResponse> {
    const [updated] = await this.db
      .update(roles)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .returning(rolePublicColumns);
    if (!updated) {
      throw new NotFoundException('角色不存在');
    }
    this.logger.log(
      `角色变更：actor#${actorIdOf(actor)} 更新角色 ${updated.code}(#${id})`,
    );
    return this.findOne(id);
  }

  /**
   * 删除角色（软删）。
   *
   * 两条拒绝规则都在**事务内**判定：
   * - 内置角色 → 409。删掉 `admin` 等于让所有人失去通配权限，是自锁操作
   * - 仍有人持有 → 409。级联删 `user_roles` 会让这些用户瞬间变成"零角色"，
   *   表现为登录后处处 403 —— 让它显式失败，由人决定先解绑还是先换角色
   *
   * 角色下线后它的授权行一并软删：角色已不可见，留着的授权只会让缓存加载
   * 多扫一遍；同时保住"这一行曾经存在"的痕迹。
   */
  async remove(actor: Actor, id: number): Promise<void> {
    const role = await this.loadRole(id);
    if (role.isSystem) {
      throw new ConflictException('内置角色不可删除');
    }

    await this.database.transaction(async (tx) => {
      const [holder] = await tx
        .select({ value: count() })
        .from(userRoles)
        .where(
          and(eq(userRoles.roleId, id), isNull(userRoles.deletedAt)),
        );
      const holding = holder?.value ?? 0;
      if (holding > 0) {
        throw new ConflictException(
          `该角色仍被 ${holding} 个用户持有，请先解除绑定`,
        );
      }

      const now = new Date();
      const [deleted] = await tx
        .update(roles)
        .set({ deletedAt: now, updatedAt: now })
        // where 同时要求未删除：并发重复删除时第二次会拿到 404 而不是"删成功两次"
        .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
        .returning({ id: roles.id });
      if (!deleted) {
        throw new NotFoundException('角色不存在');
      }

      await tx
        .update(rolePermissions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(rolePermissions.roleId, id),
            isNull(rolePermissions.deletedAt),
          ),
        );
    });

    this.permissionCache.invalidate();
    this.logger.log(
      `角色变更：actor#${actorIdOf(actor)} 删除角色 ${role.code}(#${id})`,
    );
  }

  /**
   * 整体替换角色的权限集合。
   *
   * 三条不变量：
   * 1. **不碰超级管理员**：`admin` 的通配权限由种子维护。允许接口改它，
   *    一次误删就是全站管理能力消失（且改回来还得连库）
   * 2. **未配置的权限码给 409 而不是静默忽略**：静默忽略会让"我明明勾了它"
   *    变成"权限不生效"，这类问题排查成本极高
   * 3. **撤回用软删、重新授予复活原行**：`role_permissions` 的唯一索引不区分
   *    软删行，先删后插会撞唯一约束 —— 只能 `ON CONFLICT DO UPDATE` 把 `deleted_at` 置回 null
   */
  async replacePermissions(
    actor: Actor,
    id: number,
    dto: GrantRolePermissionsDto,
  ): Promise<RoleResponse> {
    const role = await this.loadRole(id);
    if (role.code === ADMIN_ROLE) {
      throw new ConflictException(
        '超级管理员的通配权限由种子维护，不能通过接口修改',
      );
    }
    const codes = dto.codes;

    await this.database.transaction(async (tx) => {
      const now = new Date();
      const targetIds: number[] =
        codes.length === 0 ? [] : await this.permissionIdsOf(tx, codes);

      // 1) 收回不在目标集合里的授权（目标集合为空 = 全收回）
      const revokeWhere =
        targetIds.length === 0
          ? and(
              eq(rolePermissions.roleId, id),
              isNull(rolePermissions.deletedAt),
            )
          : and(
              eq(rolePermissions.roleId, id),
              isNull(rolePermissions.deletedAt),
              notInArray(rolePermissions.permissionId, targetIds),
            );
      await tx
        .update(rolePermissions)
        .set({ deletedAt: now, updatedAt: now })
        .where(revokeWhere);

      // 2) 授予目标集合：命中唯一索引时复活原行，不插第二行
      if (targetIds.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(targetIds.map((permissionId) => ({ roleId: id, permissionId })))
          .onConflictDoUpdate({
            target: [rolePermissions.roleId, rolePermissions.permissionId],
            set: { deletedAt: null, updatedAt: now },
          });
      }
    });

    this.permissionCache.invalidate();
    this.logger.log(
      `权限变更：actor#${actorIdOf(actor)} 将角色 ${role.code}(#${id}) 的权限设为 ${
        codes.length === 0 ? '空' : codes.join(',')
      }`,
    );
    return this.findOne(id);
  }

  /** 读取存活角色，不存在（或已软删）直接 404 */
  private async loadRole(id: number): Promise<RoleScalars> {
    const [role] = await this.db
      .select(rolePublicColumns)
      .from(roles)
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .limit(1);
    if (!role) {
      throw new NotFoundException('角色不存在');
    }
    return role;
  }

  /**
   * 权限码 → `permission_id`（同时校验是否已配置）。
   *
   * 不存在就抛 409：这是**配置缺失**（权限点还没同步进库），不是请求参数格式错误，
   * 400 会让调用方以为少传了字段。
   */
  private async permissionIdsOf(
    db: Db,
    codes: readonly string[],
  ): Promise<number[]> {
    const rows = await db
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(
        and(
          inArray(permissions.code, [...codes]),
          isNull(permissions.deletedAt),
        ),
      );
    const idByCode = new Map(rows.map((row) => [row.code, row.id]));

    const ids: number[] = [];
    const missing: string[] = [];
    for (const code of codes) {
      const permissionId = idByCode.get(code);
      if (permissionId === undefined) {
        missing.push(code);
        continue;
      }
      ids.push(permissionId);
    }
    if (missing.length > 0) {
      throw new ConflictException(
        `权限码未配置：${missing.join('、')}（先跑 pnpm perm:sync 同步权限点）`,
      );
    }
    return ids;
  }

  /**
   * 批量取角色的权限码集合成 `roleId → code[]`。
   *
   * 一次 `IN` 查询解决整页；只认存活授权与存活权限点 ——
   * 权限点被下线后，仍挂着的授权行不该再出现在响应里。
   */
  private async permissionCodesOf(
    roleIds: readonly number[],
  ): Promise<Map<number, string[]>> {
    const byRole = new Map<number, string[]>();
    if (roleIds.length === 0) {
      return byRole;
    }
    const rows = await this.db
      .select({ roleId: rolePermissions.roleId, code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          inArray(rolePermissions.roleId, [...roleIds]),
          isNull(rolePermissions.deletedAt),
          isNull(permissions.deletedAt),
        ),
      )
      .orderBy(asc(permissions.code));
    for (const row of rows) {
      const list = byRole.get(row.roleId);
      if (list) {
        list.push(row.code);
      } else {
        byRole.set(row.roleId, [row.code]);
      }
    }
    return byRole;
  }

  /** 批量统计每个角色的持有人数（未删除的绑定） */
  private async userCountsOf(
    roleIds: readonly number[],
  ): Promise<Map<number, number>> {
    const byRole = new Map<number, number>();
    if (roleIds.length === 0) {
      return byRole;
    }
    const rows = await this.db
      .select({ roleId: userRoles.roleId, value: count() })
      .from(userRoles)
      .where(
        and(
          inArray(userRoles.roleId, [...roleIds]),
          isNull(userRoles.deletedAt),
        ),
      )
      .groupBy(userRoles.roleId);
    for (const row of rows) {
      byRole.set(row.roleId, row.value);
    }
    return byRole;
  }
}

/** 转义 LIKE 通配符（默认转义符为反斜杠） */
function escapeLike(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (c) => '\\' + c);
}
