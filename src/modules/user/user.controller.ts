import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';

import { ApiMessage } from '@/common/api-response/response.decorator.js';
import {
  Authenticated,
  CurrentUser,
  OwnerOrPermission,
  Public,
  RequirePermission,
  type AuthenticatedUser,
} from '@/common/auth/access.decorator.js';
import { Idempotent } from '@/common/idempotency/idempotency.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '@/common/validation/param.decorator.js';
import { type PageResponse } from '@/shared/common.js';
import {
  changePasswordSchema,
  type ChangePasswordDto,
} from './dto/change-password.dto.js';
import { createUserSchema, type CreateUserDto } from './dto/create-user.dto.js';
import {
  idParamSchema,
  studentNoParamSchema,
  type IdParam,
  type StudentNoParam,
} from './dto/params.dto.js';
import { queryUsersSchema, type QueryUsersDto } from './dto/query-users.dto.js';
import { updateUserSchema, type UpdateUserDto } from './dto/update-user.dto.js';
import { type UserResponse } from './dto/user.dto.js';
import { UserService } from './user.service.js';

/**
 * 用户管理接口。
 *
 * 访问控制（RBAC）：权限码 `资源:动作` 由 `@RequirePermission` 声明，
 * 自助类路由用 `@Authenticated()`（登录即可，语义靠归属判定）；
 * `PATCH /users/:id` 用 `@OwnerOrPermission('id', 'user:update')`：
 * 本人改自己无需权限码，管理员改别人需要 `user:update`。
 *
 * 参数校验全部走 `@ZodBody` / `@ZodQuery` / `@ZodParam`（`common/validation/param.decorator.ts`）：
 * schema 与来源一次绑定，调用点不出现管道构造。
 *
 * 幂等：`POST /users` 与 `POST /users/restore/:id` 支持 `Idempotency-Key`
 * 重放（`@Idempotent()` + 请求头双条件生效），避免网络重试建出两个用户。
 *
 * 静态段路由（health、me、by-student-no）必须声明在 `:id` 路由之前。
 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** 健康检查（公开） */
  @Public()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** 当前用户资料（登录即可） */
  @Authenticated()
  @Get('me')
  findMe(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return this.userService.findMe(user.id);
  }

  /** 创建用户（支持 `Idempotency-Key` 重放：重复提交不会建出两个账号） */
  @RequirePermission('user:create')
  @Idempotent()
  @ApiMessage('创建成功')
  @Post()
  create(@ZodBody(createUserSchema) dto: CreateUserDto): Promise<UserResponse> {
    return this.userService.create(dto);
  }

  /** 分页查询用户列表（管理视角） */
  @RequirePermission('user:read')
  @Get()
  findAll(
    @ZodQuery(queryUsersSchema) query: QueryUsersDto,
  ): Promise<PageResponse<UserResponse>> {
    return this.userService.findAll(query);
  }

  /** 按学号查询用户详情（管理视角） */
  @RequirePermission('user:read')
  @Get('by-student-no/:studentNo')
  findByStudentNo(
    @ZodParam('studentNo', studentNoParamSchema) studentNo: StudentNoParam,
  ): Promise<UserResponse> {
    return this.userService.findByStudentNo(studentNo);
  }

  /** 按 ID 查询用户详情（管理视角：任意登录用户不可窥探他人资料） */
  @RequirePermission('user:read')
  @Get(':id')
  findOne(@ZodParam('id', idParamSchema) id: IdParam): Promise<UserResponse> {
    return this.userService.findOne(id);
  }

  /**
   * 更新用户资料。
   *
   * - 本人：无需权限码（路由级归属判定放行），但字段仍受 `update-policy` 白名单约束
   * - 他人：需要 `user:update`（管理员），可改任意字段
   */
  @OwnerOrPermission('id', 'user:update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', idParamSchema) id: IdParam,
    @ZodBody(updateUserSchema) dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.userService.update(user, id, dto);
  }

  /** 修改本人的密码：凭旧密码即可，改完踢掉其它设备的登录态 */
  @Authenticated()
  @ApiMessage('密码已修改')
  @Patch('password')
  changeMyPassword(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(changePasswordSchema) dto: ChangePasswordDto,
  ): Promise<void> {
    return this.userService.changePassword(user, user.id, dto, user.sessionId);
  }

  /** 管理员重置指定用户的密码（无需旧密码），并踢掉其全部登录态 */
  @RequirePermission('user:reset-password')
  @ApiMessage('密码已重置，该用户的登录态已全部失效')
  @Patch('password/:id')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', idParamSchema) id: IdParam,
    @ZodBody(changePasswordSchema) dto: ChangePasswordDto,
  ): Promise<void> {
    return this.userService.changePassword(user, id, dto);
  }

  /** 恢复软删除用户（支持 `Idempotency-Key` 重放） */
  @RequirePermission('user:restore')
  @Idempotent()
  @ApiMessage('恢复成功')
  @Post('restore/:id')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', idParamSchema) id: IdParam,
  ): Promise<UserResponse> {
    return this.userService.restore(user, id);
  }

  /** 软删除用户 */
  @RequirePermission('user:delete')
  @ApiMessage('删除成功')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  softDelete(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', idParamSchema) id: IdParam,
  ): Promise<UserResponse> {
    return this.userService.softDelete(user, id);
  }
}
