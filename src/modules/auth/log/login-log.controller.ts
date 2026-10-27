import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  Authenticated,
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from '@/common/auth/access.decorator.js';
import { ApiRoute } from '@/common/openapi/route.decorator.js';
import { ZodParam, ZodQuery } from '@/common/validation/param.decorator.js';
import {
  querySessionsSchema,
  type QuerySessionsDto,
} from '@/modules/auth/session/dto/query-sessions.dto.js';
import {
  userIdParamSchema,
  type UserIdParam,
} from '@/modules/auth/session/dto/session-params.dto.js';
import { type PageResponse } from '@/shared/common.js';
import {
  loginLogPageSchema,
  type LoginLogResponse,
} from './dto/login-log.dto.js';
import { LoginLogService } from './login-log.service.js';

/**
 * 登录记录接口（**找 login-logs 的接口来这个文件**）。
 *
 * 只增不改的审计流水：本人视角 `/auth/login-logs`，管理员视角 `/users/:id/login-logs`。
 *
 * 两个路由的分页参数复用 `querySessionsSchema`（同为 `page` / `pageSize`），
 * 校验走 `@ZodQuery` / `@ZodParam`。
 */
@ApiTags('登录记录')
@Controller()
export class LoginLogController {
  constructor(private readonly loginLogs: LoginLogService) {}

  /** 我的登录记录 */
  @Authenticated()
  @ApiRoute({
    summary: '我的登录记录',
    description: '只增不改的审计流水，最新在前',
    data: loginLogPageSchema,
  })
  @Get('auth/login-logs')
  listMyLoginLogs(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(querySessionsSchema) query: QuerySessionsDto,
  ): Promise<PageResponse<LoginLogResponse>> {
    return this.loginLogs.listForUser(user.id, query.page, query.pageSize);
  }

  /** 管理员：某用户的登录记录 */
  @RequirePermission('login-log:read')
  @ApiRoute({
    summary: '某用户的登录记录',
    description: '管理员视角；只增不改的审计流水',
    data: loginLogPageSchema,
  })
  @Get('users/:id/login-logs')

  adminListUserLoginLogs(
    @ZodParam('id', userIdParamSchema) userId: UserIdParam,
    @ZodQuery(querySessionsSchema) query: QuerySessionsDto,
  ): Promise<PageResponse<LoginLogResponse>> {
    return this.loginLogs.listForUser(userId, query.page, query.pageSize);
  }
}
