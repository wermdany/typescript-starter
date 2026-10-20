import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import { DatabaseService, type Db } from '@/database/database.service.js';
import {
  authLoginLogs,
  type NewAuthLoginLogs,
} from '@/database/schema/auth-login-logs.schema.js';
import { paginate, type PageResponse } from '@/shared/common.js';
import {
  loginLogPublicColumns,
  type LoginLogResponse,
} from './dto/login-log.dto.js';
import type { ClientContext } from '@/modules/auth/login/client-context.js';

/** 登录失败原因（写入 `failure_reason`） */
export type LoginFailureReason =
  'bad_credentials' | 'rate_limited' | 'token_replay';

/** 一条登录记录 */
export interface LoginLogEntry {
  studentNo: string;
  userId?: number;
  success: boolean;
  failureReason?: LoginFailureReason;
  client: Pick<ClientContext, 'ip' | 'userAgent'>;
  sessionId?: number;
}

/** 审计保留期（天）：超过后可清理，避免表无限增长 */
export const LOGIN_LOG_RETENTION_DAYS = 90;

/**
 * 登录审计 + 失败限流（**只认 `auth_login_logs` 一张表**）。
 *
 * 审计与限流放在一起，是因为限流的数据来源就是审计流水：不额外引入 Redis 或内存计数器，
 * 单库架构下这样最省，且重启不会丢失计数（否则攻击者等进程重启即可绕过窗口）。
 */
@Injectable()
export class LoginLogService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** 追加一条登录记录（成功与失败都记，只增不改）。可与同事务内的其它写共享连接 */
  async record(entry: LoginLogEntry, executor?: Db): Promise<void> {
    const db = executor ?? this.db;
    const values: NewAuthLoginLogs = {
      studentNo: entry.studentNo,
      userId: entry.userId ?? null,
      success: entry.success,
      failureReason: entry.failureReason ?? null,
      ip: entry.client.ip,
      userAgent: entry.client.userAgent,
      sessionId: entry.sessionId ?? null,
    };
    await db.insert(authLoginLogs).values(values);
  }

  /**
   * 统计限流窗口内的凭据失败次数（按 学号 + IP）。
   *
   * 只统计 `bad_credentials`：成功登录不计入；被限流拒绝的记录也不计入，
   * 否则一次超限会自我叠加，窗口内再也解不开。
   */
  async countRecentFailures(
    studentNo: string,
    ip: string,
    windowMs: number,
  ): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    const [row] = await this.db
      .select({ value: count() })
      .from(authLoginLogs)
      .where(
        and(
          eq(authLoginLogs.studentNo, studentNo),
          eq(authLoginLogs.ip, ip),
          eq(authLoginLogs.success, false),
          eq(authLoginLogs.failureReason, 'bad_credentials'),
          gte(authLoginLogs.createdAt, since),
          // 软删除的记录不参与限流计数（清零手段之一）
          isNull(authLoginLogs.deletedAt),
        ),
      );
    return row?.value ?? 0;
  }

  /** 某用户的登录记录（分页，最新在前） */
  async listForUser(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<PageResponse<LoginLogResponse>> {
    const where = and(
      eq(authLoginLogs.userId, userId),
      isNull(authLoginLogs.deletedAt),
    );
    return paginate(
      (limit, offset) => ({
        rows: this.db
          .select(loginLogPublicColumns)
          .from(authLoginLogs)
          .where(where)
          .orderBy(desc(authLoginLogs.createdAt))
          .limit(limit)
          .offset(offset),
        total: this.db
          .select({ value: count() })
          .from(authLoginLogs)
          .where(where)
          .then((rows) => rows[0]?.value ?? 0),
      }),
      page,
      pageSize,
    );
  }

  /** 清理超过保留期的审计流水（软删除）；返回清理数量 */
  async purgeOlderThan(
    days: number = LOGIN_LOG_RETENTION_DAYS,
    limit = 1000,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ id: authLoginLogs.id })
      .from(authLoginLogs)
      .where(
        and(
          lt(authLoginLogs.createdAt, cutoff),
          isNull(authLoginLogs.deletedAt),
        ),
      )
      .limit(limit);
    if (rows.length === 0) return 0;

    await this.db
      .update(authLoginLogs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        inArray(
          authLoginLogs.id,
          rows.map((row) => row.id),
        ),
      );
    return rows.length;
  }
}
