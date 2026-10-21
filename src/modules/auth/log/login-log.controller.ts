import { Controller, Get, Param, Query } from '@nestjs/common';

import { type PageResponse } from '@/shared/common.js';
import { ZodValidationPipe } from '@/shared/http/zod-validation.pipe.js';
import {
  Authenticated,
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from '@/shared/auth.js';
import {
  querySessionsSchema,
  type QuerySessionsDto,
} from '@/modules/auth/session/dto/query-sessions.dto.js';
import {
  userIdParamSchema,
  type UserIdParam,
} from '@/modules/auth/session/dto/session-params.dto.js';
import type { LoginLogResponse } from './dto/login-log.dto.js';
import { LoginLogService } from './login-log.service.js';

/**
 * 登录记录接口（**找 login-logs 的接口来这个文件**）。
 *
 * 只增不改的审计流水：本人视角 `/auth/login-logs`，管理员视角 `/users/:id/login-logs`。
 */
@Controller()
export class LoginLogController {
  constructor(private readonly loginLogs: LoginLogService) {}

  /** 我的登录记录 */
  @Authenticated()
  @Get('auth/login-logs')
  listMyLoginLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(querySessionsSchema)) query: QuerySessionsDto,
  ): Promise<PageResponse<LoginLogResponse>> {
    return this.loginLogs.listForUser(user.id, query.page, query.pageSize);
  }

  /** 管理员：某用户的登录记录 */
  @RequirePermission('login-log:read')
  @Get('users/:id/login-logs')
  adminListUserLoginLogs(
    @Param('id', new ZodValidationPipe(userIdParamSchema)) userId: UserIdParam,
    @Query(new ZodValidationPipe(querySessionsSchema)) query: QuerySessionsDto,
  ): Promise<PageResponse<LoginLogResponse>> {
    return this.loginLogs.listForUser(userId, query.page, query.pageSize);
  }
}
