import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ApiMessage, type PageResponse } from '@/shared/common.js';
import { ZodValidationPipe } from '@/shared/http/zod-validation.pipe.js';
import {
  Authenticated,
  CurrentUser,
  OwnerOrPermission,
  Public,
  RequirePermission,
  type AuthenticatedUser,
} from '@/shared/auth.js';
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

  /** 创建用户 */
  @RequirePermission('user:create')
  @ApiMessage('创建成功')
  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
  ): Promise<UserResponse> {
    return this.userService.create(dto);
  }

  /** 分页查询用户列表（管理视角） */
  @RequirePermission('user:read')
  @Get()
  findAll(
    @Query(new ZodValidationPipe(queryUsersSchema)) query: QueryUsersDto,
  ): Promise<PageResponse<UserResponse>> {
    return this.userService.findAll(query);
  }

  /** 按学号查询用户详情（管理视角） */
  @RequirePermission('user:read')
  @Get('by-student-no/:studentNo')
  findByStudentNo(
    @Param('studentNo', new ZodValidationPipe(studentNoParamSchema))
    studentNo: StudentNoParam,
  ): Promise<UserResponse> {
    return this.userService.findByStudentNo(studentNo);
  }

  /** 按 ID 查询用户详情（管理视角：任意登录用户不可窥探他人资料） */
  @RequirePermission('user:read')
  @Get(':id')
  findOne(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
  ): Promise<UserResponse> {
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
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.userService.update(user, id, dto);
  }

  /** 修改本人的密码：凭旧密码即可，改完踢掉其它设备的登录态 */
  @Authenticated()
  @ApiMessage('密码已修改')
  @Patch('password')
  changeMyPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ): Promise<void> {
    return this.userService.changePassword(user, user.id, dto, user.sessionId);
  }

  /** 管理员重置指定用户的密码（无需旧密码），并踢掉其全部登录态 */
  @RequirePermission('user:reset-password')
  @ApiMessage('密码已重置，该用户的登录态已全部失效')
  @Patch('password/:id')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ): Promise<void> {
    return this.userService.changePassword(user, id, dto);
  }

  /** 恢复软删除用户 */
  @RequirePermission('user:restore')
  @ApiMessage('恢复成功')
  @Post('restore/:id')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
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
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
  ): Promise<UserResponse> {
    return this.userService.softDelete(user, id);
  }
}
