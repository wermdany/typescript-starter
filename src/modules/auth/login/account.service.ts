import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DatabaseService } from '@/database/database.service.js';
import { users } from '@/database/schema/users.schema.js';
import { authUserColumns, type AuthUser } from './dto/user.dto.js';

/** 登录校验所需的账号记录（含密码哈希，仅在登录流程内使用） */
export interface LoginAccount {
  user: AuthUser;
  passwordHash: string;
}

/** 会话管理侧的账号摘要（判断"这个人是谁、还在不在"） */
export interface AccountSummary {
  id: number;
  studentNo: string;
  nickname: string;
  role: AuthUser['role'];
}

/**
 * 账号查询（**只读 users 表，不写任何东西**）。
 *
 * auth 模块内唯一的账号读取口：登录（查学号 + 密码哈希）、当前身份与续期（查 ID）、
 * 会话管理（确认目标账号存在）都从这里走，避免各用例自带一份 users 查询。
 */
@Injectable()
export class AccountService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 按学号取可用于登录的账号。
   *
   * 显式 select `passwordHash`（它不在任何投影白名单里）；`isNull(deletedAt)`
   * 让软删除账号无法登录。
   */
  async findLoginAccount(studentNo: string): Promise<LoginAccount | undefined> {
    const [row] = await this.database.db
      .select({ ...authUserColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.studentNo, studentNo), isNull(users.deletedAt)))
      .limit(1);
    if (!row) return undefined;
    const { passwordHash, ...user } = row;
    return { user, passwordHash };
  }

  /** 按 ID 取账号（会话续期、当前用户查询用） */
  async findById(id: number): Promise<AuthUser | undefined> {
    const [row] = await this.database.db
      .select(authUserColumns)
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  /** 按取会话管理的最小摘要；不存在（或已删除）返回 `undefined` */
  async findSummary(id: number): Promise<AccountSummary | undefined> {
    const user = await this.findById(id);
    if (!user) return undefined;
    return {
      id: user.id,
      studentNo: user.studentNo,
      nickname: user.nickname,
      role: user.role,
    };
  }
}
