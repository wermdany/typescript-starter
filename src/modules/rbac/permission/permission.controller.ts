import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '@/common/auth/access.decorator.js';
import { ApiRoute } from '@/common/openapi/route.decorator.js';
import { ZodQuery } from '@/common/validation/param.decorator.js';
import { type PageResponse } from '@/shared/common.js';
import {
  queryPermissionsSchema,
  type QueryPermissionsDto,
} from './dto/query-permissions.dto.js';
import {
  permissionPageSchema,
  type PermissionResponse,
} from './dto/permission.dto.js';
import { PermissionCatalogService } from './permission-catalog.service.js';

/**
 * 权限点目录接口（只读）。
 *
 * 权限点由代码里的 `@RequirePermission` 声明、`pnpm perm:sync` 落库，
 * 因此这里没有写接口：能造出来的"新权限码"没有任何路由认它。
 * 给角色分配权限走 `PUT /roles/:id/permissions`。
 */
@ApiTags('角色权限')
@Controller('permissions')
export class PermissionController {
  constructor(private readonly catalog: PermissionCatalogService) {}

  /** 权限点列表（管理端渲染授权矩阵的数据源） */
  @RequirePermission('permission:read')
  @ApiRoute({
    summary: '权限点列表（分页）',
    description:
      '需要 permission:read；默认按更新时间降序，可按 group 与关键字筛选，供管理端渲染授权矩阵',
    data: permissionPageSchema,
  })
  @Get()
  findAll(
    @ZodQuery(queryPermissionsSchema) query: QueryPermissionsDto,
  ): Promise<PageResponse<PermissionResponse>> {
    return this.catalog.findAll(query);
  }
}
