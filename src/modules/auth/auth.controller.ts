import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ApiMessage } from '@/common/api-response/response.decorator.js';
import {
  Authenticated,
  CurrentUser,
  Public,
  type AuthenticatedUser,
} from '@/common/auth/access.decorator.js';
import { ApiRoute } from '@/common/openapi/route.decorator.js';
import { ZodBody } from '@/common/validation/param.decorator.js';
import { APP_CONFIG, type AppConfig } from '@/config/app-config.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import { clientContextOf } from '@/modules/auth/login/client-context.js';
import {
  clearRefreshCookie,
  resolveRefreshToken,
  setRefreshCookie,
} from '@/modules/auth/login/refresh-cookie.js';
import {
  loginResponseSchema,
  loginSchema,
  type LoginDto,
} from '@/modules/auth/login/dto/login.dto.js';
import {
  meResultSchema,
  type MeResult,
} from '@/modules/auth/login/dto/user.dto.js';
import {
  refreshSchema,
  type RefreshDto,
} from '@/modules/auth/login/dto/refresh.dto.js';
import { LoginService } from '@/modules/auth/login/login.service.js';
import { LogoutService } from '@/modules/auth/login/logout.service.js';
import { MeService } from '@/modules/auth/login/me.service.js';
import { RefreshService } from '@/modules/auth/login/refresh.service.js';

/**
 * 登录授权接口。
 *
 * 路由分组：
 * - `/auth/*`：本人视角（登录、续期、登出、我的设备、我的登录记录、当前身份）
 * - `/users/:id/sessions*`、`/users/:id/login-logs`：管理员视角（`@RequirePermission()`）
 *
 * 静态段路由一律排在带 `:id` 的路由之前；路径参数收在 URL 末尾。
 *
 * 文档：`@Public()` 的路由不带 bearer 鉴权；其余由访问意图装饰器自动带出 401。
 */
@ApiTags('认证')
@Controller()
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ENV) private readonly env: Env,
    private readonly login: LoginService,
    private readonly refresh: RefreshService,
    private readonly logoutUseCase: LogoutService,
    private readonly me: MeService,
  ) {}

  // ─── 本人视角 ───────────────────────────────────────────────

  /**
   * 登录：accessToken 进响应体，refreshToken 只进 HttpOnly Cookie（响应体不返回）。
   *
   * Cookie 开关关闭（非浏览器客户端）时，RT 退回响应体 —— 客户端自行保管。
   */
  @Public()
  @ApiMessage('登录成功')
  @ApiRoute({
    summary: '登录',
    description: 'refreshToken 只进 HttpOnly Cookie，不进响应体；关闭 Cookie 开关时才回落到 body',
    data: loginResponseSchema,
  })
  @Post('auth/login')
  async signIn(
    @ZodBody(loginSchema) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.login.execute({
      studentNo: dto.studentNo,
      password: dto.password,
      client: clientContextOf(req, this.config),
    });
    return this.stripRefresh(result, res);
  }

  /** RT 进 Cookie（开关开启时）并从响应体剥离；关闭开关时原样返回 */
  private stripRefresh<T extends { refreshToken: string }>(
    result: T,
    res: Response,
  ) {
    if (this.config.refreshCookieEnabled) {
      setRefreshCookie(res, result.refreshToken, this.config, this.env);
      const { refreshToken: _omitted, ...body } = result;
      return body;
    }
    return result;
  }

  /**
   * 续期：一次性轮换双 token，旧 refreshToken 立即失效。
   *
   * RT 来源：Cookie（浏览器）优先，body（非浏览器客户端）兜底；
   * 两者都没有 → 401「缺少 refreshToken」。轮换后的新 RT 走 Set-Cookie 覆盖旧值。
   */
  @Public()
  @ApiMessage('续期成功')
  @ApiRoute({
    summary: '续期 accessToken',
    description: '一次性轮换双 token，旧 refreshToken 立即失效；检测到重放会吊销该用户全部会话',
    data: loginResponseSchema,
  })
  @Post('auth/refresh')
  async refreshTokens(
    @ZodBody(refreshSchema) dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = resolveRefreshToken(req, dto?.refreshToken);
    if (!token) {
      throw new UnauthorizedException('缺少 refreshToken');
    }
    const result = await this.refresh.execute(
      token,
      clientContextOf(req, this.config),
    );
    return this.stripRefresh(result, res);
  }

  /** 退出当前设备（幂等）；同时清掉 refreshToken Cookie */
  @Authenticated()
  @ApiMessage('已退出登录')
  @ApiRoute({
    summary: '退出当前设备',
    description: '幂等：登录态已失效也返回成功；同时清 refreshToken Cookie',
    data: null,
  })
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  async signOut(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.logoutUseCase.execute(user);
    clearRefreshCookie(res, this.config, this.env);
  }

  /** 当前身份（前端刷新页面后据此重建本地登录态） */
  @Authenticated()
  @ApiRoute({
    summary: '当前身份',
    description: '前端刷新页面后据此重建本地登录态',
    data: meResultSchema,
  })
  @Get('auth/me')
  currentUser(@CurrentUser() user: AuthenticatedUser): Promise<MeResult> {
    return this.me.execute(user);
  }
}
