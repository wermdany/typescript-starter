import {
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@/config/app-config.js';
import { DatabaseService } from '@/database/database.service.js';
import { verifyPassword } from '@/shared/common.js';
import {
  BAD_CREDENTIALS_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
} from '@/common/auth/auth.contract.js';
import { DUMMY_PASSWORD_HASH } from '@/shared/auth/token.js';
import { AccountService } from './account.service.js';
import type { ClientContext } from './client-context.js';
import { LoginLogService } from '@/modules/auth/log/login-log.service.js';
import { SessionService } from '@/modules/auth/session/session.service.js';
import { TokenService } from '@/modules/auth/token/token.service.js';
import type { UserSummary } from './dto/user.dto.js';

/**
 * 登录成功后的结果。
 *
 * `refreshToken` **只出现在这里**（controller 要用它 Set-Cookie），响应体里不返回 ——
 * Cookie 方案下前端永远接触不到 RT 明文。
 */
export interface LoginResult {
  /** 请求头用的短命 token（响应体返回） */
  accessToken: string;
  /** 长命 token（**只进 HttpOnly Cookie**，不进响应体） */
  refreshToken: string;
  tokenType: 'Bearer';
  expiresAt: Date;
  expiresIn: number;
  refreshTokenExpiresAt: Date;
  refreshWindowSeconds: number;
  user: UserSummary;
}

/** 登录入参 */
export interface LoginCommand {
  studentNo: string;
  password: string;
  client: ClientContext;
}

/**
 * 登录用例。
 *
 * 步骤固定为：限流预检 → 取账号 → 校验密码 →（并发会话上限）→ 建会话 → 写审计。
 *
 * 两条安全规则在这里落地：
 * 1. **不区分"账号不存在"与"密码错误"**：统一 401 + 同一文案，账号不存在时也跑一次
 *    scrypt（假哈希）对齐耗时，否则响应时间就成了账号是否存在的探测器
 * 2. **先判存在再比对**：scrypt 慢，账号不存在就没必要派生
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger('Login');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly accounts: AccountService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly loginLogs: LoginLogService,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const { studentNo, password, client } = command;
    const { loginMaxAttempts: maxAttempts, loginWindowMs: windowMs } =
      this.config;

    // 1. 限流：同一 学号 + IP 在窗口内失败过多时直接拒绝，避免继续消耗 scrypt
    const failures = await this.loginLogs.countRecentFailures(
      studentNo,
      client.ip,
      windowMs,
    );
    if (failures >= maxAttempts) {
      await this.loginLogs.record({
        studentNo,
        success: false,
        failureReason: 'rate_limited',
        client,
      });
      // Nest 12 未导出 429 的异常类，直接按状态码构造（与过滤器契约一致）
      throw new HttpException(
        TOO_MANY_ATTEMPTS_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. 取账号（软删除账号视同不存在）
    const account = await this.accounts.findLoginAccount(studentNo);

    // 3. 校验密码：存在与否走同一次 scrypt 计算量
    const matched = await verifyPassword(
      password,
      account?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!account || !matched) {
      await this.loginLogs.record({
        studentNo,
        userId: account?.user.id,
        success: false,
        failureReason: 'bad_credentials',
        client,
      });
      // 账号不存在时 userId 为空，但 studentNo 仍进审计：撞库/枚举尝试必须留痕
      throw new UnauthorizedException(BAD_CREDENTIALS_MESSAGE);
    }

    // 4. 建会话（含并发上限淘汰）+ 成功审计：同一事务，审计不会出现"有会话没记录"
    const pair = this.tokens.issue();
    const { maxSessionsPerUser } = this.config;
    const sessionId = await this.database.transaction(async (tx) => {
      const id = await this.sessions.createWithLimit(
        account.user.id,
        pair,
        client,
        maxSessionsPerUser,
      );
      await this.loginLogs.record(
        {
          studentNo,
          userId: account.user.id,
          success: true,
          client,
          sessionId: id,
        },
        tx,
      );
      return id;
    });

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      ...this.tokens.describeLifetime(pair),
      user: {
        id: account.user.id,
        studentNo: account.user.studentNo,
        nickname: account.user.nickname,
        role: account.user.role,
      },
    };
  }
}
