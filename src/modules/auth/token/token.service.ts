import { Injectable } from '@nestjs/common';

import { AuthConfigService } from '@/config/auth.config.js';
import { generateToken, hashToken } from '@/shared/auth/token.js';

/** 一次签发产生的双 token（明文只在响应里出现一次） */
export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * 令牌签发（**只管生成与时效，不碰数据库**）。
 *
 * 拆出来的理由：会话落库/轮换是 `SessionService` 的事，签发规则（有效期、滑动续期）
 * 是纯计算，两者变化的原因不同，混在一起会让续期逻辑被 SQL 淹没。
 *
 * ⚠️ 构造参数的导入**不能**写 `import type`：Nest 靠 `design:paramtypes` 反射注入，
 * 类型被擦除后会变成 `Function` 并报 `UnknownDependenciesException`。
 */
@Injectable()
export class TokenService {
  constructor(private readonly config: AuthConfigService) {}

  /**
   * 签发一对新 token。
   *
   * @param anchor 时间基准：登录时用当前时间；续期时传入原会话的 `refreshExpiresAt`
   *   以实现"滑动续期"（有效期从上次到期点顺延，而不是从这一刻重新计满）
   * @param sliding 是否顺延 refreshToken；关闭时续期仍保持原会话的硬上限
   */
  issue(
    now: Date = new Date(),
    options: { sliding?: boolean; previousRefreshExpiresAt?: Date } = {},
  ): IssuedTokenPair {
    const { accessTtlMs, refreshTtlMs, slidingRefresh } =
      this.config.config.session;
    const sliding = options.sliding ?? slidingRefresh;
    const accessToken = generateToken();
    const refreshToken = generateToken();

    // 滑动续期以"原到期时间"为基准：活动不断时总是往后推一个完整周期
    const refreshBase =
      sliding &&
      options.previousRefreshExpiresAt &&
      options.previousRefreshExpiresAt > now
        ? options.previousRefreshExpiresAt
        : now;

    return {
      accessToken,
      refreshToken,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt: new Date(now.getTime() + accessTtlMs),
      refreshExpiresAt: new Date(refreshBase.getTime() + refreshTtlMs),
    };
  }

  /** 摘要 accessToken（查会话用） */
  hashAccessToken(token: string): string {
    return hashToken(token);
  }

  /** 摘要 refreshToken（续期与重放检测用） */
  hashRefreshToken(token: string): string {
    return hashToken(token);
  }

  /** 响应里给前端的有效期信息（秒 / 毫秒两种口径都给出，前端按需取） */
  describeLifetime(
    pair: Pick<IssuedTokenPair, 'accessExpiresAt' | 'refreshExpiresAt'>,
  ) {
    const now = Date.now();
    return {
      tokenType: 'Bearer' as const,
      expiresAt: pair.accessExpiresAt,
      expiresIn: Math.max(
        0,
        Math.round((pair.accessExpiresAt.getTime() - now) / 1000),
      ),
      refreshTokenExpiresAt: pair.refreshExpiresAt,
      /** 建议前端在 accessToken 剩余时间低于该值时静默续期 */
      refreshWindowSeconds: Math.round(
        this.config.config.session.refreshWindowMs / 1000,
      ),
    };
  }
}
