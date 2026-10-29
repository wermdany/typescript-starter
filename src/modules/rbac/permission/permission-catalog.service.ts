import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm';

import { DatabaseService } from '@/database/database.service.js';
import { permissions } from '@/database/schema/rbac.schema.js';
import { paginate, type PageResponse } from '@/shared/common.js';
import type { QueryPermissionsDto } from './dto/query-permissions.dto.js';
import {
  permissionPublicColumns,
  type PermissionResponse,
} from './dto/permission.dto.js';

/**
 * 权限点目录（**只读**）。
 *
 * 权限点是代码侧的事实：`@RequirePermission('user:read')` 写在路由上，
 * `pnpm perm:sync` 把它同步进表。管理端能做的是给角色分配这些码，
 * 而不是凭空造一个新码 —— 造出来的码没有任何路由认它，等于一条永远不放行的授权。
 *
 * 因此这里只有查询：写入口只在两个地方，`perm:sync`（新增码）与
 * `RoleService.replacePermissions`（把码分配给角色）。
 */
@Injectable()
export class PermissionCatalogService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** 权限点分页列表（软删除不可见），可按分组与关键字筛选 */
  findAll(query: QueryPermissionsDto): Promise<PageResponse<PermissionResponse>> {
    const conditions: SQL[] = [isNull(permissions.deletedAt)];
    if (query.group) {
      conditions.push(eq(permissions.group, query.group));
    }
    if (query.keyword) {
      const pattern = `%${escapeLike(query.keyword)}%`;
      conditions.push(
        or(ilike(permissions.code, pattern), ilike(permissions.name, pattern)) as SQL,
      );
    }
    const where = and(...conditions);

    // 映射表必须覆盖 DTO 的 sortBy 枚举全集（缺项时 TS 在索引处报错）
    const sortColumn = {
      code: permissions.code,
      group: permissions.group,
      updatedAt: permissions.updatedAt,
    }[query.sortBy];
    const orderBy = query.order === 'desc' ? desc(sortColumn) : asc(sortColumn);

    return paginate(
      (limit, offset) => ({
        rows: this.db
          .select(permissionPublicColumns)
          .from(permissions)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset),
        total: this.db
          .select({ value: count() })
          .from(permissions)
          .where(where)
          .then((rows) => rows[0]?.value ?? 0),
      }),
      query.page,
      query.pageSize,
    );
  }
}

/** 转义 LIKE 通配符（默认转义符为反斜杠） */
function escapeLike(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (c) => '\\' + c);
}
