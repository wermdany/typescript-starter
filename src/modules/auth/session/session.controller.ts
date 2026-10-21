import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { ApiMessage, type PageResponse } from '@/shared/common.js';
import { ZodValidationPipe } from '@/shared/http/zod-validation.pipe.js';
import {
  Authenticated,
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from '@/shared/auth.js';
import { APP_CONFIG, type AppConfig } from '@/config/app-config.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import { clearRefreshCookie } from '@/modules/auth/login/refresh-cookie.js';
import {
  querySessionsSchema,
  type QuerySessionsDto,
} from './dto/query-sessions.dto.js';
import { revokeAllSchema, type RevokeAllDto } from './dto/revoke-all.dto.js';
import {
  sessionIdParamSchema,
  userSessionParamsSchema,
  userIdParamSchema,
  type SessionIdParam,
  type UserIdParam,
  type UserSessionParams,
} from './dto/session-params.dto.js';
import type { SessionResponse } from './dto/session.dto.js';
import { SessionManagerService } from './session-manager.service.js';

/** 会话 + 是否当前请求所用（列表里给前端标出"本机"） */
export type SessionWithCurrent = SessionResponse & { current: boolean };

/**
 * 会话管理接口（**找 session 的接口来这个文件**）。
 *
 * - 本人视角：`/auth/sessions*`（列表 / 踢单台 / 退出全部设备）
 * - 管理员视角：`/users/:id/sessions*`（查看 / 踢全部 / 踢单台）
 *
 * 登录态 Cookie 的写入与清除也在这些端点上（踢掉当前设备 = 登录态终结）。
 */
@Controller()
export class SessionController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionManagerService,
  ) {}

  // ─── 本人视角 ───────────────────────────────────────────────

  /** 退出全部设备：默认包含当前设备（连当前设备时一并清 Cookie） */
  @Authenticated()
  @ApiMessage('已退出所有设备')
  @Post('auth/sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(revokeAllSchema)) dto: RevokeAllDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RevokeAllResult> {
    const result = await this.sessions.revokeAllMine(user, dto);
    if (result.currentRevoked) {
      clearRefreshCookie(res, this.config, this.env);
    }
    return result;
  }

  /** 我的登录设备 */
  @Authenticated()
  @Get('auth/sessions')
  listMySessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(querySessionsSchema))
    query: QuerySessionsDto,
  ): Promise<PageResponse<SessionWithCurrent>> {
    return this.sessions.listMine(user, query);
  }

  /** 踢掉我的某台设备（踢的是当前设备时一并清 Cookie） */
  @Authenticated()
  @ApiMessage('设备已下线')
  @Delete('auth/sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeMySession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(sessionIdParamSchema))
    sessionId: SessionIdParam,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revokeMine(user, sessionId);
    if (sessionId === user.sessionId) {
      clearRefreshCookie(res, this.config, this.env);
    }
  }

  // ─── 管理员视角 ─────────────────────────────────────────────

  /** 管理员：踢出某用户的全部登录态 */
  @RequirePermission('session:revoke')
  @ApiMessage('已踢出该用户的登录态')
  @Delete('users/sessions/:id')
  @HttpCode(HttpStatus.OK)
  adminRevokeUserSessions(
    @Param('id', new ZodValidationPipe(userIdParamSchema)) userId: UserIdParam,
  ): Promise<{ revoked: number }> {
    return this.sessions.revokeUserSessions(userId);
  }

  /** 管理员：查看某用户的登录设备 */
  @RequirePermission('session:read')
  @Get('users/:id/sessions')
  adminListUserSessions(
    @CurrentUser() operator: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(userIdParamSchema)) userId: UserIdParam,
    @Query(new ZodValidationPipe(querySessionsSchema))
    query: QuerySessionsDto,
  ): Promise<PageResponse<SessionWithCurrent>> {
    return this.sessions.listForUser(userId, operator.sessionId, query);
  }

  /** 管理员：踢出某用户的单个会话 */
  @RequirePermission('session:revoke')
  @ApiMessage('设备已下线')
  @Delete('users/:id/sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  adminRevokeUserSession(
    @Param(new ZodValidationPipe(userSessionParamsSchema))
    params: UserSessionParams,
  ): Promise<void> {
    return this.sessions.revokeUserSession(params.id, params.sessionId);
  }
}

/** 踢出结果（`revoke-all` 的响应） */
export interface RevokeAllResult {
  /** 实际被吊销的会话数 */
  revoked: number;
  /** 本次请求自身的会话是否也被吊销（决定前端是否要清本地登录态） */
  currentRevoked: boolean;
}
