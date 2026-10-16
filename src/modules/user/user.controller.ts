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

import { ApiMessage } from '../../common/decorators/api-message.decorator.js';
import { type PageResponse } from '../../common/pagination/paginate.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  createUserSchema,
  type CreateUserDto,
} from './dto/create-user.dto.js';
import {
  queryUsersSchema,
  type QueryUsersDto,
} from './dto/query-users.dto.js';
import {
  idParamSchema,
  resetPasswordSchema,
  studentNoParamSchema,
  type IdParam,
  type ResetPasswordDto,
  type StudentNoParam,
} from './dto/reset-password.dto.js';
import {
  updateUserSchema,
  type UpdateUserDto,
} from './dto/update-user.dto.js';
import { type UserResponse } from './user.mapper.js';
import { UserService } from './user.service.js';

/**
 * 用户管理接口。
 *
 * 注意：静态段路由（by-student-no）必须声明在 `:id` 路由之前。
 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** 创建用户 */
  @ApiMessage('创建成功')
  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
  ): Promise<UserResponse> {
    return this.userService.create(dto);
  }

  /** 分页查询用户列表 */
  @Get()
  findAll(
    @Query(new ZodValidationPipe(queryUsersSchema)) query: QueryUsersDto,
  ): Promise<PageResponse<UserResponse>> {
    return this.userService.findAll(query);
  }

  /** 按学号查询用户详情 */
  @Get('by-student-no/:studentNo')
  findByStudentNo(
    @Param('studentNo', new ZodValidationPipe(studentNoParamSchema))
    studentNo: StudentNoParam,
  ): Promise<UserResponse> {
    return this.userService.findByStudentNo(studentNo);
  }

  /** 按 ID 查询用户详情 */
  @Get(':id')
  findOne(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
  ): Promise<UserResponse> {
    return this.userService.findOne(id);
  }

  /** 更新用户资料 */
  @Patch(':id')
  update(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.userService.update(id, dto);
  }

  /** 重置密码 */
  @ApiMessage('密码已重置')
  @Patch(':id/password')
  resetPassword(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ): Promise<void> {
    return this.userService.resetPassword(id, dto);
  }

  /** 恢复软删除用户 */
  @ApiMessage('恢复成功')
  @Post(':id/restore')
  restore(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
  ): Promise<UserResponse> {
    return this.userService.restore(id);
  }

  /** 软删除用户 */
  @ApiMessage('删除成功')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  softDelete(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam,
  ): Promise<UserResponse> {
    return this.userService.softDelete(id);
  }
}
