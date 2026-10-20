import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  type SQL,
} from 'drizzle-orm';

import { DatabaseService, type Db } from '@/database/database.service.js';
import { users } from '@/database/schema/users.schema.js';
import {
  authSessions,
  type NewAuthSessions,
} from '@/database/schema/auth-sessions.schema.js';
import { paginate, type PageResponse } from '@/shared/common.js';
import {
  TokenService,
  type IssuedTokenPair,
} from '@/modules/auth/token/token.service.js';
import type { ClientContext } from '@/modules/auth/login/client-context.js';
import {
  sessionPublicColumns,
  type SessionResponse,
} from './dto/session.dto.js';

/** 会话被吊销的原因（写入 `revoked_reason`，也是"我为什么下线"的答案） */
export type RevokeReason =
  | 'logout'
  | 'user_revoke_all'
  | 'admin_revoke'
  | 'password_changed'
  | 'account_deleted'
  | 'token_replay'
  | 'session_evicted';

/** 重放检测命中：旧 refreshToken 所属的会话与用户 */
export interface ReplayedSession {
  id: number;
  userId: number;
  studentNo: string;
}

/** 所有查询都只在未软删的会话里进行 */
const ALIVE = isNull(authSessions.deletedAt);

/**
 * 会话仓储：**只负责 `auth_sessions` 这一张表的读写与原子操作**，不含业务判断。
 *
 * - 「踢出」即批量写 `revoked_at`：下一次请求按 token 查不到会话，不依赖客户端删本地存储
 * - 续期是「一次性轮换」：`rotate()` 用 `WHERE refresh_token_hash = 旧值` 原子替换，
 *   并发只有一个请求能成功
 * - 重放检测需要"这个旧 refreshToken 曾经属于谁"：轮换时把旧摘要写进
 *   `previous_refresh_token_hash`，`findByRefreshHistory()` 据此定位用户；
 *   定位不到（随手伪造）时返回 `undefined`，由业务层决定"不误杀"
 */
/** SQL 执行器：事务内传 `tx`（同连接），事务外传 `db`。仓储方法据此支持事务 */
type Executor = Db;

@Injectable()
export class SessionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: TokenService,
  ) {}

  private get db(): Executor {
    return this.database.db;
  }

  /** 新建会话（登录；可与同事务内的其它写共享连接） */
  async create(
    userId: number,
    pair: IssuedTokenPair,
    client: ClientContext,
    executor?: Executor,
  ): Promise<number> {
    const db = executor ?? this.db;
    const values: NewAuthSessions = {
      userId,
      accessTokenHash: pair.accessTokenHash,
      refreshTokenHash: pair.refreshTokenHash,
      accessExpiresAt: pair.accessExpiresAt,
      refreshExpiresAt: pair.refreshExpiresAt,
      clientName: client.clientName,
      clientType: client.clientType,
      ip: client.ip,
      userAgent: client.userAgent,
      lastUsedAt: new Date(),
    };
    const [row] = await db
      .insert(authSessions)
      .values(values)
      .returning({ id: authSessions.id });
    return row.id;
  }

  /**
   * 并发会话超限时淘汰最旧的一条，然后插入新会话 —— **单事务原子完成**。
   *
   * 之前的「先查存活列表 → 循环吊销 → 再插入」是三次独立往返：
   * 并发登录时会双双看到"未超限"，或者重复淘汰同一条（第二次 revoke 返回 false 无感知）。
   * 改为事务内 `count → 批量吊销 → insert`，由行锁串行化，超限语义准确。
   *
   * @returns 新会话 ID
   */
  async createWithLimit(
    userId: number,
    pair: IssuedTokenPair,
    client: ClientContext,
    maxSessions: number,
  ): Promise<number> {
    return this.database.transaction(async (tx) => {
      const [{ value: alive }] = await tx
        .select({ value: count() })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt),
            ALIVE,
          ),
        );

      if (alive >= maxSessions) {
        // 淘汰"最旧的超出额度部分"（新建的在前）
        const victims = await tx
          .select({ id: authSessions.id })
          .from(authSessions)
          .where(
            and(
              eq(authSessions.userId, userId),
              isNull(authSessions.revokedAt),
              ALIVE,
            ),
          )
          .orderBy(desc(authSessions.createdAt))
          .offset(maxSessions - 1)
          .limit(alive - maxSessions + 1);
        if (victims.length > 0) {
          const now = new Date();
          await tx
            .update(authSessions)
            .set({
              revokedAt: now,
              revokedReason: 'session_evicted',
              updatedAt: now,
            })
            .where(
              inArray(
                authSessions.id,
                victims.map((row) => row.id),
              ),
            );
        }
      }

      return this.create(userId, pair, client, tx);
    });
  }

  /**
   * 按 accessToken 摘要取"可用于一次请求"的会话。
   *
   * 条件是未吊销、accessToken 未过期、会话未软删；用户是否已删除由调用方查
   * （中间件本来就要取用户信息，独立查询比 join 更好复用）。
   */
  async findAuthenticatable(accessTokenHash: string) {
    const [row] = await this.db
      .select({
        id: authSessions.id,
        userId: authSessions.userId,
        lastUsedAt: authSessions.lastUsedAt,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.accessTokenHash, accessTokenHash),
          isNull(authSessions.revokedAt),
          ALIVE,
          gt(authSessions.accessExpiresAt, new Date()),
        ),
      )
      .limit(1);
    return row;
  }

  /** 按 refreshToken 摘要查会话（续期入口；已吊销的也返回，以便区分"失效"与"伪造"） */
  async findByRefreshHash(refreshTokenHash: string) {
    const [row] = await this.db
      .select({
        id: authSessions.id,
        userId: authSessions.userId,
        refreshExpiresAt: authSessions.refreshExpiresAt,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(and(eq(authSessions.refreshTokenHash, refreshTokenHash), ALIVE))
      .limit(1);
    return row;
  }

  /**
   * 旧 refreshToken 被再次使用时，反查它曾属于哪条会话。
   *
   * 轮换后当前摘要是新值，旧值保存在 `previous_refresh_token_hash`。
   */
  async findByRefreshHistory(
    refreshTokenHash: string,
  ): Promise<ReplayedSession | undefined> {
    const [row] = await this.db
      .select({
        id: authSessions.id,
        userId: authSessions.userId,
        studentNo: users.studentNo,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.previousRefreshTokenHash, refreshTokenHash),
          isNotNull(authSessions.previousRefreshTokenHash),
          ALIVE,
        ),
      )
      .limit(1);
    return row;
  }

  /** 按会话 ID 取（踢单台设备时区分 404 与幂等） */
  async findById(sessionId: number) {
    const [row] = await this.db
      .select({
        id: authSessions.id,
        userId: authSessions.userId,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(and(eq(authSessions.id, sessionId), ALIVE))
      .limit(1);
    return row;
  }

  /** 某用户的会话列表（本人与管理员共用），最近登录的在前 */
  async listForUser(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<PageResponse<SessionResponse>> {
    const where = and(eq(authSessions.userId, userId), ALIVE);
    return paginate(
      (limit, offset) => ({
        rows: this.db
          .select(sessionPublicColumns)
          .from(authSessions)
          .where(where)
          .orderBy(desc(authSessions.createdAt))
          .limit(limit)
          .offset(offset),
        total: this.db
          .select({ value: count() })
          .from(authSessions)
          .where(where)
          .then((rows) => rows[0]?.value ?? 0),
      }),
      page,
      pageSize,
    );
  }

  /** 目标账号是否存在且未删除（管理员踢人前置校验；会话模块自己的 users 查询） */
  async userExists(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * 认证中间件用的最小身份查询（只取会话注入 `req.user` 需要的四列）。
   *
   * 与登录子域的 `AccountService.findById` 字段需求不同（不需要 email / points），
   * 且中间件属于会话子域 —— 自带这份查询可以不依赖 LoginModule。
   */
  async findAuthUserById(userId: number) {
    const [row] = await this.db
      .select({
        id: users.id,
        studentNo: users.studentNo,
        nickname: users.nickname,
        role: users.role,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  /** 统计某用户当前存活（未吊销）的会话数 */
  async countAlive(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          ALIVE,
        ),
      );
    return row?.value ?? 0;
  }

  /**
   * 一次性轮换：原子地把旧 refreshToken 换成新的一对，同时记下旧摘要用于重放检测。
   *
   * `WHERE refresh_token_hash = 旧值 AND revoked_at IS NULL` 保证并发下只有一个成功；
   * 返回 `false` 说明该 refreshToken 已被替换（重放）或会话已失效。
   */
  async rotate(
    sessionId: number,
    oldRefreshHash: string,
    pair: IssuedTokenPair,
  ): Promise<boolean> {
    const now = new Date();
    const affected = await this.db
      .update(authSessions)
      .set({
        accessTokenHash: pair.accessTokenHash,
        refreshTokenHash: pair.refreshTokenHash,
        accessExpiresAt: pair.accessExpiresAt,
        refreshExpiresAt: pair.refreshExpiresAt,
        previousRefreshTokenHash: oldRefreshHash,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.refreshTokenHash, oldRefreshHash),
          isNull(authSessions.revokedAt),
          ALIVE,
        ),
      )
      .returning({ id: authSessions.id });
    return affected.length > 0;
  }

  /** 记录一次"使用"（是否节流由调用方决定） */
  async touch(sessionId: number): Promise<void> {
    const now = new Date();
    await this.db
      .update(authSessions)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(eq(authSessions.id, sessionId));
  }

  /** 吊销单个会话；已吊销 / 不存在时返回 false（幂等）。可与同事务内的其它写共享连接 */
  async revoke(
    sessionId: number,
    reason: RevokeReason,
    executor?: Executor,
  ): Promise<boolean> {
    const db = executor ?? this.db;
    const now = new Date();
    const affected = await db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
      .where(
        and(
          eq(authSessions.id, sessionId),
          isNull(authSessions.revokedAt),
          ALIVE,
        ),
      )
      .returning({ id: authSessions.id });
    return affected.length > 0;
  }

  /**
   * 吊销某用户的全部存活会话。
   *
   * @param exceptSessionId 保留这条（"踢出其它设备"）
   * @returns 实际吊销数量
   */
  async revokeAllForUser(
    userId: number,
    reason: RevokeReason,
    options: { exceptSessionId?: number; executor?: Executor } = {},
  ): Promise<number> {
    const db = options.executor ?? this.db;
    const now = new Date();
    const conditions: SQL[] = [
      eq(authSessions.userId, userId),
      isNull(authSessions.revokedAt),
      ALIVE,
    ];
    if (options.exceptSessionId !== undefined) {
      conditions.push(ne(authSessions.id, options.exceptSessionId));
    }
    const affected = await db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
      .where(and(...conditions))
      .returning({ id: authSessions.id });
    return affected.length;
  }

  /**
   * 吊销某用户的某个会话。
   *
   * `userId` 兜一层：路径上的会话 ID 属于别人时不会误伤，调用方据此回 404。
   */
  async revokeForUser(
    userId: number,
    sessionId: number,
    reason: RevokeReason,
    executor?: Executor,
  ): Promise<boolean> {
    const db = executor ?? this.db;
    const now = new Date();
    const affected = await db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          ALIVE,
        ),
      )
      .returning({ id: authSessions.id });
    return affected.length > 0;
  }
}
