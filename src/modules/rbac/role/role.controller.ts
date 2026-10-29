import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiMessage } from '@/common/api-response/response.decorator.js';
import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from '@/common/auth/access.decorator.js';
import { ApiRoute } from '@/common/openapi/route.decorator.js';
import { ApiFailure } from '@/common/openapi/response.decorator.js';
import {
  ZodBody,
  ZodParam,
  ZodQuery,
} from '@/common/validation/param.decorator.js';
import { type PageResponse } from '@/shared/common.js';
import { createRoleSchema, type CreateRoleDto } from './dto/create-role.dto.js';
import {
  grantRolePermissionsSchema,
  type GrantRolePermissionsDto,
} from './dto/grant-role-permissions.dto.js';
import { roleIdParamSchema, type RoleIdParam } from './dto/params.dto.js';
import { queryRolesSchema, type QueryRolesDto } from './dto/query-roles.dto.js';
import {
  rolePageSchema,
  roleResponseSchema,
  type RoleResponse,
} from './dto/role.dto.js';
import { updateRoleSchema, type UpdateRoleDto } from './dto/update-role.dto.js';
import { RoleService } from './role.service.js';

/**
 * 角色管理接口（管理端）。
 *
 * ## 为什么全是权限码，没有 `@OwnerOrPermission`
 *
 * 角色不属于任何用户，没有"本人"这一分支；`@OwnerOrPermission` 比对的是
 * 路径参数与当前用户 id，用在这里只会把 `:id` 误读成"用户的 id"。
 *
 * ## 权限码与动作
 *
 * `role:read` / `role:create` / `role:update` / `role:delete` 全部落在既定的
 * `<资源>:<动作>` 词表内。**授权变更复用 `role:update`**：它改的就是角色这个资源，
 * 再单独造一个 `role:grant` 会绕过词表（`AGENTS.md` §16 明确"新动作先加进词表"）。
 *
 * ## 角色码不可改
 *
 * 没有"改角色码"的接口：码是权限判定的输入（装饰器、前端常量、日志检索），
 * 换码会让同一批人的权限在无感知中换成另一套名字。要换码就新建角色再迁移绑定。
 */
@ApiTags('角色权限')
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  /** 角色列表 */
  @RequirePermission('role:read')
  @ApiRoute({
    summary: '角色列表（分页）',
    description:
      '需要 role:read；返回每个角色的权限码与持有人数，供管理端渲染授权矩阵',
    data: rolePageSchema,
  })
  @Get()
  findAll(
    @ZodQuery(queryRolesSchema) query: QueryRolesDto,
  ): Promise<PageResponse<RoleResponse>> {
    return this.roleService.findAll(query);
  }

  /** 角色详情 */
  @RequirePermission('role:read')
  @ApiRoute({
    summary: '角色详情',
    description: '需要 role:read；软删除的角色返回 404',
    data: roleResponseSchema,
  })
  @Get(':id')
  findOne(
    @ZodParam('id', roleIdParamSchema) id: RoleIdParam,
  ): Promise<RoleResponse> {
    return this.roleService.findOne(id);
  }

  /** 新建角色 */
  @RequirePermission('role:create')
  @ApiFailure('角色码已存在', 409)
  @ApiMessage('创建成功')
  @ApiRoute({
    summary: '创建角色',
    description:
      '角色码小写字母开头、2~32 字符且创建后不可修改；新角色不带任何权限，需再调授权接口',
    data: roleResponseSchema,
  })
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(createRoleSchema) dto: CreateRoleDto,
  ): Promise<RoleResponse> {
    return this.roleService.create(user, dto);
  }

  /** 更新展示信息 */
  @RequirePermission('role:update')
  @ApiMessage('更新成功')
  @ApiRoute({
    summary: '更新角色展示信息',
    description:
      '只能改 name / description / level；角色码与内置标记不可改，至少提供一个字段',
    data: roleResponseSchema,
  })
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', roleIdParamSchema) id: RoleIdParam,
    @ZodBody(updateRoleSchema) dto: UpdateRoleDto,
  ): Promise<RoleResponse> {
    return this.roleService.update(user, id, dto);
  }

  /** 删除角色 */
  @RequirePermission('role:delete')
  @ApiFailure('内置角色不可删除', 409)
  @ApiFailure('角色仍有用户持有', 409)
  @ApiMessage('删除成功')
  @ApiRoute({
    summary: '删除角色',
    description:
      '软删除；内置角色、或仍有用户持有的角色会被拒绝（409），需先解除绑定',
    data: null,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', roleIdParamSchema) id: RoleIdParam,
  ): Promise<void> {
    return this.roleService.remove(user, id);
  }

  /** 整体替换角色的权限集合 */
  @RequirePermission('role:update')
  @ApiFailure('权限码未配置', 409)
  @ApiFailure('超级管理员的通配权限不可通过接口修改', 409)
  @ApiMessage('授权已更新')
  @ApiRoute({
    summary: '设置角色权限',
    description:
      '整体替换语义：请求体里的 codes 就是最终集合，空数组表示收回全部权限；变更立即生效（权限缓存同步失效）',
    data: roleResponseSchema,
  })
  @Put(':id/permissions')
  replacePermissions(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', roleIdParamSchema) id: RoleIdParam,
    @ZodBody(grantRolePermissionsSchema) dto: GrantRolePermissionsDto,
  ): Promise<RoleResponse> {
    return this.roleService.replacePermissions(user, id, dto);
  }
}
