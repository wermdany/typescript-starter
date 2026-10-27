import { Injectable, UnauthorizedException } from '@nestjs/common';

import { UNAUTHENTICATED_MESSAGE } from '@/common/auth/auth.contract.js';
import { DatabaseService } from '@/database/database.service.js';
import { AccountService } from './account.service.js';
import type { ClientContext } from './client-context.js';
import { LoginLogService } from '@/modules/auth/log/login-log.service.js';
import { SessionService } from '@/modules/auth/session/session.service.js';
import { TokenService } from '@/modules/auth/token/token.service.js';
import type { LoginResult } from './dto/login.dto.js';

/** 续期结果：与登录响应同形（`LoginResult`），前端直接整体替换本地 token */

/**
 * 续期用例（refreshToken 一次性轮换 + 重放检测）。
 *
 * 安全模型（参照 OAuth 2.0 Security BCP）：
 * - 每次续期都换一对新 token，旧 refreshToken 立即作废 —— 泄露的 token 至多被用一次
 * - 已作废的 refreshToken 被再次使用，说明它可能已泄露（合法客户端不会用旧的），
 *   处置是**吊销该用户全部会话**并留审计
 * - 轮换是原子的：`UPDATE … WHERE refresh_token_hash = 旧值`，并发刷新时只有一个成功，
 *   另一个按重放处理 —— 前端因此必须把并发请求合并成一次刷新
 *
 * 过期时间由 `TokenService` 决定（含滑动续期），本用例不碰时间计算。
 */
@Injectable()
export class RefreshService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accounts: AccountService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly loginLogs: LoginLogService,
  ) {}

  async execute(
    refreshToken: string,
    client: ClientContext,
  ): Promise<LoginResult> {
    const refreshTokenHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.sessions.findByRefreshHash(refreshTokenHash);

    if (!session) {
      await this.handleReplay(refreshTokenHash, client);
      throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    }
    if (session.revokedAt) {
      throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    }

    const pair = this.tokens.issue(new Date(), {
      previousRefreshExpiresAt: session.refreshExpiresAt,
    });
    const rotated = await this.sessions.rotate(
      session.id,
      refreshTokenHash,
      pair,
    );
    if (!rotated) {
      // 并发刷新：抢输的那个拿着已作废的 token，按重放处理
      await this.handleReplay(refreshTokenHash, client);
      throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    }

    const user = await this.accounts.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    }

    const roles = await this.accounts.findRoleCodes(session.userId);

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      ...this.tokens.describeLifetime(pair),
      user: {
        id: user.id,
        studentNo: user.studentNo,
        nickname: user.nickname,
        roles,
      },
    };
  }

  /**
   * 处理"拿了一个已作废的 refreshToken"。
   *
   * 用历史 token 摘要反查会话：能定位到用户时吊销其全部会话（终止可疑链）并记
   * `token_replay` 审计；定位不到（随手伪造）则不吊销任何人 —— 否则任何字符串都能
   * 让别人的账号下线。
   */
  private async handleReplay(
    refreshTokenHash: string,
    client: ClientContext,
  ): Promise<void> {
    const victim = await this.sessions.findByRefreshHistory(refreshTokenHash);
    if (!victim) return;

    // 吊销全部会话 + 审计：同一事务，两者要么都发生要么都不发生
    await this.database.transaction(async (tx) => {
      await this.sessions.revokeAllForUser(victim.userId, 'token_replay', {
        executor: tx,
      });
      await this.loginLogs.record(
        {
          studentNo: victim.studentNo,
          userId: victim.userId,
          success: false,
          failureReason: 'token_replay',
          client,
          sessionId: victim.id,
        },
        tx,
      );
    });
  }
}
